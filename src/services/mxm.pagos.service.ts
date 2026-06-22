// ─── RODAID · MxM Pagos — Tasa CIT ──────────────────────
// Gestiona el pago de la tasa de certificación CIT (Ley 9556)
// a través del gateway oficial de Mendoza por Mí.
//
// Flujo completo:
//   1. POST /mxm/pagos  { citId?, bicicletaId }
//      → verificar identidad MxM nivel 2
//      → calcularTasa(bicicleta)
//      → mxmService.iniciarPago() → pagoId + linkPago
//      → INSERT mxm_pagos_cit (PENDIENTE)
//      → respuesta: { pagoId, linkPago, monto, expiraEn }
//
//   2. Usuario paga en el portal MxM
//
//   3. POST /mxm/pagos/webhook  (MxM notifica)
//      → verificar firma HMAC-SHA256
//      → UPDATE mxm_pagos_cit (CONFIRMADO | RECHAZADO)
//      → si CONFIRMADO: marcar cit.tasa_pagada=true
//
//   4. GET /mxm/pagos/:id  → estado actual del pago
//      (polling desde el frontend mientras espera confirmación)
//
// Modo STUB (sin MXM_PAGOS_URL):
//   → genera pagoId sintético, linkPago de simulación
//   → POST /mxm/pagos/stub/confirmar simula el webhook
//
// Tasa CIT (configurable via env):
//   RODAID_TASA_CIT_ARS=3000   (default: $ 3.000)
//   RODAID_TASA_EXENTO_LIBRE=0  (Plan Libre paga tasa completa)
//
// Descuentos por plan RODAID:
//   Plan Premium → 50% descuento en tasa CIT

import crypto from 'crypto'
import { featureDisponible } from './mxm.circuit.service'
import { query, queryOne }  from '../config/database'
import { mxmService, getMxMAccessToken } from './mxm.service'
import { getIdentidadMxM }  from './mxm.identidad.service'
import { AppError }         from '../middleware/errorHandler'
import { log }              from '../middleware/logger'
import { env }              from '../config/env'

// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════

/** Tasa base en ARS (configurable). Default: $3.000 */
const TASA_BASE_ARS = parseFloat(process.env.RODAID_TASA_CIT_ARS ?? '3000')

/** Descuento por plan (%): 0 = sin descuento, 50 = mitad de precio */
const DESCUENTO_POR_PLAN: Record<string, number> = {
  LIBRE:    0,
  ESTANDAR: 25,   // 25% off → $2.250
  PREMIUM:  50,   // 50% off → $1.500
}

/** Minutos antes de que expire el link de pago */
const EXPIRACION_MINUTOS = 30

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type EstadoPago =
  | 'PENDIENTE'
  | 'REDIRIGIDO'
  | 'CONFIRMADO'
  | 'RECHAZADO'
  | 'EXPIRADO'
  | 'CANCELADO'
  | 'ERROR'

export interface PagoCIT {
  id:             string
  usuarioId:      string
  citId?:         string
  bicicletaId?:   string
  concepto:       'TASA_CIT'
  montoARS:       number
  cuil?:          string
  mxmPagoId?:     string
  linkPago?:      string
  mxmReferencia?: string
  estado:         EstadoPago
  esStub:         boolean
  iniciadoEn:     Date
  confirmadoEn?:  Date
  expiraEn:       Date
}

// ══════════════════════════════════════════════════════════
// CALCULAR TASA
// ══════════════════════════════════════════════════════════

export function calcularTasa(planVendedor = 'LIBRE'): {
  montoARS:     number
  tasaBaseARS:  number
  descuentoPct: number
  descuentoARS: number
  plan:         string
} {
  const plan        = (planVendedor ?? 'LIBRE').toUpperCase()
  const descuentoPct = DESCUENTO_POR_PLAN[plan] ?? 0
  const descuentoARS = Math.round(TASA_BASE_ARS * descuentoPct / 100)
  const montoARS     = TASA_BASE_ARS - descuentoARS

  return { montoARS, tasaBaseARS: TASA_BASE_ARS, descuentoPct, descuentoARS, plan }
}

// ══════════════════════════════════════════════════════════
// INICIAR PAGO
// ══════════════════════════════════════════════════════════

