// ─── RODAID · Servicio de Notificaciones ─────────────────────────────────
//
// Gestiona los tokens de dispositivo (push) de cada usuario y el envio de las
// alertas del producto. Cubre cuatro disparadores:
//   · CIT aprobado          → notificarCITAprobado()
//   · CIT rechazado         → notificarCITRechazado()
//   · alerta de robo        → notificarAlertaRobo()
//   · vencimiento proximo   → escanearVencimientosProximos()  (arbol de decision)
//
// Cada notificacion se persiste en la tabla `notificaciones` (fuente de verdad
// y centro de notificaciones del usuario) y se reparte a los dispositivos
// activos del usuario mediante `dispatchPush`. El envio fisico al proveedor
// (FCM / APNs / Web Push) se aisla en `dispatchPush`: mientras no haya un
// proveedor configurado, deja traza en el log; la persistencia en base no
// depende de ese proveedor.

import { ApiError, getPool } from '@/lib/marketplace'
import {
  DIAS_UMBRAL_VENCIMIENTO,
  diasHastaVencimiento,
  evaluarVencimientoCIT,
} from '@/lib/cit'

export type NotificacionTipo =
  | 'CIT_APROBADO'
  | 'CIT_RECHAZADO'
  | 'ALERTA_ROBO'
  | 'VENCIMIENTO_PROXIMO'

export type DevicePlataforma = 'IOS' | 'ANDROID' | 'WEB'

export type NotificacionEstado = 'ENVIADA' | 'SIN_DISPOSITIVOS' | 'FALLIDA'

interface NotificacionRow {
  id: string
  usuario_id: string
  tipo: NotificacionTipo
  titulo: string
  cuerpo: string
  data: Record<string, unknown>
  cit_id: string | null
  bicicleta_id: string | null
  estado: NotificacionEstado
  dispositivos_alcanzados: number
  leida_en: string | null
  creada_en: string
}

export interface Notificacion {
  id: string
  tipo: NotificacionTipo
  titulo: string
  cuerpo: string
  data: Record<string, unknown>
  citId: string | null
  bicicletaId: string | null
  estado: NotificacionEstado
  dispositivosAlcanzados: number
  leidaEn: string | null
  creadaEn: string
}

function mapNotificacion(row: NotificacionRow): Notificacion {
  return {
    id: row.id,
    tipo: row.tipo,
    titulo: row.titulo,
    cuerpo: row.cuerpo,
    data: row.data ?? {},
    citId: row.cit_id,
    bicicletaId: row.bicicleta_id,
    estado: row.estado,
    dispositivosAlcanzados: row.dispositivos_alcanzados,
    leidaEn: row.leida_en,
    creadaEn: row.creada_en,
  }
}

const PLATAFORMAS: ReadonlySet<DevicePlataforma> = new Set([
  'IOS',
  'ANDROID',
  'WEB',
])

// ── Tokens de dispositivo ────────────────────────────────────────────────

/**
 * Registra (o reactiva) un token de dispositivo para un usuario. Es
 * idempotente: si el token ya existe lo reasigna al usuario actual y lo marca
 * activo, de modo que un mismo dispositivo no genere duplicados.
 */
export async function registrarDispositivo(input: {
  usuarioId: string
  token: string
  plataforma?: string | null
}): Promise<{ id: string; plataforma: DevicePlataforma }> {
  const token = input.token?.trim()
  if (!token) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El token del dispositivo es obligatorio.')
  }

  const plataforma = (input.plataforma ?? 'WEB').toUpperCase() as DevicePlataforma
  if (!PLATAFORMAS.has(plataforma)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Plataforma de dispositivo invalida.')
  }

  const { rows } = await getPool().query<{ id: string }>(
    `
      INSERT INTO device_tokens (usuario_id, token, plataforma, activo)
      VALUES ($1, $2, $3, TRUE)
      ON CONFLICT (token) DO UPDATE
        SET usuario_id = EXCLUDED.usuario_id,
            plataforma = EXCLUDED.plataforma,
            activo = TRUE,
            actualizado_en = NOW()
      RETURNING id
    `,
    [input.usuarioId, token, plataforma]
  )

  return { id: rows[0].id, plataforma }
}

/**
 * Desactiva un token de dispositivo del usuario (logout / desuscripcion). Se
 * marca inactivo en lugar de borrarlo para conservar la trazabilidad.
 */
