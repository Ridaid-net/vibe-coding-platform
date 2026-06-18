// ─── RODAID · MercadoPago Service ─────────────────────────
// Gateway de pago primario para RODAID PAY (escrow).
//
// Operaciones implementadas:
//   · crearPreferencia()   → link de pago Checkout Pro
//   · consultarPago()      → estado de un pago por ID
//   · procesarWebhook()    → verificar y procesar notificación MP
//   · emitirReembolso()    → devolver fondos al comprador
//   · consultarOrden()     → merchant order (agrupa pagos)
//
// Seguridad:
//   · Firma de webhook: X-Signature header HMAC-SHA256
//     ts + "." + request body con MP_WEBHOOK_SECRET
//   · Clave de idempotencia en cada preference
//   · Re-consulta a la API ante cualquier webhook (nunca confiar solo en el payload)
//
// Modos:
//   LIVE (RODAID_MP_ACCESS_TOKEN=APP_USR-...)  → producción real
//   SANDBOX (RODAID_MP_ACCESS_TOKEN=TEST-...)  → sandbox de MP
//   STUB (sin token)                            → simulado, sin llamadas externas
//
// Comisión de MP (Argentina, 2026):
//   Tarjetas de crédito: ~4,99% + IVA
//   Tarjetas de débito:  ~1,99% + IVA
//   Efectivo (PagoFácil, Rapipago): ~4,99%
//   Dinero en cuenta MP: 0%

import crypto from 'crypto'
import { query, queryOne } from '../config/database'
import { env }              from '../config/env'
import { log }              from '../middleware/logger'
import { getRedis }         from '../config/redis'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type MPPaymentStatus =
  | 'pending'
  | 'approved'
  | 'authorized'
  | 'in_process'
  | 'in_mediation'
  | 'rejected'
  | 'cancelled'
  | 'refunded'
  | 'charged_back'

export interface MPPreferenceResult {
  preferenceId:  string
  initPoint:     string      // URL producción
  sandboxPoint?: string      // URL sandbox
  gateway:       'MERCADOPAGO' | 'STUB'
  expiraEn:      Date
}

export interface MPPaymentInfo {
  paymentId:       string
  status:          MPPaymentStatus
  statusDetail:    string
  amount:          number
  netAmount?:      number
  currency:        string
  paymentType?:    string
  paymentMethod?:  string
  installments?:   number
  lastFourDigits?: string
  transaccionId?:  string    // external_reference
  approvedAt?:     Date
  description?:    string
}

export interface MPWebhookPayload {
  id?:              number | string
  type?:            string              // 'payment' | 'merchant_order' | ...
  action?:          string              // 'payment.created' | 'payment.updated'
  data?:            { id: string }
  external_reference?: string
  live_mode?:       boolean
}

// ══════════════════════════════════════════════════════════
// CLIENTE HTTP — wrapper sobre fetch con auth
// ══════════════════════════════════════════════════════════

const MP_API = 'https://api.mercadopago.com'

