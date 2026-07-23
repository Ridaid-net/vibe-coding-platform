import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import { enviarEmail } from '@/lib/email'

/**
 * RODAID — Hito 11: Gestion de Aliados (talleres / tiendas).
 *
 * Los talleres y tiendas solicitan ser Aliados; un admin las aprueba. Un aliado
 * aprobado obtiene el rol 'aliado' (acceso acotado al panel de inspecciones) y
 * puede inspeccionar SOLO las bicis vinculadas a sus servicios (vendidas o
 * mantenidas en su taller), registradas en `aliado_servicios`.
 */

const TIPOS_ALIADO = new Set(['taller', 'tienda', 'otro'])
const TIPOS_SERVICIO = new Set(['venta', 'mantenimiento', 'otro'])

export interface AliadoRow {
  id: string
  nombre: string
  tipo: string
  email: string
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  cuit: string | null
  estado: string
  usuario_id: string | null
  datos: Record<string, unknown>
  solicitado_en: string
  resuelto_en: string | null
  resuelto_por: string | null
  motivo_rechazo: string | null
  created_at: string
  updated_at: string
}

export interface AliadoPublico {
  id: string
  nombre: string
  tipo: string
  email: string
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  cuit: string | null
  estado: string
  usuarioId: string | null
  solicitadoEn: string
  resueltoEn: string | null
  motivoRechazo: string | null
  /** Cantidad de bicis vinculadas (alcance de inspeccion). */
  serviciosCount?: number
}

export function toAliadoPublico(row: AliadoRow): AliadoPublico {
  return {
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo,
    email: row.email,
    telefono: row.telefono,
    direccion: row.direccion,
    ciudad: row.ciudad,
    cuit: row.cuit,
    estado: row.estado,
    usuarioId: row.usuario_id,
    solicitadoEn: row.solicitado_en,
    resueltoEn: row.resuelto_en,
    motivoRechazo: row.motivo_rechazo,
  }
}

// ── Solicitar ser Aliado ─────────────────────────────────────────────────────

export interface SolicitudAliadoInput {
  nombre: string
  tipo?: string
  email: string
  telefono?: string | null
  direccion?: string | null
  ciudad?: string | null
  cuit?: string | null
}

function texto(value: unknown, campo: string, max: number, requerido = true): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    if (requerido) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${campo} es obligatorio.`)
    }
    return null
  }
  const t = value.trim()
  if (t.length > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${campo} no puede superar ${max} caracteres.`)
  }
  return t
}

/**
 * Registra una solicitud para ser Aliado (estado 'pendiente'). Si `usuarioId`
 * viene (solicitud autenticada), esa cuenta queda como duena del aliado y, al
 * aprobarse, recibe el rol 'aliado'.
 */