export async function desactivarDispositivo(input: {
  usuarioId: string
  token: string
}): Promise<{ desactivado: boolean }> {
  const token = input.token?.trim()
  if (!token) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El token del dispositivo es obligatorio.')
  }

  const res = await getPool().query(
    `
      UPDATE device_tokens
      SET activo = FALSE, actualizado_en = NOW()
      WHERE token = $1 AND usuario_id = $2 AND activo
    `,
    [token, input.usuarioId]
  )

  return { desactivado: (res.rowCount ?? 0) > 0 }
}

async function tokensActivosDe(usuarioId: string): Promise<string[]> {
  const { rows } = await getPool().query<{ token: string }>(
    `SELECT token FROM device_tokens WHERE usuario_id = $1 AND activo`,
    [usuarioId]
  )
  return rows.map((r: { token: string }) => r.token)
}

// ── Envio ────────────────────────────────────────────────────────────────

export interface PushPayload {
  titulo: string
  cuerpo: string
  data: Record<string, unknown>
}

/**
 * Reparte el payload a los tokens de dispositivo indicados. Aisla el proveedor
 * de push real (FCM / APNs / Web Push); mientras no este configurado deja
 * traza en el log y reporta como alcanzados todos los tokens. Devuelve la
 * cantidad de dispositivos efectivamente notificados.
 */
async function dispatchPush(tokens: string[], payload: PushPayload): Promise<number> {
  if (tokens.length === 0) {
    return 0
  }

  // Punto de integracion con el proveedor de push. Hoy no hay credenciales
  // configuradas, asi que se registra la entrega sin contactar un servicio
  // externo. La persistencia en `notificaciones` no depende de este paso.
  console.info(
    `[notificaciones] push "${payload.titulo}" -> ${tokens.length} dispositivo(s)`
  )
  return tokens.length
}

interface EnviarInput {
  usuarioId: string
  tipo: NotificacionTipo
  titulo: string
  cuerpo: string
  data?: Record<string, unknown>
  citId?: string | null
  bicicletaId?: string | null
  /**
   * Si es true, deduplica la alerta de vencimiento por CIT contra el indice
   * unico parcial. Si ya existia una, no inserta ni reenvia y devuelve null.
   */
  dedupeVencimiento?: boolean
}

/**
 * Persiste una notificacion y la reparte a los dispositivos activos del
 * usuario. Devuelve la notificacion registrada, o null si se omitio por
 * deduplicacion (alerta de vencimiento ya emitida para ese CIT).
 */
export async function enviarNotificacion(
  input: EnviarInput
): Promise<Notificacion | null> {
  const data = input.data ?? {}

  // 1. Reclamar el registro. En el caso de vencimiento, el indice unico parcial
  //    garantiza una sola alerta por CIT incluso ante barridos concurrentes.
  const insertSql = input.dedupeVencimiento
    ? `
        INSERT INTO notificaciones
          (usuario_id, tipo, titulo, cuerpo, data, cit_id, bicicleta_id)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        ON CONFLICT (cit_id) WHERE tipo = 'VENCIMIENTO_PROXIMO' AND cit_id IS NOT NULL
        DO NOTHING
        RETURNING *
      `
    : `
        INSERT INTO notificaciones
          (usuario_id, tipo, titulo, cuerpo, data, cit_id, bicicleta_id)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        RETURNING *
      `

  const inserted = await getPool().query<NotificacionRow>(insertSql, [
    input.usuarioId,
    input.tipo,
    input.titulo,
    input.cuerpo,
    JSON.stringify(data),
    input.citId ?? null,
    input.bicicletaId ?? null,
  ])

  const row = inserted.rows[0]
  if (!row) {
    // Conflicto de deduplicacion: la alerta ya se habia emitido.
    return null
  }

  // 2. Repartir a los dispositivos y reflejar el resultado en el registro.
  let estado: NotificacionEstado
  let alcanzados = 0
  try {
    const tokens = await tokensActivosDe(input.usuarioId)
    alcanzados = await dispatchPush(tokens, {
      titulo: input.titulo,
      cuerpo: input.cuerpo,
      data,
    })
    estado = alcanzados > 0 ? 'ENVIADA' : 'SIN_DISPOSITIVOS'
  } catch (error) {
    console.error('[notificaciones] fallo el envio push', error)
    estado = 'FALLIDA'
  }

  const { rows } = await getPool().query<NotificacionRow>(
    `
      UPDATE notificaciones
      SET estado = $2, dispositivos_alcanzados = $3
      WHERE id = $1
      RETURNING *
    `,
    [row.id, estado, alcanzados]
  )

  return mapNotificacion(rows[0])
}

