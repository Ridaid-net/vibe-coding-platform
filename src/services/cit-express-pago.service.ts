import { randomUUID, createHash, createHmac } from 'node:crypto'
import { ApiError, getPool } from '@/lib/marketplace'
import {
  buscarPagosPorExternalReference,
  consultarPago,
  crearPreferencia,
  getModo,
} from '@/src/services/mercadopago.service'
import { getParametroPricing } from '@/src/services/parametros-pricing.service'
import { encolarValidacion, procesarJob } from '@/src/services/validation.service'

/**
 * RODAID — Cobro real del CIT Express.
 *
 * Hasta este servicio, POST /api/v1/bicicletas/[id]/verificar emitia el CIT
 * gratis (ver CLAUDE.md, hallazgo CRITICO 2026-07-13). Regla de negocio
 * confirmada por Federico: el pago se cobra ANTES de iniciar el tramite -- si
 * no paga, no debe existir ni siquiera una fila en `cits` todavia.
 *
 * Flujo (mismo patron que denuncia-mpf.service.ts para su tarifa paga):
 *   solicitarCitExpressConPago() -> crea/reanuda una fila en
 *     solicitudes_cit_express ('pago_pendiente') + preferencia de MercadoPago.
 *     NO toca `cits` todavia.
 *   webhookPagoCitExpress()      -> re-consulta el pago contra la API real de
 *     MercadoPago (nunca confia en el payload del webhook). Si 'approved',
 *     RECIEN ACA se crea el CIT real y se encola en el pipeline de 72hs (lo
 *     que hoy hacia POST /verificar de forma inmediata y gratuita).
 *
 * Nombre distinto de src/services/cit-express.service.ts a proposito: ese
 * archivo ya existe y es un modulo DISTINTO (clasificarNivelCIT, la
 * clasificacion AMARILLO/ROJO por cross-reference de Fase 2) -- confirmado
 * que no tiene ningun llamador real todavia (mismo patron de "diseñado pero
 * no conectado" que el propio cobro que este archivo resuelve; queda anotado
 * en CLAUDE.md como hallazgo aparte, no se toca en esta pasada).
 */

const EXPIRACION_SOLICITUD_MS = 48 * 60 * 60 * 1000 // igual a EXPIRACION_MS de mercadopago.service.ts

export interface SolicitudCitExpressPago {
  solicitudId: string
  estado: 'pago_pendiente'
  montoARS: number
  preferenceId: string
  initPoint: string
  sandboxPoint: string | null
  gateway: string
  reanudada: boolean
}

interface BiciRow {
  id: string
  propietario_id: string
  numero_serie: string
}

interface SolicitudPendienteRow {
  id: string
  monto_ars: string
  fee_preference_id: string | null
  fee_init_point: string | null
  created_at: string
}

/**
 * Primer paso: crea (o reanuda) la solicitud de pago del CIT Express. Nunca
 * toca `cits` -- eso ocurre recien en webhookPagoCitExpress() al confirmarse
 * el pago.
 */