export async function solicitarAliado(
  input: SolicitudAliadoInput,
  usuarioId: string | null
): Promise<AliadoPublico> {
  const nombre = texto(input.nombre, 'El nombre del taller/tienda', 160)!
  const email = texto(input.email, 'El email', 254)!.toLowerCase()
  const tipo = (input.tipo ?? 'taller').toLowerCase()
  if (!TIPOS_ALIADO.has(tipo)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El tipo debe ser taller, tienda u otro.')
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Ingresa un email valido.')
  }

  const telefono = texto(input.telefono, 'El telefono', 40, false)
  const direccion = texto(input.direccion, 'La direccion', 400, false)
  const ciudad = texto(input.ciudad, 'La ciudad', 120, false)
  const cuit = texto(input.cuit, 'El CUIT', 20, false)

  // Evita solicitudes pendientes duplicadas para el mismo email.
  const dup = await getPool().query<{ id: string }>(
    `SELECT id FROM aliados WHERE lower(email) = $1 AND estado = 'pendiente' LIMIT 1`,
    [email]
  )
  if (dup.rows[0]) {
    throw new ApiError(
      409,
      'SOLICITUD_DUPLICADA',
      'Ya hay una solicitud pendiente con ese email.'
    )
  }

  const res = await getPool().query<AliadoRow>(
    `
      INSERT INTO aliados (nombre, tipo, email, telefono, direccion, ciudad, cuit, usuario_id)
      VALUES ($1, $2::aliado_tipo, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [nombre, tipo, email, telefono, direccion, ciudad, cuit, usuarioId]
  )
  return toAliadoPublico(res.rows[0])
}

// ── Listado (admin) ──────────────────────────────────────────────────────────

export async function listarAliados(estado?: string): Promise<AliadoPublico[]> {
  const filtro = estado && ['pendiente', 'aprobado', 'rechazado'].includes(estado)
  const res = await getPool().query<AliadoRow & { servicios_count: string }>(
    `
      SELECT a.*, COALESCE(s.cnt, 0) AS servicios_count
      FROM aliados a
      LEFT JOIN (
        SELECT aliado_id, COUNT(*) AS cnt FROM aliado_servicios GROUP BY aliado_id
      ) s ON s.aliado_id = a.id
      ${filtro ? 'WHERE a.estado = $1::aliado_estado' : ''}
      ORDER BY
        CASE a.estado WHEN 'pendiente' THEN 0 WHEN 'aprobado' THEN 1 ELSE 2 END,
        a.solicitado_en DESC
      LIMIT 200
    `,
    filtro ? [estado] : []
  )
  return res.rows.map((r: AliadoRow & { servicios_count: string }) => ({
    ...toAliadoPublico(r),
    serviciosCount: Number(r.servicios_count),
  }))
}

// ── Aprobar / rechazar (admin) ───────────────────────────────────────────────

export interface ResolucionAliadoResultado {
  aliado: AliadoPublico
  rolAsignado: boolean
}

/**
 * Aprueba o rechaza una solicitud de aliado (transaccion atomica). Al aprobar,
 * si el aliado tiene una cuenta duena (`usuario_id`) y esa cuenta no es admin ni
 * inspector, su rol pasa a 'aliado' para que acceda al panel de inspecciones.
 */
export async function resolverAliado(opts: {
  aliadoId: string
  adminId: string
  accion: 'aprobar' | 'rechazar'
  motivo?: string | null
}): Promise<ResolucionAliadoResultado> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    const found = await client.query<AliadoRow>(
      `SELECT * FROM aliados WHERE id = $1 FOR UPDATE`,
      [opts.aliadoId]
    )
    const aliado = found.rows[0]
    if (!aliado) {
      throw new ApiError(404, 'ALIADO_NOT_FOUND', 'No encontramos la solicitud de aliado.')
    }
    if (aliado.estado !== 'pendiente') {
      throw new ApiError(409, 'ALIADO_YA_RESUELTO', 'Esta solicitud ya fue resuelta.')
    }

    const nuevoEstado = opts.accion === 'aprobar' ? 'aprobado' : 'rechazado'
    const upd = await client.query<AliadoRow>(
      `
        UPDATE aliados
        SET estado = $2::aliado_estado, resuelto_en = NOW(), resuelto_por = $3,
            motivo_rechazo = $4
        WHERE id = $1
        RETURNING *
      `,
      [
        opts.aliadoId,
        nuevoEstado,
        opts.adminId === 'admin' ? null : opts.adminId,
        opts.accion === 'rechazar' ? (opts.motivo ?? null) : null,
      ]
    )

    let rolAsignado = false
    if (opts.accion === 'aprobar' && aliado.usuario_id) {
      // Eleva el rol de la cuenta duena a 'aliado' (sin degradar admin/inspector).
      const rolUpd = await client.query<{ id: string }>(
        `
          UPDATE usuarios
          SET rol = 'aliado'::usuario_rol, updated_at = NOW()
          WHERE id = $1 AND rol = 'ciclista'
          RETURNING id
        `,
        [aliado.usuario_id]
      )
      rolAsignado = (rolUpd.rowCount ?? 0) > 0
    }

    await client.query('COMMIT')
    return { aliado: toAliadoPublico(upd.rows[0]), rolAsignado }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// ── Vincular un servicio (bici <-> aliado) ───────────────────────────────────

export interface VinculoServicioResultado {
  aliadoId: string
  bicicletaId: string
  tipoServicio: string
  nuevo: boolean
}

/**
 * Vincula una bicicleta (por numero de serie) a un aliado: registra que el
 * taller la vendio o la mantiene, habilitando su inspeccion por ese aliado.
 */
export async function vincularServicio(opts: {
  aliadoId: string
  numeroSerie: string
  tipoServicio?: string
  detalle?: string | null
}): Promise<VinculoServicioResultado> {
  const serie = opts.numeroSerie.trim()
  if (!serie) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Indica el numero de serie de la bici.')
  }
  const tipo = (opts.tipoServicio ?? 'mantenimiento').toLowerCase()
  if (!TIPOS_SERVICIO.has(tipo)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El tipo de servicio debe ser venta, mantenimiento u otro.')
  }

  return withTx(async (client) => {
    const bici = await client.query<{ id: string }>(
      `SELECT id FROM bicicletas WHERE UPPER(numero_serie) = UPPER($1) LIMIT 1`,
      [serie]
    )
    if (!bici.rows[0]) {
      throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'No hay ninguna bici con ese numero de serie.')
    }
    const bicicletaId = bici.rows[0].id

    // es_principal: TRUE solo si la bici todavia no tiene ningun principal
    // vigente -- el primer vinculo real de una bici se vuelve principal
    // automaticamente (preserva el comportamiento pre-multi-taller para el
    // caso comun de un solo taller), pero esta funcion nunca le saca el
    // principal a nadie que el dueño ya haya elegido explicitamente via
    // otorgarAccesoTaller().
    const ins = await client.query<{ id: string }>(
      `
        INSERT INTO aliado_servicios (aliado_id, bicicleta_id, tipo_servicio, detalle, es_principal)
        VALUES (
          $1, $2, $3, $4,
          NOT EXISTS (
            SELECT 1 FROM aliado_servicios
            WHERE bicicleta_id = $2 AND es_principal = TRUE AND revocado_en IS NULL
          )
        )
        ON CONFLICT (aliado_id, bicicleta_id) DO NOTHING
        RETURNING id
      `,
      [opts.aliadoId, bicicletaId, tipo, opts.detalle ?? null]
    )

    return {
      aliadoId: opts.aliadoId,
      bicicletaId,
      tipoServicio: tipo,
      nuevo: (ins.rowCount ?? 0) > 0,
    }
  })
}

async function withTx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// ── Resolucion de Taller Aliado para CIT Completo (Fase 6) ──────────────────

/**
 * Resuelve el Taller Aliado vinculado a una bici via aliado_servicios: el
 * que el dueño eligio como PRINCIPAL (es_principal = TRUE, no revocado) --
 * ver "Acceso multi-taller por bici" (20260723000009). Antes de esa
 * migracion, era simplemente "el vinculo mas reciente gana"; el backfill de
 * esa migracion ya convirtio el vinculo mas reciente de cada bici en
 * principal, asi que el comportamiento no cambia para ninguna bici ya
 * vinculada -- lo unico nuevo es que ahora el dueño puede elegir
 * explicitamente cual es, en vez de que lo decida el orden de creacion.
 *
 * Si el dueño revoca el acceso del taller principal sin elegir reemplazo,
 * esta funcion devuelve null (nadie mas se promueve automaticamente) hasta
 * que el dueño elija uno nuevo -- ver otorgarAccesoTaller()/revocarAccesoTaller().
 *
 * Distinto a proposito del criterio de resolverAliadoParaRetribucion
 * (compensaciones.service.ts), que resuelve un caso de uso diferente
 * (retribucion por la validacion inicial del CIT, sin concepto de "principal").
 *
 * No hay ningun mecanismo de asignacion dinamica (por geocerca/disponibilidad)
 * todavia -- si no hay principal vigente, devuelve null y el caller decide
 * que hacer (hoy: /reservar bloquea con SIN_TALLER_VINCULADO).
 *
 * TODO: cuando la cantidad de Talleres Aliados activos llegue a 20, migrar a
 * asignacion automatica (por geocerca u otro criterio) -- antes de eso, el
 * volumen no justifica la complejidad y el riesgo de asignar mal. Ver
 * contarTalleresAliadosActivos() para detectar ese punto.
 */
export async function resolverAliadoPorBicicleta(
  bicicletaId: string
): Promise<string | null> {
  const res = await getPool().query<{ aliado_id: string }>(
    `
      SELECT s.aliado_id FROM aliado_servicios s
      JOIN aliados a ON a.id = s.aliado_id
      WHERE s.bicicleta_id = $1 AND a.estado = 'aprobado'
        AND s.es_principal = TRUE AND s.revocado_en IS NULL
      LIMIT 1
    `,
    [bicicletaId]
  )
  return res.rows[0]?.aliado_id ?? null
}

/** Ver TODO de resolverAliadoPorBicicleta. COUNT simple, sin uso activo todavia
 * mas alla de loguear la tendencia cuando /reservar bloquea por falta de taller. */
export async function contarTalleresAliadosActivos(): Promise<number> {
  const res = await getPool().query<{ count: string }>(
    `SELECT count(*) FROM aliados WHERE estado = 'aprobado'`
  )
  return Number(res.rows[0]?.count ?? 0)
}

// ── Acceso multi-taller por bici (Garaje Digital) ────────────────────────────

/**
 * Estados de marketplace_publicaciones en los que se considera que la bici
 * esta "en venta" via CIT Completo -- mientras esta en cualquiera de estos,
 * el dueño no puede tocar los talleres vinculados (otorgar/revocar), para no
 * romper una venta en curso reasignando a mitad de camino quien la certifico
 * o quien cobra logistica/exito. Deliberadamente NO incluye ACTIVA/PAUSADA
 * (el flujo generico de pago unico, sin ningun taller involucrado -- esta
 * restriccion no tiene sentido ahi) ni PUBLICADO_PENDIENTE_CERTIFICACION (la
 * bici recien publicada, sin comprador todavia -- es exactamente el caso que
 * esta funcionalidad existe para cubrir: el dueño puede seguir eligiendo
 * quien la va a certificar hasta que alguien la reserve).
 */
const ESTADOS_BICI_EN_VENTA = ['PUBLICADO_CERTIFICADO', 'RESERVADO', 'EJECUTANDO_LOGISTICA']

async function verificarBiciNoEnVenta(client: DbClient, bicicletaId: string): Promise<void> {
  const res = await client.query(
    `
      SELECT 1 FROM marketplace_publicaciones
      WHERE bicicleta_id = $1 AND estado = ANY($2::marketplace_publicacion_estado[])
      LIMIT 1
    `,
    [bicicletaId, ESTADOS_BICI_EN_VENTA]
  )
  if (res.rowCount) {
    throw new ApiError(
      409,
      'BICI_EN_VENTA',
      'Esta bicicleta esta en proceso de venta -- no se puede cambiar el taller vinculado hasta que se resuelva.'
    )
  }
}

/** Mismo patron que validarOwnershipAutorizados() (autorizados.service.ts). */
export async function validarOwnershipBicicleta(usuarioId: string, bicicletaId: string): Promise<void> {
  const bici = await getPool().query<{ propietario_id: string }>(
    `SELECT propietario_id FROM bicicletas WHERE id = $1 LIMIT 1`,
    [bicicletaId]
  )
  if (!bici.rows[0]) {
    throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
  }
  if (bici.rows[0].propietario_id !== usuarioId) {
    throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
  }
}

export interface TallerVinculado {
  aliadoId: string
  nombre: string
  tipo: string
  esPrincipal: boolean
  vinculadoEn: string
}

interface TallerVinculadoRow {
  aliado_id: string
  nombre: string
  tipo: string
  es_principal: boolean
  created_at: string
}

/** Lista los talleres con acceso vigente (no revocado) a una bici, para el Garaje del dueño. */
export async function listarTalleresDeBicicleta(bicicletaId: string): Promise<TallerVinculado[]> {
  const res = await getPool().query<TallerVinculadoRow>(
    `
      SELECT s.aliado_id, a.nombre, a.tipo, s.es_principal, s.created_at
      FROM aliado_servicios s
      JOIN aliados a ON a.id = s.aliado_id
      WHERE s.bicicleta_id = $1 AND s.revocado_en IS NULL
      ORDER BY s.es_principal DESC, s.created_at DESC
    `,
    [bicicletaId]
  )
  return res.rows.map((r: TallerVinculadoRow) => ({
    aliadoId: r.aliado_id,
    nombre: r.nombre,
    tipo: r.tipo,
    esPrincipal: r.es_principal,
    vinculadoEn: r.created_at,
  }))
}

/**
 * El dueño de la bici le da acceso a un Taller Aliado nuevo (o re-otorga uno
 * previamente revocado). `esPrincipal` lo decide el dueño en el momento: si
 * es true, reemplaza a quien sea el principal actual (resolverAliadoPorBicicleta
 * pasa a devolver este); si es false, se suma como acceso secundario sin
 * tocar quien resuelve automaticamente para CIT Completo -- esto es lo que
 * permite "mantener o revocar el acceso del taller anterior" en el mismo
 * paso en el que se otorga el nuevo.
 */
export async function otorgarAccesoTaller(opts: {
  propietarioId: string
  bicicletaId: string
  aliadoId: string
  esPrincipal: boolean
}): Promise<TallerVinculado> {
  return withTx(async (client) => {
    const bici = await client.query<{ id: string; propietario_id: string }>(
      `SELECT id, propietario_id FROM bicicletas WHERE id = $1 FOR UPDATE`,
      [opts.bicicletaId]
    )
    if (!bici.rows[0]) {
      throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
    }
    if (bici.rows[0].propietario_id !== opts.propietarioId) {
      throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
    }

    await verificarBiciNoEnVenta(client, opts.bicicletaId)

    const aliado = await client.query<{ id: string; nombre: string; tipo: string }>(
      `SELECT id, nombre, tipo FROM aliados WHERE id = $1 AND estado = 'aprobado' LIMIT 1`,
      [opts.aliadoId]
    )
    if (!aliado.rows[0]) {
      throw new ApiError(404, 'ALIADO_NOT_FOUND', 'El taller elegido no existe o no esta aprobado.')
    }

    if (opts.esPrincipal) {
      // Le saca es_principal a quien lo tuviera -- el indice unico parcial
      // (idx_aliado_servicios_principal_unico) exige que a lo sumo uno este
      // vigente por bici, asi que esto tiene que pasar en la misma
      // transaccion antes del INSERT/UPDATE de abajo.
      await client.query(
        `UPDATE aliado_servicios SET es_principal = FALSE WHERE bicicleta_id = $1 AND es_principal = TRUE`,
        [opts.bicicletaId]
      )
    }

    const ins = await client.query<{ created_at: string }>(
      `
        INSERT INTO aliado_servicios (aliado_id, bicicleta_id, tipo_servicio, es_principal, revocado_en)
        VALUES ($1, $2, 'mantenimiento', $3, NULL)
        ON CONFLICT (aliado_id, bicicleta_id)
          DO UPDATE SET es_principal = $3, revocado_en = NULL
        RETURNING created_at
      `,
      [opts.aliadoId, opts.bicicletaId, opts.esPrincipal]
    )

    return {
      aliadoId: aliado.rows[0].id,
      nombre: aliado.rows[0].nombre,
      tipo: aliado.rows[0].tipo,
      esPrincipal: opts.esPrincipal,
      vinculadoEn: ins.rows[0].created_at,
    }
  })
}

/**
 * El dueño le revoca el acceso a un taller. Si era el principal, la bici
 * queda SIN principal -- resolverAliadoPorBicicleta() devuelve null hasta
 * que el dueño elija uno nuevo (nunca se promueve otro automaticamente,
 * confirmado con Federico: es una decision del dueño, no del sistema).
 */
export async function revocarAccesoTaller(opts: {
  propietarioId: string
  bicicletaId: string
  aliadoId: string
}): Promise<void> {
  return withTx(async (client) => {
    const bici = await client.query<{ id: string; propietario_id: string }>(
      `SELECT id, propietario_id FROM bicicletas WHERE id = $1 FOR UPDATE`,
      [opts.bicicletaId]
    )
    if (!bici.rows[0]) {
      throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
    }
    if (bici.rows[0].propietario_id !== opts.propietarioId) {
      throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
    }

    await verificarBiciNoEnVenta(client, opts.bicicletaId)

    const upd = await client.query(
      `
        UPDATE aliado_servicios
        SET revocado_en = NOW()
        WHERE bicicleta_id = $1 AND aliado_id = $2 AND revocado_en IS NULL
      `,
      [opts.bicicletaId, opts.aliadoId]
    )
    if (!upd.rowCount) {
      throw new ApiError(404, 'VINCULO_NOT_FOUND', 'Ese taller no tiene acceso vigente a esta bici.')
    }
  })
}

// ── Boton de Panico "Modo Robo": alerta a talleres cercanos (PREPARADA, APAGADA) ──

export interface TallerCercano {
  aliadoId: string
  nombre: string
  tipo: string
  distanciaMetros: number
}

/**
 * CODIGO MUERTO A PROPOSITO -- NINGUN endpoint ni componente llama a esta
 * funcion todavia. Ver la auditoria del Boton de Panico "Modo Robo"
 * (CLAUDE.md): la 3ra pata original del boton ("alertar a talleres cercanos
 * por geolocalizacion") quedo fuera de alcance del MVP porque, confirmado con
 * una consulta de solo lectura contra produccion, los 4 aliados hoy
 * `aprobado` (3 `tienda` + 1 `taller` de prueba interno) tienen
 * `talleres.lat`/`talleres.lng` en NULL -- nadie registro su geocerca real
 * todavia (el endpoint para hacerlo, PUT /api/v1/aliados/geocerca, existe y
 * funciona, simplemente nadie lo uso). Conectar este boton a la UI hoy
 * mostraria "sin talleres cerca" siempre, sin ningun valor real para el
 * usuario -- de ahi que la funcion quede escrita y lista, pero apagada.
 *
 * Misma matematica de Haversine que `lib/geo.ts::calcularDistanciaHaversine`
 * (geocercado del intake CIT), reimplementada en SQL nativo de Postgres
 * (`acos`/`cos`/`sin`/`radians`) para no traer todos los aliados a Node y
 * filtrar en memoria. Razonable mientras el numero de aliados aprobados sea
 * chico (hoy: 4); si escala a miles, esto merece una revision (indice
 * geoespacial dedicado, p. ej. PostGIS/earthdistance) antes de activarse.
 *
 * Para activar cuando corresponda, en este orden:
 *   1. Confirmar que hay talleres reales con geocerca cargada (repetir la
 *      consulta de solo lectura de `talleres` que motivo este apagado).
 *   2. Definir el radio de alerta por defecto (`radioMetros`) -- no hay
 *      todavia un valor de negocio confirmado por Federico para esto.
 *   3. Conectar esta funcion a un endpoint nuevo + un boton real en la UI del
 *      Boton de Panico (garaje-digital.tsx).
 *   4. Definir el mecanismo de notificacion saliente HACIA el aliado (push,
 *      email, WhatsApp) -- hoy `notificaciones` solo modela avisos hacia
 *      usuarios/ciclistas, no existe ningun canal saliente hacia un aliado.
 */
export async function buscarTalleresCercanos(
  lat: number,
  lng: number,
  radioMetros: number
): Promise<TallerCercano[]> {
  const res = await getPool().query<{
    aliado_id: string
    nombre: string
    tipo: string
    distancia_metros: number
  }>(
    `
      SELECT aliado_id, nombre, tipo, distancia_metros FROM (
        SELECT
          a.id AS aliado_id,
          a.nombre,
          a.tipo,
          (
            6371000 * acos(
              LEAST(1, GREATEST(-1,
                cos(radians($1)) * cos(radians(t.lat)) *
                  cos(radians(t.lng) - radians($2)) +
                sin(radians($1)) * sin(radians(t.lat))
              ))
            )
          ) AS distancia_metros
        FROM aliados a
        JOIN talleres t ON t.id = a.id
        WHERE a.estado = 'aprobado'
          AND t.lat IS NOT NULL
          AND t.lng IS NOT NULL
      ) sub
      WHERE distancia_metros <= $3
      ORDER BY distancia_metros ASC
    `,
    [lat, lng, radioMetros]
  )
  return res.rows.map((r: { aliado_id: string; nombre: string; tipo: string; distancia_metros: number }) => ({
    aliadoId: r.aliado_id,
    nombre: r.nombre,
    tipo: r.tipo,
    distanciaMetros: Math.round(Number(r.distancia_metros)),
  }))
}

// ── Reserva simple de CIT (Garaje Digital -> Taller Aliado) ─────────────────

export interface TallerAprobado {
  id: string
  nombre: string
  tipo: string
  ciudad: string | null
}

/** Listado publico de Aliados aprobados, sin geolocalizacion (MVP). */
export async function listarTalleresAprobados(): Promise<TallerAprobado[]> {
  const res = await getPool().query<{ id: string; nombre: string; tipo: string; ciudad: string | null }>(
    `SELECT id, nombre, tipo, ciudad FROM aliados WHERE estado = 'aprobado' ORDER BY nombre ASC`
  )
  return res.rows.map((r: { id: string; nombre: string; tipo: string; ciudad: string | null }) => ({
    id: r.id,
    nombre: r.nombre,
    tipo: r.tipo,
    ciudad: r.ciudad,
  }))
}

export interface SolicitudReserva {
  id: string
  bicicletaId: string
  bicicletaMarca: string
  bicicletaModelo: string
  aliadoId: string
  usuarioNombre: string | null
  usuarioEmail: string
  nota: string | null
  estado: string
  createdAt: string
}

/**
 * Reserva simple: el ciclista elige un taller desde su Garaje Digital, sin
 * horario ni pago -- el taller la ve en su panel y contacta por fuera del
 * sistema (email/telefono, ya tiene el dato del ciclista). El tipo de CIT
 * (Express/Completo) se define recien en esa conversacion, no aca.
 */
export async function crearSolicitudReserva(input: {
  usuarioId: string
  bicicletaId: string
  aliadoId: string
  nota?: string | null
}): Promise<{ id: string }> {
  const pool = getPool()

  const bici = await pool.query<{ id: string; propietario_id: string }>(
    `SELECT id, propietario_id FROM bicicletas WHERE id = $1 LIMIT 1`,
    [input.bicicletaId]
  )
  if (!bici.rows[0]) {
    throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
  }
  if (bici.rows[0].propietario_id !== input.usuarioId) {
    throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
  }

  const aliado = await pool.query<{ id: string; nombre: string; email: string }>(
    `SELECT id, nombre, email FROM aliados WHERE id = $1 AND estado = 'aprobado' LIMIT 1`,
    [input.aliadoId]
  )
  if (!aliado.rows[0]) {
    throw new ApiError(404, 'ALIADO_NOT_FOUND', 'El taller elegido no existe o no esta aprobado.')
  }

  const nota = input.nota?.trim() || null
  const insert = await pool.query<{ id: string }>(
    `
      INSERT INTO solicitudes_reserva_taller (bicicleta_id, usuario_id, aliado_id, nota)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [input.bicicletaId, input.usuarioId, input.aliadoId, nota]
  )

  // Best-effort: no existe todavia ningun canal saliente hacia un aliado
  // (mismo hallazgo que buscarTalleresCercanos(), arriba) mas alla de email.
  // Un fallo de envio no debe tumbar la reserva ya guardada.
  try {
    await enviarEmail({
      to: aliado.rows[0].email,
      subject: 'RODAID — Nueva solicitud de reserva de CIT',
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
        <h2>Nueva solicitud de reserva</h2>
        <p>Un ciclista eligio a <strong>${aliado.rows[0].nombre}</strong> para certificar su bici en RODAID.</p>
        ${nota ? `<p><strong>Nota:</strong> ${nota}</p>` : ''}
        <p>Entra a tu <a href="https://rodaid.net/taller">Panel de Taller Aliado</a> para ver el contacto y coordinar.</p>
      </div>`,
    })
  } catch (err) {
    console.error('Error email solicitud de reserva:', err)
  }

  return { id: insert.rows[0].id }
}

/** Listado de solicitudes de reserva de un taller (panel /taller). */
export async function listarSolicitudesReservaPorAliado(
  aliadoId: string,
  estado?: string
): Promise<SolicitudReserva[]> {
  const filtro = estado && ['pendiente', 'contactado', 'cerrada'].includes(estado) ? estado : null
  const res = await getPool().query<{
    id: string
    bicicleta_id: string
    marca: string
    modelo: string
    aliado_id: string
    nombre: string | null
    email: string
    nota: string | null
    estado: string
    created_at: string
  }>(
    `
      SELECT
        s.id, s.bicicleta_id, b.marca, b.modelo, s.aliado_id,
        u.datos_perfil->>'nombre' AS nombre, u.email, s.nota, s.estado, s.created_at
      FROM solicitudes_reserva_taller s
      JOIN bicicletas b ON b.id = s.bicicleta_id
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.aliado_id = $1
        AND ($2::solicitud_reserva_taller_estado IS NULL OR s.estado = $2::solicitud_reserva_taller_estado)
      ORDER BY s.created_at DESC
      LIMIT 100
    `,
    [aliadoId, filtro]
  )
  return res.rows.map((r: {
    id: string
    bicicleta_id: string
    marca: string
    modelo: string
    aliado_id: string
    nombre: string | null
    email: string
    nota: string | null
    estado: string
    created_at: string
  }) => ({
    id: r.id,
    bicicletaId: r.bicicleta_id,
    bicicletaMarca: r.marca,
    bicicletaModelo: r.modelo,
    aliadoId: r.aliado_id,
    usuarioNombre: r.nombre,
    usuarioEmail: r.email,
    nota: r.nota,
    estado: r.estado,
    createdAt: r.created_at,
  }))
}

/** El taller marca una solicitud como contactada (o cerrada). Ownership-scoped. */
export async function marcarSolicitudReserva(
  aliadoId: string,
  solicitudId: string,
  estado: 'contactado' | 'cerrada'
): Promise<void> {
  const res = await getPool().query(
    `
      UPDATE solicitudes_reserva_taller
      SET estado = $3::solicitud_reserva_taller_estado, updated_at = NOW()
      WHERE id = $1 AND aliado_id = $2
    `,
    [solicitudId, aliadoId, estado]
  )
  if (!res.rowCount) {
    throw new ApiError(404, 'SOLICITUD_NOT_FOUND', 'La solicitud indicada no existe.')
  }
}