export async function iniciarPago(opts: {
  usuarioId:   string
  citId?:      string
  bicicletaId?: string
  returnUrl?:  string
}): Promise<{
  pagoId:    string
  linkPago:  string
  montoARS:  number
  expiraEn:  Date
  esStub:    boolean
  estado:    EstadoPago
}> {

  // 1. Verificar identidad MxM nivel ≥ 2
  const identidad = await getIdentidadMxM(opts.usuarioId)
  if (!identidad.conectado) throw new AppError(
    'Debés conectar tu cuenta MxM antes de pagar la tasa CIT.',
    403, 'MXM_NOT_CONNECTED'
  )
  if (identidad.nivel < 2) throw new AppError(
    `Tu nivel MxM es ${identidad.nivel}. Se requiere Nivel 2 (verificación RENAPER) para emitir un CIT.`,
    403, 'MXM_NIVEL_INSUFICIENTE'
  )

  // 2. Verificar que no haya un pago vigente para este CIT
  if (opts.citId) {
    const pagoVigente = await queryOne<{ id: string; estado: string }>(
      `SELECT id, estado FROM mxm_pagos_cit
       WHERE cit_id=$1 AND estado IN ('PENDIENTE','REDIRIGIDO','CONFIRMADO')
       ORDER BY iniciado_en DESC LIMIT 1`,
      [opts.citId]
    )
    if (pagoVigente?.estado === 'CONFIRMADO') throw new AppError(
      'La tasa CIT ya fue pagada para esta certificación.',
      409, 'TASA_YA_PAGADA'
    )
    if (pagoVigente?.estado === 'REDIRIGIDO') throw new AppError(
      'Ya hay un pago en curso. Completá el pago en el link anterior o esperá que expire.',
      409, 'PAGO_EN_CURSO'
    )
  }

  // 3. Obtener plan del usuario para calcular descuento
  const usuario = await queryOne<{ plan_suscripcion: string | null }>(
    `SELECT plan_suscripcion FROM usuarios WHERE id=$1`, [opts.usuarioId]
  )
  const { montoARS, descuentoPct, plan } = calcularTasa(usuario?.plan_suscripcion ?? 'LIBRE')

  // 4. Obtener access token MxM para la llamada al gateway
  const accessToken = await getMxMAccessToken(opts.usuarioId)

  // 5. Llamar al gateway MxM (o STUB)
  const expiraEn   = new Date(Date.now() + EXPIRACION_MINUTOS * 60_000)
  const referencia = `RODAID-CIT-${Date.now()}`

  let mxmPagoId: string
  let linkPago:  string
  let esStub:    boolean

  try {
    if (accessToken && process.env.MXM_PAGOS_URL) {
      // ── LIVE: llamada real al gateway MxM ──────────────
      mxmPagoId = await mxmService.iniciarPago(accessToken, {
        concepto:     'TASA_CIT',
        montoARS,
        citId:        opts.citId ?? 'PENDIENTE',
        descripcion:  `RODAID: Tasa CIT Ley 9556 — ${referencia}`,
        usuarioCuil:  identidad.cuil ?? '',
      })

      // El gateway MxM devuelve la URL de pago como segundo parámetro
      // o se construye desde el pagoId. Ajustar cuando MxM confirme el esquema.
      linkPago = `${process.env.MXM_PAGOS_URL}/checkout/${mxmPagoId}?return=${encodeURIComponent(opts.returnUrl ?? process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar')}`
      esStub   = false

      log.mxm.info({ mxmPagoId, montoARS, referencia }, '✓ Pago MxM iniciado (LIVE)')

    } else {
      // ── STUB: simulación sin credenciales MxM reales ──
      mxmPagoId = `STUB_MXM_${crypto.randomBytes(8).toString('hex').toUpperCase()}`
      const frontendUrl = process.env.RODAID_FRONTEND_URL ?? 'http://localhost:5173'
      linkPago  = `${frontendUrl}/dev/mxm-pago-stub?pagoId=${mxmPagoId}&monto=${montoARS}&expira=${expiraEn.getTime()}`
      esStub    = true

      log.mxm.warn({ mxmPagoId, montoARS },
        '⚠ MxM Pagos STUB — configurar MXM_PAGOS_URL para pagos reales')
    }
  } catch (err) {
    const msg = (err as Error).message
    log.mxm.error({ err: msg, citId: opts.citId }, 'Error iniciando pago MxM')
    throw new AppError(`Error al iniciar pago en MxM: ${msg}`, 502, 'MXM_PAGO_ERROR')
  }

  // 6. Persistir en DB
  const row = await queryOne<{ id: string }>(
    `INSERT INTO mxm_pagos_cit
       (usuario_id, cit_id, bicicleta_id, concepto, monto_ars, cuil,
        mxm_pago_id, mxm_link_pago, mxm_referencia, estado, es_stub,
        expirado_en)
     VALUES ($1,$2,$3,'TASA_CIT',$4::numeric,$5,$6,$7,$8,'PENDIENTE',$9::boolean,$10)
     RETURNING id`,
    [
      opts.usuarioId, opts.citId ?? null, opts.bicicletaId ?? null,
      montoARS, identidad.cuil ?? null,
      mxmPagoId, linkPago, referencia, esStub, expiraEn,
    ]
  )

  log.mxm.info({
    pagoId: row!.id, usuarioId: opts.usuarioId, montoARS,
    plan, descuentoPct, esStub, expiraEn: expiraEn.toISOString(),
  }, `💳 Pago CIT iniciado: $${montoARS} ARS (${plan} ${descuentoPct ? `-${descuentoPct}%` : ''})`)

  return {
    pagoId:   row!.id,
    linkPago,
    montoARS,
    expiraEn,
    esStub,
    estado:   'PENDIENTE',
  }
}