/** Lista las notificaciones del usuario, mas recientes primero. */
export async function listarNotificaciones(
  usuarioId: string,
  limite = 50
): Promise<Notificacion[]> {
  const { rows } = await getPool().query<NotificacionRow>(
    `
      SELECT * FROM notificaciones
      WHERE usuario_id = $1
      ORDER BY creada_en DESC
      LIMIT $2
    `,
    [usuarioId, Math.min(Math.max(limite, 1), 200)]
  )
  return rows.map(mapNotificacion)
}

// ── Contexto del CIT ───────────────────────────────────────────────────────

interface CitContextoRow {
  cit_id: string
  numero_cit: string
  estado: string
  fecha_vencimiento: string | null
  bicicleta_id: string
  propietario_id: string
  marca: string
  modelo: string
}

/** Carga el CIT junto con su bicicleta y el dueno a notificar. */
async function cargarContextoCIT(citId: string): Promise<CitContextoRow> {
  const { rows } = await getPool().query<CitContextoRow>(
    `
      SELECT
        c.id                AS cit_id,
        c.numero_cit        AS numero_cit,
        c.estado            AS estado,
        c.fecha_vencimiento AS fecha_vencimiento,
        b.id                AS bicicleta_id,
        b.propietario_id    AS propietario_id,
        b.marca             AS marca,
        b.modelo            AS modelo
      FROM cits c
      JOIN bicicletas b ON b.id = c.bicicleta_id
      WHERE c.id = $1
    `,
    [citId]
  )

  const row = rows[0]
  if (!row) {
    throw new ApiError(404, 'CIT_NOT_FOUND', 'El CIT no existe.')
  }
  return row
}

// ── Disparador: CIT aprobado ─────────────────────────────────────────────

export async function notificarCITAprobado(citId: string): Promise<Notificacion | null> {
  const cit = await cargarContextoCIT(citId)
  return enviarNotificacion({
    usuarioId: cit.propietario_id,
    tipo: 'CIT_APROBADO',
    titulo: 'Tu CIT fue aprobado',
    cuerpo: `El certificado de tu ${cit.marca} ${cit.modelo} (${cit.numero_cit}) ya esta activo.`,
    citId: cit.cit_id,
    bicicletaId: cit.bicicleta_id,
    data: { numeroCIT: cit.numero_cit },
  })
}

// ── Disparador: CIT rechazado ────────────────────────────────────────────

export async function notificarCITRechazado(
  citId: string,
  motivo?: string | null
): Promise<Notificacion | null> {
  const cit = await cargarContextoCIT(citId)
  const detalle = motivo?.trim()
  return enviarNotificacion({
    usuarioId: cit.propietario_id,
    tipo: 'CIT_RECHAZADO',
    titulo: 'Tu CIT fue rechazado',
    cuerpo: detalle
      ? `El certificado de tu ${cit.marca} ${cit.modelo} fue rechazado: ${detalle}`
      : `El certificado de tu ${cit.marca} ${cit.modelo} fue rechazado. Revisa los datos y volve a intentarlo.`,
    citId: cit.cit_id,
    bicicletaId: cit.bicicleta_id,
    data: { numeroCIT: cit.numero_cit, motivo: detalle ?? null },
  })
}

// ── Disparador: alerta de robo ───────────────────────────────────────────

export async function notificarAlertaRobo(input: {
  bicicletaId: string
  detalle?: string | null
}): Promise<Notificacion | null> {
  const { rows } = await getPool().query<{
    id: string
    propietario_id: string
    marca: string
    modelo: string
  }>(
    `SELECT id, propietario_id, marca, modelo FROM bicicletas WHERE id = $1`,
    [input.bicicletaId]
  )

  const bici = rows[0]
  if (!bici) {
    throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta no existe.')
  }

  const detalle = input.detalle?.trim()
  return enviarNotificacion({
    usuarioId: bici.propietario_id,
    tipo: 'ALERTA_ROBO',
    titulo: 'Alerta de robo registrada',
    cuerpo: detalle
      ? `Tu ${bici.marca} ${bici.modelo} fue reportada como robada: ${detalle}`
      : `Tu ${bici.marca} ${bici.modelo} fue reportada como robada. Activamos la alerta en la red RODAID.`,
    bicicletaId: bici.id,
    data: { detalle: detalle ?? null },
  })
}