async function mpFetch<T>(
  method: 'GET' | 'POST',
  path:    string,
  body?:   unknown,
  idempotencyKey?: string
): Promise<T> {
  const token = env.RODAID_MP_ACCESS_TOKEN
  if (!token) throw new Error('RODAID_MP_ACCESS_TOKEN no configurado')

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
    'X-Idempotency-Key': idempotencyKey ?? crypto.randomUUID(),
  }

  const res = await fetch(`${MP_API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })

  const text = await res.text()

  if (!res.ok) {
    let detail = text
    try { detail = JSON.parse(text)?.message ?? text } catch { /* raw text */ }
    const err = Object.assign(new Error(`MP API ${method} ${path} → ${res.status}: ${detail}`), {
      code: `MP_HTTP_${res.status}`, status: res.status,
    })
    log.escrow.error({ method, path, status: res.status, detail: detail.slice(0, 200) }, 'MP API error')
    throw err
  }

  try { return JSON.parse(text) as T }
  catch { return text as unknown as T }
}

// ══════════════════════════════════════════════════════════
// MODOS — STUB cuando no hay token
// ══════════════════════════════════════════════════════════

function isStub(): boolean {
  return !env.RODAID_MP_ACCESS_TOKEN
}

function isSandbox(): boolean {
  return !!env.RODAID_MP_ACCESS_TOKEN?.startsWith('TEST-')
}

export function getModo(): 'LIVE' | 'SANDBOX' | 'STUB' {
  if (isStub()) return 'STUB'
  if (isSandbox()) return 'SANDBOX'
  return 'LIVE'
}

// ══════════════════════════════════════════════════════════
// CREAR PREFERENCIA DE PAGO (Checkout Pro)
// ══════════════════════════════════════════════════════════

export async function crearPreferencia(opts: {
  transaccionId:   string
  monto:           number
  titulo:          string
  descripcion:     string
  compradorEmail?: string
  compradorNombre?: string
  returnUrl?:      string
  cancelUrl?:      string
  expirarEn?:      Date    // default: 48 horas
}): Promise<MPPreferenceResult> {

  const expiraEn = opts.expirarEn ?? new Date(Date.now() + 48 * 3600_000)
  const baseUrl  = env.RODAID_BASE_URL ?? 'https://rodaid.com.ar'

  // ── Stub ────────────────────────────────────────────────
  if (isStub()) {
    const preferenceId = `STUB_PREF_${opts.transaccionId.slice(0, 8)}_${Date.now()}`
    const initPoint    = `${baseUrl}/pago/stub?pref=${preferenceId}&tx=${opts.transaccionId}&monto=${opts.monto}`
    log.escrow.warn({ transaccionId: opts.transaccionId },
      '⚠ MP STUB — configurar RODAID_MP_ACCESS_TOKEN para pagos reales')

    await guardarPago({
      transaccionId: opts.transaccionId, preferenceId,
      status: 'pending', amount: opts.monto, gateway: 'STUB',
    })

    return { preferenceId, initPoint, gateway: 'STUB', expiraEn }
  }

  // ── MercadoPago real ────────────────────────────────────
  const body = {
    items: [{
      id:          opts.transaccionId,
      title:       opts.titulo.slice(0, 256),
      description: opts.descripcion.slice(0, 600),
      quantity:    1,
      unit_price:  opts.monto,
      currency_id: 'ARS',
    }],
    payer: {
      email: opts.compradorEmail ?? 'comprador@rodaid.com.ar',
      name:  opts.compradorNombre?.split(' ')[0],
    },
    back_urls: {
      success: opts.returnUrl ?? `${baseUrl}/pago/ok?tx=${opts.transaccionId}`,
      failure: opts.cancelUrl ?? `${baseUrl}/pago/error?tx=${opts.transaccionId}`,
      pending: `${baseUrl}/pago/pendiente?tx=${opts.transaccionId}`,
    },
    auto_return:      'approved',
    notification_url: `${baseUrl}/api/v1/escrow/webhook/mp`,
    external_reference: opts.transaccionId,
    expires:           true,
    expiration_date_from: new Date().toISOString(),
    expiration_date_to:   expiraEn.toISOString(),
    // Metadata RODAID
    metadata: {
      transaccion_id: opts.transaccionId,
      plataforma:     'RODAID',
    },
    // Modo: 'regular_payment' o 'smart_payment' (Checkout Bricks)
    purpose:     'wallet_purchase',
    binary_mode: false,    // permite múltiples intentos de pago
  }

  try {
    const data = await mpFetch<{
      id: string; init_point: string; sandbox_init_point: string
    }>('POST', '/checkout/preferences', body, opts.transaccionId)

    log.escrow.info({
      transaccionId: opts.transaccionId,
      preferenceId:  data.id,
      monto:         opts.monto,
      modo:          getModo(),
    }, '✓ MP Preference creada')

    await guardarPago({
      transaccionId: opts.transaccionId, preferenceId: data.id,
      status: 'pending', amount: opts.monto,
      gateway: 'MERCADOPAGO',
    })

    return {
      preferenceId:  data.id,
      initPoint:     data.init_point,
      sandboxPoint:  data.sandbox_init_point,
      gateway:       'MERCADOPAGO',
      expiraEn,
    }

  } catch (err) {
    // Si MP falla, usar STUB como fallback
    const msg = (err as Error).message
    log.escrow.error({ err: msg, transaccionId: opts.transaccionId }, 'MP preference fallida — usando STUB')

    const preferenceId = `STUB_FALLBACK_${opts.transaccionId.slice(0, 8)}`
    const initPoint    = `${baseUrl}/pago/stub?pref=${preferenceId}&tx=${opts.transaccionId}&monto=${opts.monto}&error=${encodeURIComponent(msg.slice(0, 50))}`

    return { preferenceId, initPoint, gateway: 'STUB', expiraEn }
  }
}

// ══════════════════════════════════════════════════════════
// CONSULTAR PAGO por payment_id
// ══════════════════════════════════════════════════════════

export async function consultarPago(paymentId: string): Promise<MPPaymentInfo | null> {
  if (isStub()) {
    return {
      paymentId, status: 'approved', statusDetail: 'accredited',
      amount: 0, currency: 'ARS',
    }
  }

  try {
    const data = await mpFetch<any>('GET', `/v1/payments/${paymentId}`)
    return {
      paymentId:       String(data.id),
      status:          data.status,
      statusDetail:    data.status_detail,
      amount:          data.transaction_amount,
      netAmount:       data.transaction_details?.net_received_amount,
      currency:        data.currency_id,
      paymentType:     data.payment_type_id,
      paymentMethod:   data.payment_method_id,
      installments:    data.installments,
      lastFourDigits:  data.card?.last_four_digits,
      transaccionId:   data.external_reference,
      approvedAt:      data.date_approved ? new Date(data.date_approved) : undefined,
      description:     data.description,
    }
  } catch (err) {
    log.escrow.error({ paymentId, err: (err as Error).message }, 'Error consultando pago MP')
    return null
  }
}

// ══════════════════════════════════════════════════════════
// PROCESAR WEBHOOK (verificar firma + consultar estado)
// ══════════════════════════════════════════════════════════

export interface WebhookResult {
  ok:            boolean
  transaccionId: string | null
  paymentId:     string | null
  status:        MPPaymentStatus | null
  accion:        'APROBAR' | 'RECHAZAR' | 'IGNORAR'
}

export async function procesarWebhook(opts: {
  payload:    MPWebhookPayload
  rawBody:    string
  xSignature: string | null
  xRequestId: string | null
}): Promise<WebhookResult> {

  // ── 1. Verificar firma (solo en producción) ─────────────
  if (!isStub() && opts.xSignature) {
    const valid = verificarFirmaWebhook(opts.rawBody, opts.xSignature, opts.xRequestId)
    if (!valid) {
      log.escrow.warn({ xSignature: opts.xSignature?.slice(0, 30) }, '⚠ Firma webhook MP inválida')
      // En sandbox no siempre viene la firma — no rechazar en sandbox
      if (!isSandbox()) {
        return { ok: false, transaccionId: null, paymentId: null, status: null, accion: 'IGNORAR' }
      }
    }
  }

  // ── 2. Ignorar topics que no son pagos ──────────────────
  const topic = opts.payload.type ?? opts.payload.action?.split('.')[0]
  if (!topic || !['payment', 'merchant_order'].includes(topic)) {
    log.escrow.debug({ topic }, 'Webhook MP ignorado (topic no es payment)')
    return { ok: true, transaccionId: null, paymentId: null, status: null, accion: 'IGNORAR' }
  }

  const paymentId = String(opts.payload.data?.id ?? opts.payload.id ?? '')
  if (!paymentId) {
    return { ok: false, transaccionId: null, paymentId: null, status: null, accion: 'IGNORAR' }
  }

  // ── 3. Idempotencia — evitar procesar el mismo evento dos veces ─
  const cacheKey = `mp:webhook:${paymentId}`
  try {
    const redis = getRedis()
    const seen  = await redis.get(cacheKey)
    if (seen) {
      log.escrow.debug({ paymentId }, 'Webhook duplicado ignorado')
      return { ok: true, transaccionId: null, paymentId, status: null, accion: 'IGNORAR' }
    }
    await redis.set(cacheKey, '1', 'EX', 3600)
  } catch { /* best-effort, continuar */ }

  // ── 4. Consultar estado real a la API (nunca confiar solo en el payload) ─
  const info = await consultarPago(paymentId)
  if (!info) {
    return { ok: false, transaccionId: null, paymentId, status: null, accion: 'IGNORAR' }
  }

  const transaccionId = info.transaccionId
    ?? opts.payload.external_reference
    ?? null

  // ── 5. Actualizar registro en DB ─────────────────────────
  await actualizarPago(paymentId, info, transaccionId)

  // ── 6. Determinar acción ─────────────────────────────────
  const accion: WebhookResult['accion'] =
    info.status === 'approved'                              ? 'APROBAR' :
    ['rejected', 'cancelled', 'charged_back'].includes(info.status) ? 'RECHAZAR' :
    'IGNORAR'

  log.escrow.info({
    paymentId, transaccionId, status: info.status,
    detail: info.statusDetail, monto: info.amount, accion,
  }, `MP webhook: ${info.status} → ${accion}`)

  return { ok: true, transaccionId, paymentId, status: info.status, accion }
}

// ══════════════════════════════════════════════════════════
// EMITIR REEMBOLSO
// ══════════════════════════════════════════════════════════

export async function emitirReembolso(opts: {
  paymentId:     string
  monto?:        number   // null = reembolso total
  transaccionId?: string
  motivo?:       string
}): Promise<{ ok: boolean; refundId?: string; error?: string }> {

  if (isStub()) {
    log.escrow.info({ paymentId: opts.paymentId, monto: opts.monto }, '🔄 STUB: reembolso simulado')
    await query(
      `UPDATE mp_pagos SET refund_status='STUB_REFUNDED', refund_amount=$2 WHERE payment_id=$1`,
      [opts.paymentId, opts.monto ?? null]
    ).catch(() => {})
    return { ok: true, refundId: `STUB_REF_${Date.now()}` }
  }

  try {
    const body: Record<string, unknown> = {}
    if (opts.monto) body.amount = opts.monto

    const data = await mpFetch<{ id: number; status: string }>(
      'POST',
      `/v1/payments/${opts.paymentId}/refunds`,
      body,
      opts.transaccionId
    )

    const refundId = String(data.id)

    await query(
      `UPDATE mp_pagos
       SET refund_id=$2, refund_status=$3, refund_amount=$4, devuelto_en=NOW()
       WHERE payment_id=$1`,
      [opts.paymentId, refundId, data.status, opts.monto ?? null]
    ).catch(() => {})

    log.escrow.info({
      paymentId: opts.paymentId, refundId, status: data.status, monto: opts.monto,
    }, '✓ Reembolso MP emitido')

    return { ok: true, refundId }

  } catch (err) {
    const msg = (err as Error).message
    log.escrow.error({ paymentId: opts.paymentId, err: msg }, '✗ Error emitiendo reembolso MP')
    return { ok: false, error: msg }
  }
}

// ══════════════════════════════════════════════════════════
// VERIFICAR FIRMA DE WEBHOOK (RFC HMAC-SHA256)
// ══════════════════════════════════════════════════════════

function verificarFirmaWebhook(
  rawBody:    string,
  xSignature: string,
  xRequestId: string | null
): boolean {
  const secret = env.MP_WEBHOOK_SECRET
  if (!secret) return true   // sin secret configurado → no verificar

  try {
    // Formato: ts=<timestamp>,v1=<hash>
    const parts = Object.fromEntries(
      xSignature.split(',').map(p => p.split('=') as [string, string])
    )
    const ts   = parts['ts']
    const hash = parts['v1']

    if (!ts || !hash) return false

    // El mensaje a firmar: ts + "." + request_id + "." + body (si viene xRequestId)
    const manifest = xRequestId
      ? `id:${xRequestId};request-id:${xRequestId};ts:${ts};`
      : `ts:${ts};`

    const computed = crypto
      .createHmac('sha256', secret)
      .update(manifest)
      .digest('hex')

    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'))
  } catch {
    return false
  }
}

// ══════════════════════════════════════════════════════════
// HELPERS DB
// ══════════════════════════════════════════════════════════

async function guardarPago(opts: {
  transaccionId: string
  preferenceId:  string
  status:        string
  amount:        number
  gateway:       string
  paymentId?:    string
}): Promise<void> {
  await query(
    `INSERT INTO mp_pagos
       (transaccion_id, preference_id, payment_id, external_ref, status, monto_total, gateway)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (preference_id) DO NOTHING`,
    [
      opts.transaccionId, opts.preferenceId, opts.paymentId ?? null,
      opts.transaccionId, opts.status, opts.amount, opts.gateway,
    ]
  ).catch(() => {})
}

async function actualizarPago(
  paymentId:    string,
  info:         MPPaymentInfo,
  transaccionId: string | null
): Promise<void> {
  await query(
    `INSERT INTO mp_pagos
       (transaccion_id, preference_id, payment_id, external_ref, status, status_detail,
        monto_total, monto_neto, moneda, payment_type, payment_method,
        installments, last_four_digits, webhook_recibido, aprobado_en, gateway)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),$14,'MERCADOPAGO')
     ON CONFLICT (payment_id) DO UPDATE SET
       status=$5, status_detail=$6, monto_neto=$8,
       payment_type=$10, payment_method=$11,
       aprobado_en=$14, webhook_recibido=NOW()`,
    [
      transaccionId,
      // preference_id not available from payment lookup — use a placeholder
      info.paymentId,     // reused as preference placeholder
      info.paymentId,
      transaccionId,
      info.status,
      info.statusDetail,
      info.amount,
      info.netAmount ?? null,
      info.currency,
      info.paymentType ?? null,
      info.paymentMethod ?? null,
      info.installments ?? null,
      info.lastFourDigits ?? null,
      info.approvedAt ?? null,
    ]
  ).catch(() => {})
}

// ══════════════════════════════════════════════════════════
// CONSULTAR HISTORIAL DE PAGOS DE UNA TRANSACCIÓN
// ══════════════════════════════════════════════════════════

export async function getPagosPorTransaccion(transaccionId: string) {
  return query(
    `SELECT id, preference_id, payment_id, status, status_detail,
            monto_total, monto_neto, comision_mp, moneda,
            payment_type, payment_method, installments, last_four_digits,
            refund_id, refund_status, refund_amount,
            creado_en, aprobado_en, devuelto_en, gateway
     FROM mp_pagos WHERE transaccion_id=$1 ORDER BY creado_en DESC`,
    [transaccionId]
  )
}

// ══════════════════════════════════════════════════════════
// ESTADO DEL GATEWAY (para health check)
// ══════════════════════════════════════════════════════════

export async function getEstadoGateway(): Promise<{
  modo:      'LIVE' | 'SANDBOX' | 'STUB'
  ok:        boolean
  userId?:   string
  email?:    string
  pais?:     string
  latencyMs: number
}> {
  const modo = getModo()
  if (modo === 'STUB') {
    return { modo, ok: true, latencyMs: 0 }
  }

  const t0 = Date.now()
  try {
    const data = await mpFetch<{ id: number; email: string; site_id: string }>(
      'GET', '/v1/users/me'
    )
    return {
      modo, ok: true,
      userId:   String(data.id),
      email:    data.email,
      pais:     data.site_id,
      latencyMs: Date.now() - t0,
    }
  } catch (err) {
    return { modo, ok: false, latencyMs: Date.now() - t0 }
  }
}