// ══════════════════════════════════════════════════════════
// WEBHOOK (MxM notifica resultado)
// ══════════════════════════════════════════════════════════

export async function procesarWebhookPago(opts: {
  rawBody:    string
  xSignature: string | null
  payload:    Record<string, unknown>
}): Promise<{ ok: boolean; pagoId?: string; estado?: EstadoPago }> {

  // 1. Verificar firma HMAC-SHA256 si hay secret configurado
  let firmaOk = true
  const webhookSecret = process.env.MXM_WEBHOOK_SECRET
  if (webhookSecret && opts.xSignature) {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', webhookSecret)
      .update(opts.rawBody)
      .digest('hex')
    firmaOk = crypto.timingSafeEqual(
      Buffer.from(opts.xSignature),
      Buffer.from(expected)
    )
    if (!firmaOk) {
      log.mxm.error({ xSignature: opts.xSignature?.slice(0, 20) }, 'Firma webhook MxM inválida')
      return { ok: false }
    }
  }

  // 2. Extraer datos del payload
  const mxmPagoId = String(opts.payload.pagoId ?? opts.payload.id ?? '')
  const estadoMxM = String(opts.payload.estado ?? opts.payload.status ?? '')

  if (!mxmPagoId) {
    log.mxm.warn({ payload: opts.payload }, 'Webhook sin pagoId — ignorado')
    return { ok: true }
  }

  // 3. Idempotencia — ya procesado?
  const pago = await queryOne<{
    id: string; estado: string; cit_id: string | null
    usuario_id: string; monto_ars: string
  }>(
    `SELECT id, estado, cit_id, usuario_id, monto_ars
     FROM mxm_pagos_cit WHERE mxm_pago_id=$1`,
    [mxmPagoId]
  )

  if (!pago) {
    log.mxm.warn({ mxmPagoId }, 'Webhook: pago no encontrado')
    return { ok: true }  // 200 para que MxM no reintente
  }

  if (['CONFIRMADO','RECHAZADO','EXPIRADO'].includes(pago.estado)) {
    log.mxm.info({ pagoId: pago.id, estado: pago.estado }, 'Webhook idempotente — pago ya procesado')
    return { ok: true, pagoId: pago.id, estado: pago.estado as EstadoPago }
  }

  // 4. Determinar nuevo estado
  const estadoFinal = mapearEstadoMxM(estadoMxM)

  // Update in two steps to avoid ambiguous type inference for $2 in CASE
  await query(
    `UPDATE mxm_pagos_cit SET
       estado           = $2::text,
       webhook_payload  = $3::jsonb,
       webhook_firma_ok = $4::boolean,
       actualizado_en   = NOW()
     WHERE id=$1::uuid`,
    [pago.id, estadoFinal, JSON.stringify(opts.payload), firmaOk]
  )
  if (estadoFinal === 'CONFIRMADO') {
    await query(
      `UPDATE mxm_pagos_cit SET confirmado_en=NOW() WHERE id=$1::uuid AND confirmado_en IS NULL`,
      [pago.id]
    )
  }

  // 5. Si CONFIRMADO → marcar tasa pagada en el CIT
  if (estadoFinal === 'CONFIRMADO' && pago.cit_id) {
    await confirmarTasaEnCIT(pago.cit_id, pago.id)
  }

  log.mxm.info({
    pagoId: pago.id, mxmPagoId, estadoFinal, citId: pago.cit_id, firmaOk,
  }, `✓ Webhook MxM procesado: ${estadoFinal}`)

  return { ok: true, pagoId: pago.id, estado: estadoFinal }
}