// ── Disparador: vencimiento proximo (arbol de decision) ──────────────────

interface CitPorVencerRow {
  cit_id: string
  numero_cit: string
  estado: string
  fecha_vencimiento: string
  bicicleta_id: string
  propietario_id: string
  marca: string
  modelo: string
}

export interface ResultadoEscaneoVencimientos {
  evaluados: number
  alertados: number
  cits: Array<{ citId: string; numeroCIT: string; diasRestantes: number | null }>
}

/**
 * Arbol de decision del CIT — barrido programado.
 *
 * Recorre los CIT activos cuya fecha de vencimiento cae dentro de la franja de
 * menos de DIAS_UMBRAL_VENCIMIENTO (60) dias y que todavia no fueron alertados,
 * confirma con `evaluarVencimientoCIT` que entraron en la zona "proximo a
 * vencer" y dispara la alerta de vencimiento. El indice unico parcial sobre
 * `notificaciones` garantiza una sola alerta por CIT.
 *
 * Pensado para ejecutarse como tarea programada (requiere x-admin-token).
 */
export async function escanearVencimientosProximos(
  limite = 200
): Promise<ResultadoEscaneoVencimientos> {
  const { rows } = await getPool().query<CitPorVencerRow>(
    `
      SELECT
        c.id                AS cit_id,
        c.numero_cit        AS numero_cit,
        c.estado            AS estado,
        c.fecha_vencimiento AS fecha_vencimiento,
        b.id                AS bicicleta_id,
        b.propietario_id    AS propietario_id,
        b.marca             AS marca,
        b.modelo            AS modelo
      FROM cits c
      JOIN bicicletas b ON b.id = c.bicicleta_id
      WHERE c.estado = 'ACTIVO'
        AND c.fecha_vencimiento IS NOT NULL
        AND c.fecha_vencimiento > NOW()
        AND c.fecha_vencimiento <= NOW() + ($1 || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM notificaciones n
          WHERE n.cit_id = c.id AND n.tipo = 'VENCIMIENTO_PROXIMO'
        )
      ORDER BY c.fecha_vencimiento ASC
      LIMIT $2
    `,
    [String(DIAS_UMBRAL_VENCIMIENTO), limite]
  )

  const alertados: ResultadoEscaneoVencimientos['cits'] = []

  for (const cit of rows) {
    // Reconfirmar la decision con la logica pura antes de notificar.
    const evaluacion = evaluarVencimientoCIT({
      estado: cit.estado,
      fechaVencimiento: cit.fecha_vencimiento,
    })
    if (!evaluacion.requiereAlerta) {
      continue
    }

    const dias = evaluacion.diasRestantes ?? diasHastaVencimiento(cit.fecha_vencimiento)

    try {
      const notificacion = await enviarNotificacion({
        usuarioId: cit.propietario_id,
        tipo: 'VENCIMIENTO_PROXIMO',
        titulo: 'Tu CIT esta proximo a vencer',
        cuerpo:
          dias !== null && dias >= 0
            ? `El CIT de tu ${cit.marca} ${cit.modelo} vence en ${dias} dia(s). Renovalo para mantenerlo activo.`
            : `El CIT de tu ${cit.marca} ${cit.modelo} esta proximo a vencer. Renovalo para mantenerlo activo.`,
        citId: cit.cit_id,
        bicicletaId: cit.bicicleta_id,
        data: { numeroCIT: cit.numero_cit, diasRestantes: dias },
        dedupeVencimiento: true,
      })

      if (notificacion) {
        alertados.push({
          citId: cit.cit_id,
          numeroCIT: cit.numero_cit,
          diasRestantes: dias,
        })
      }
    } catch (error) {
      console.error('[notificaciones] fallo la alerta de vencimiento para', cit.cit_id, error)
    }
  }

  return { evaluados: rows.length, alertados: alertados.length, cits: alertados }
}
