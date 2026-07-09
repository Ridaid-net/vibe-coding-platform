import { ApiError, getPool, type DbClient } from '@/lib/marketplace'

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

    const ins = await client.query<{ id: string }>(
      `
        INSERT INTO aliado_servicios (aliado_id, bicicleta_id, tipo_servicio, detalle)
        VALUES ($1, $2, $3, $4)
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
 * vinculo mas reciente gana, sin priorizar tipo_servicio (venta vs
 * mantenimiento) -- lo que importa para verificar el estado ACTUAL de la
 * bici es quien tuvo contacto mas reciente con ella, no quien la vendio
 * originalmente. Distinto a proposito del criterio de
 * resolverAliadoParaRetribucion (compensaciones.service.ts), que resuelve un
 * caso de uso diferente (retribucion por la validacion inicial del CIT).
 *
 * Si hubo un conflicto entre el usuario y un taller, la forma de evitar que
 * se le vuelva a asignar es desvincularlo via aliado_servicios -- no hace
 * falta logica nueva para eso, ya funciona asi (esta funcion simplemente no
 * encuentra mas ese vinculo).
 *
 * TODO(seleccion manual de taller): en el futuro, el vendedor deberia poder
 * elegir explicitamente entre sus talleres vinculados al publicar o pedir la
 * certificacion (no en /reservar, que es una accion del comprador). Hasta
 * que esa pantalla exista, /reservar sigue usando este default automatico.
 *
 * No hay ningun mecanismo de asignacion dinamica (por geocerca/disponibilidad)
 * todavia -- si no hay vinculo, devuelve null y el caller decide que hacer
 * (hoy: /reservar bloquea con SIN_TALLER_VINCULADO).
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
      ORDER BY s.created_at DESC
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