/** Mapear el estado devuelto por MxM al enum interno */
function mapearEstadoMxM(estadoMxM: string): EstadoPago {
  const upper = estadoMxM.toUpperCase()
  const mapa: Record<string, EstadoPago> = {
    'PAGADO':     'CONFIRMADO',
    'APROBADO':   'CONFIRMADO',
    'APPROVED':   'CONFIRMADO',
    'CONFIRMED':  'CONFIRMADO',
    'RECHAZADO':  'RECHAZADO',
    'REJECTED':   'RECHAZADO',
    'FAILED':     'RECHAZADO',
    'EXPIRADO':   'EXPIRADO',
    'EXPIRED':    'EXPIRADO',
    'CANCELLED':  'CANCELADO',
    'CANCELADO':  'CANCELADO',
  }
  return mapa[upper] ?? 'ERROR'
}

/** Marcar el CIT como con tasa pagada */
async function confirmarTasaEnCIT(citId: string, pagoId: string): Promise<void> {
  await query(
    `UPDATE cits SET tasa_pagada=TRUE, tasa_pagada_en=NOW(), pago_id=$2 WHERE id=$1`,
    [citId, pagoId]
  )
  log.mxm.info({ citId, pagoId }, '✓ Tasa CIT marcada como pagada')
}

// ══════════════════════════════════════════════════════════
// STUB: simular confirmación (solo en dev/testing)
// ══════════════════════════════════════════════════════════

export async function stubConfirmarPago(pagoId: string): Promise<{
  estado: EstadoPago; citId?: string
}> {
  const pago = await queryOne<{ estado: string; cit_id: string | null; es_stub: boolean }>(
    `SELECT estado, cit_id, es_stub FROM mxm_pagos_cit WHERE id=$1`, [pagoId]
  )

  if (!pago) throw new AppError('Pago no encontrado', 404, 'PAGO_NOT_FOUND')
  if (!pago.es_stub && env.NODE_ENV === 'production')
    throw new AppError('Solo disponible en modo STUB', 400, 'NOT_STUB')
  if (pago.estado === 'CONFIRMADO')
    throw new AppError('Pago ya confirmado', 409, 'YA_CONFIRMADO')

  await query(
    `UPDATE mxm_pagos_cit SET estado='CONFIRMADO', confirmado_en=NOW(), actualizado_en=NOW() WHERE id=$1`,
    [pagoId]
  )

  if (pago.cit_id) await confirmarTasaEnCIT(pago.cit_id, pagoId)

  log.mxm.warn({ pagoId, citId: pago.cit_id }, '⚠ STUB: pago CIT confirmado manualmente')
  return { estado: 'CONFIRMADO', citId: pago.cit_id ?? undefined }
}

// ══════════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════════

export async function getPago(pagoId: string): Promise<PagoCIT | null> {
  const row = await queryOne<any>(
    `SELECT id, usuario_id, cit_id, bicicleta_id, concepto, monto_ars, cuil,
            mxm_pago_id, mxm_link_pago, mxm_referencia, estado, es_stub,
            iniciado_en, redirigido_en, confirmado_en, expirado_en
     FROM mxm_pagos_cit WHERE id=$1`,
    [pagoId]
  )
  if (!row) return null
  return mapRow(row)
}