export async function solicitarCitExpressConPago(input: {
  bicicletaId: string
  ciclistaId: string
  ciclistaEmail?: string | null
  ciclistaNombre?: string | null
}): Promise<SolicitudCitExpressPago> {
  const pool = getPool()

  const biciRes = await pool.query<BiciRow>(
    `SELECT id, propietario_id, numero_serie FROM bicicletas WHERE id = $1`,
    [input.bicicletaId]
  )
  const bici = biciRes.rows[0]
  if (!bici) {
    throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta indicada no existe.')
  }
  if (bici.propietario_id !== input.ciclistaId) {
    throw new ApiError(403, 'NOT_OWNER', 'No sos el propietario de esta bicicleta.')
  }

  // Si ya hay un CIT activo y vigente, no hay nada que cobrar ni tramitar.
  const activoRes = await pool.query<{ id: string }>(
    `
      SELECT id FROM cits
      WHERE bicicleta_id = $1
        AND estado = 'activo'
        AND (fecha_vencimiento IS NULL OR fecha_vencimiento > NOW())
      LIMIT 1
    `,
    [bici.id]
  )
  if (activoRes.rows[0]) {
    throw new ApiError(
      409,
      'CIT_YA_ACTIVO',
      'Esta bicicleta ya tiene un CIT activo y vigente.'
    )
  }

  // Reanudar una solicitud pago_pendiente vigente (mismo criterio que el
  // resto del sistema: no duplicar cobro, reabrir el mismo checkout) --
  // idx_solicitudes_cit_express_pendiente_unica es la garantia real a nivel
  // de base; este chequeo evita el viaje redondo a MercadoPago cuando ya
  // sabemos que hay una vigente.
  const pendienteRes = await pool.query<SolicitudPendienteRow>(
    `
      SELECT id, monto_ars, fee_preference_id, fee_init_point, created_at
      FROM solicitudes_cit_express
      WHERE bicicleta_id = $1 AND estado = 'pago_pendiente'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [bici.id]
  )
  const pendiente = pendienteRes.rows[0]
  if (pendiente && pendiente.fee_init_point) {
    const vigente =
      Date.now() - new Date(pendiente.created_at).getTime() < EXPIRACION_SOLICITUD_MS
    if (vigente) {
      return {
        solicitudId: pendiente.id,
        estado: 'pago_pendiente',
        montoARS: Number(pendiente.monto_ars),
        preferenceId: pendiente.fee_preference_id ?? '',
        initPoint: pendiente.fee_init_point,
        sandboxPoint: null,
        gateway: gatewayLabel(),
        reanudada: true,
      }
    }
    // Vencida: se marca y se sigue de largo para crear una solicitud nueva.
    await pool.query(
      `UPDATE solicitudes_cit_express SET estado = 'vencida', updated_at = NOW() WHERE id = $1`,
      [pendiente.id]
    )
  }

  const montoARS = await getParametroPricing('cit_express_precio_ars')

  const solicitudId = randomUUID()
  await pool.query(
    `
      INSERT INTO solicitudes_cit_express (id, bicicleta_id, ciclista_id, estado, monto_ars)
      VALUES ($1, $2, $3, 'pago_pendiente', $4)
    `,
    [solicitudId, bici.id, input.ciclistaId, montoARS]
  )

  const preferencia = await crearPreferencia({
    transaccionId: solicitudId,
    titulo: `CIT Express — ${bici.numero_serie}`,
    descripcion:
      'Certificado de Identidad Tecnica (CIT Express): identidad basica, circulacion, 12 meses.',
    precioARS: montoARS,
    compradorEmail: input.ciclistaEmail,
    compradorNombre: input.ciclistaNombre,
    notificationPath: '/api/v1/cit-express/webhook/mp',
  })

  await pool.query(
    `
      UPDATE solicitudes_cit_express
      SET fee_preference_id = $2, fee_init_point = $3, updated_at = NOW()
      WHERE id = $1
    `,
    [solicitudId, preferencia.preferenceId, preferencia.initPoint]
  )

  return {
    solicitudId,
    estado: 'pago_pendiente',
    montoARS,
    preferenceId: preferencia.preferenceId,
    initPoint: preferencia.initPoint,
    sandboxPoint: preferencia.sandboxPoint,
    gateway: preferencia.gateway,
    reanudada: false,
  }
}

function gatewayLabel(): string {
  const modo = getModo()
  return modo === 'LIVE' ? 'mercadopago' : modo === 'SANDBOX' ? 'mercadopago_sandbox' : 'stub'
}

// ── Webhook: confirmacion real de pago ──────────────────────────────────────

export type AccionWebhookCitExpress = 'APROBADO' | 'RECHAZADO' | 'IGNORADO'

interface SolicitudRow {
  id: string
  bicicleta_id: string
  ciclista_id: string
  estado: string
  fee_payment_id: string | null
}

/**
 * Webhook de MercadoPago para el cobro del CIT Express. Re-consulta el pago
 * real (nunca confia en el payload) y, solo si 'approved', crea el CIT y
 * arranca el pipeline de 72hs -- lo que antes hacia POST /verificar de forma
 * inmediata y gratuita.
 */
export async function webhookPagoCitExpress(input: {
  paymentId: string
  externalReferenceHint?: string | null
}): Promise<{ accion: AccionWebhookCitExpress; solicitudId: string | null; citId?: string }> {
  const pago = await consultarPago(input.paymentId)
  const solicitudId = pago.externalReference ?? input.externalReferenceHint ?? null
  if (!solicitudId) {
    console.error(
      '[cit-express][webhook] no se pudo resolver la solicitud del pago (external_reference ausente)',
      { paymentId: input.paymentId, status: pago.status }
    )
    return { accion: 'IGNORADO', solicitudId: null }
  }

  const pool = getPool()
  const res = await pool.query<SolicitudRow>(
    `SELECT id, bicicleta_id, ciclista_id, estado, fee_payment_id FROM solicitudes_cit_express WHERE id = $1`,
    [solicitudId]
  )
  const solicitud = res.rows[0]
  if (!solicitud) {
    console.error(
      '[cit-express][webhook] el pago resuelve a una solicitud que no existe',
      { paymentId: input.paymentId, solicitudId, status: pago.status }
    )
    return { accion: 'IGNORADO', solicitudId: null }
  }

  if (pago.status === 'approved') {
    if (solicitud.estado !== 'pago_pendiente') {
      return { accion: 'IGNORADO', solicitudId }
    }
    if (solicitud.fee_payment_id === input.paymentId) {
      return { accion: 'IGNORADO', solicitudId }
    }

    const biciRes = await pool.query<{ numero_serie: string }>(
      `SELECT numero_serie FROM bicicletas WHERE id = $1`,
      [solicitud.bicicleta_id]
    )
    const numeroSerie = biciRes.rows[0]?.numero_serie
    if (!numeroSerie) {
      throw new ApiError(500, 'BICICLETA_NOT_FOUND', 'La bicicleta de la solicitud ya no existe.')
    }

    const citId = await crearCitPendienteYEncolar({
      bicicletaId: solicitud.bicicleta_id,
      ciclistaId: solicitud.ciclista_id,
      numeroSerie,
    })

    await pool.query(
      `
        UPDATE solicitudes_cit_express
        SET estado = 'pagada', fee_payment_id = $2, fee_pagado_en = NOW(),
            cit_id = $3, updated_at = NOW()
        WHERE id = $1
      `,
      [solicitudId, input.paymentId, citId]
    )

    return { accion: 'APROBADO', solicitudId, citId }
  }

  if (pago.status === 'rejected' || pago.status === 'cancelled') {
    // Se queda en pago_pendiente -- binary_mode:false permite reintentar
    // sobre el mismo fee_init_point (mismo criterio que denuncia-mpf.service.ts).
    return { accion: 'RECHAZADO', solicitudId }
  }

  return { accion: 'IGNORADO', solicitudId }
}

export interface EstadoSolicitudCitExpress {
  id: string
  ciclistaId: string
  estado: string
  montoARS: number
  feePaymentId: string | null
}

/**
 * Estado de una solicitud de pago del CIT Express -- usado por la pantalla de
 * resultado del checkout (app/checkout/resultado/page.tsx), que hasta ahora
 * solo sabia consultar escrow_transacciones (una tabla distinta) y por eso
 * mostraba "No pudimos confirmar el pago" para CUALQUIER pago de CIT Express,
 * tanto el flujo self-service de siempre como el nuevo de "Iniciar
 * Certificacion" -- bug real, encontrado 2026-07-21 probando ese flujo nuevo
 * de punta a punta por primera vez.
 */
export async function getEstadoSolicitudCitExpress(
  solicitudId: string
): Promise<EstadoSolicitudCitExpress | null> {
  const res = await getPool().query<{
    id: string
    ciclista_id: string
    estado: string
    monto_ars: string
    fee_payment_id: string | null
  }>(
    `SELECT id, ciclista_id, estado, monto_ars, fee_payment_id FROM solicitudes_cit_express WHERE id = $1`,
    [solicitudId]
  )
  const row = res.rows[0]
  if (!row) return null
  return {
    id: row.id,
    ciclistaId: row.ciclista_id,
    estado: row.estado,
    montoARS: Number(row.monto_ars),
    feePaymentId: row.fee_payment_id,
  }
}

/**
 * Re-consulta a MercadoPago el pago de una solicitud de CIT Express y reaplica
 * el estado -- mismo criterio que escrow.service.ts::refrescarPago(), pero a
 * diferencia de esa, acá `fee_payment_id` recien se completa cuando el webhook
 * ya proceso el pago (no antes), asi que si todavia no lo tenemos buscamos por
 * external_reference directo contra MercadoPago (buscarPagosPorExternalReference)
 * en vez de asumir que no hay nada que refrescar.
 */
export async function refrescarPagoCitExpress(
  solicitudId: string
): Promise<{ accion: AccionWebhookCitExpress | 'SIN_PAGO'; solicitud: EstadoSolicitudCitExpress | null }> {
  const solicitud = await getEstadoSolicitudCitExpress(solicitudId)
  if (!solicitud) {
    throw new ApiError(404, 'SOLICITUD_NOT_FOUND', 'La solicitud de CIT Express no existe.')
  }

  let paymentId = solicitud.feePaymentId
  if (!paymentId) {
    const pagos = await buscarPagosPorExternalReference(solicitudId)
    paymentId = pagos.find((p) => p.status === 'approved')?.paymentId ?? pagos[0]?.paymentId ?? null
  }
  if (!paymentId) {
    return { accion: 'SIN_PAGO', solicitud }
  }

  const resultado = await webhookPagoCitExpress({ paymentId, externalReferenceHint: solicitudId })
  return { accion: resultado.accion, solicitud: await getEstadoSolicitudCitExpress(solicitudId) }
}

/**
 * Crea el CIT en 'pendiente' y lo encola en el pipeline de 72hs -- misma
 * logica que antes vivia directo en POST /api/v1/bicicletas/[id]/verificar,
 * movida aca porque ahora solo debe ejecutarse tras confirmarse el pago.
 * Preserva el atajo de modo DEMO (procesar el job al instante, ventana
 * ignorada) para no romper el flujo de pruebas fuera de LIVE.
 */
async function crearCitPendienteYEncolar(input: {
  bicicletaId: string
  ciclistaId: string
  numeroSerie: string
}): Promise<string> {
  const pool = getPool()
  const codigoCit = generarCodigoCit(input.numeroSerie)

  const insert = await pool.query<{ id: string }>(
    `
      INSERT INTO cits (
        bicicleta_id, ciclista_id, aliado_id, bicicleta_serial, estado, codigo_cit,
        metadata_json, huella_sha256, firma_hmac, algoritmo, snapshot_canonico,
        sellado_en, expira_en, inspeccion
      )
      VALUES ($1, $4, $4, $5, 'pendiente'::cit_estado, $2, $3::jsonb, $6, $7, 'SHA256',
              $8::jsonb, NOW(), NOW() + INTERVAL '1 year', '[]'::jsonb)
      RETURNING id
    `,
    [
      input.bicicletaId,
      codigoCit,
      JSON.stringify({ origen: 'solicitud_pagada', solicitadoPor: input.ciclistaId }),
      input.ciclistaId,
      input.numeroSerie,
      createHash('sha256').update(input.numeroSerie).digest('hex'),
      createHmac('sha256', process.env.JWT_SECRET ?? 'rodaid').update(input.numeroSerie).digest('hex'),
      JSON.stringify({
        bicicleta_id: input.bicicletaId,
        numero_serie: input.numeroSerie,
        solicitado_en: new Date().toISOString(),
      }),
    ]
  )
  const citId = insert.rows[0].id

  const job = await encolarValidacion(citId)

  // Mismo atajo de siempre: fuera de LIVE (o con el flag de demo explicito),
  // el pipeline corre al instante para no frenar las pruebas.
  if (getModo() !== 'LIVE' || process.env.RODAID_CIT_DEMO_MODE === 'true') {
    try {
      await procesarJob(job.id, { ignorarVentana: true })
    } catch (error) {
      // El CIT ya quedo creado y encolado igual: si el procesamiento inline
      // falla, el worker programado lo toma despues. Nunca hacer fallar la
      // confirmacion del pago por esto.
      console.error('[cit-express-pago] fallo el procesamiento inline en demo', error)
    }
  }

  return citId
}

function generarCodigoCit(numeroSerie: string): string {
  const base = numeroSerie
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
    .padEnd(6, 'X')
  const sufijo = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
  return `CIT-${base}-${sufijo}`
}