export async function getPagoPorMxMId(mxmPagoId: string): Promise<PagoCIT | null> {
  const row = await queryOne<any>(
    `SELECT * FROM mxm_pagos_cit WHERE mxm_pago_id=$1`, [mxmPagoId]
  )
  return row ? mapRow(row) : null
}

export async function getPagosCIT(citId: string): Promise<PagoCIT[]> {
  const rows = await query<any>(
    `SELECT id, usuario_id, cit_id, bicicleta_id, concepto, monto_ars, cuil,
            mxm_pago_id, mxm_link_pago, mxm_referencia, estado, es_stub,
            iniciado_en, confirmado_en, expirado_en
     FROM mxm_pagos_cit WHERE cit_id=$1 ORDER BY iniciado_en DESC`,
    [citId]
  )
  return rows.map(mapRow)
}

export async function getPagosUsuario(usuarioId: string): Promise<PagoCIT[]> {
  const rows = await query<any>(
    `SELECT id, usuario_id, cit_id, bicicleta_id, concepto, monto_ars,
            mxm_pago_id, mxm_link_pago, estado, es_stub, iniciado_en, confirmado_en
     FROM mxm_pagos_cit WHERE usuario_id=$1 ORDER BY iniciado_en DESC LIMIT 20`,
    [usuarioId]
  )
  return rows.map(mapRow)
}

/** Marcar pagos expirados que pasaron su deadline */
export async function expirarPagosPendientes(): Promise<number> {
  const result = await query<{ id: string }>(
    `UPDATE mxm_pagos_cit SET estado='EXPIRADO', actualizado_en=NOW()
     WHERE estado IN ('PENDIENTE','REDIRIGIDO') AND expirado_en < NOW()
     RETURNING id`,
    []
  )
  if (result.length > 0) log.mxm.info({ count: result.length }, `${result.length} pagos MxM expirados`)
  return result.length
}

// Admin: estadísticas de pagos CIT
export async function getEstadisticasPagos(dias = 30): Promise<{
  total: number; confirmados: number; rechazados: number; pendientes: number
  volumenARS: number; tasaExitoARS: number
}> {
  const row = await queryOne<{
    total: string; conf: string; rech: string; pend: string; vol: string
  }>(
    `SELECT
       COUNT(*)::text                                           AS total,
       COUNT(*) FILTER (WHERE estado='CONFIRMADO')::text       AS conf,
       COUNT(*) FILTER (WHERE estado='RECHAZADO')::text        AS rech,
       COUNT(*) FILTER (WHERE estado IN ('PENDIENTE','REDIRIGIDO'))::text AS pend,
       COALESCE(SUM(monto_ars) FILTER (WHERE estado='CONFIRMADO'),0)::text AS vol
     FROM mxm_pagos_cit
     WHERE iniciado_en > NOW() - ($1 || ' days')::interval`,
    [dias]
  )
  const total = parseInt(row?.total ?? '0')
  const conf  = parseInt(row?.conf  ?? '0')
  return {
    total,
    confirmados: conf,
    rechazados:  parseInt(row?.rech ?? '0'),
    pendientes:  parseInt(row?.pend ?? '0'),
    volumenARS:  parseFloat(row?.vol ?? '0'),
    tasaExitoARS: total > 0 ? Math.round(conf / total * 100) : 0,
  }
}

// ── Helper privado ──────────────────────────────────────
function mapRow(row: any): PagoCIT {
  const expiraEn = row.expirado_en ? new Date(row.expirado_en) : new Date(Date.now() + EXPIRACION_MINUTOS * 60_000)
  return {
    id:             row.id,
    usuarioId:      row.usuario_id,
    citId:          row.cit_id ?? undefined,
    bicicletaId:    row.bicicleta_id ?? undefined,
    concepto:       'TASA_CIT',
    montoARS:       parseFloat(row.monto_ars),
    cuil:           row.cuil ?? undefined,
    mxmPagoId:      row.mxm_pago_id ?? undefined,
    linkPago:       row.mxm_link_pago ?? undefined,
    mxmReferencia:  row.mxm_referencia ?? undefined,
    estado:         row.estado as EstadoPago,
    esStub:         row.es_stub,
    iniciadoEn:     new Date(row.iniciado_en),
    confirmadoEn:   row.confirmado_en ? new Date(row.confirmado_en) : undefined,
    expiraEn,
  }
}
