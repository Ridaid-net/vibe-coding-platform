// ─── RODAID PAY · SDK MercadoPago ─────────────────────────
//
// Flujo completo usando el SDK oficial (@mercadopago/sdk-js v2)
//
//  ┌─────────────────────────────────────────────────────┐
//  │  1. POST /mp/sdk/preferencia                        │
//  │     crearPreferenciaPago()                          │
//  │     → SDK: new Preference(config).create()          │
//  │     → DB: INSERT pagos_mp estado=CREADO             │
//  │     → Retorna { initPoint, preferenceId }           │
//  ├─────────────────────────────────────────────────────┤
//  │  2. REDIRECT al frontend → cliente va a initPoint   │
//  │     MP Checkout abre en el browser del comprador    │
//  │     Comprador elige método de pago y confirma       │
//  ├─────────────────────────────────────────────────────┤
//  │  3. MP notifica vía back_urls (GET con query params)│
//  │     GET /mp/retorno?status=approved&payment_id=xxx  │
//  │     → actualizar estado en DB (no confiable)        │
//  ├─────────────────────────────────────────────────────┤
//  │  4. POST /webhooks/mp  ← MP notifica (fuente de     │
//  │     verdad del estado real del pago)                │
//  │     procesarWebhookSDK()                            │
//  │     → Verificar firma HMAC-SHA256                   │
//  │     → SDK: new Payment(config).get({id})            │
//  │     → DB: UPDATE pagos_mp estado=APROBADO           │
//  │     → Disparar consecuencias del negocio            │
//  └─────────────────────────────────────────────────────┘
//
// El webhook es la ÚNICA fuente de verdad del estado real.
// El back_url es solo para UX (redirigir al usuario).

import crypto              from 'crypto'
import {
  MercadoPagoConfig,
  Preference,
  Payment,
  MerchantOrder,
} from 'mercadopago'
import type { PreferenceRequest } from 'mercadopago/dist/clients/preference/commonTypes'
import { query, queryOne }  from '../config/database'
import { getRedis }         from '../config/redis'
import { log }              from '../middleware/logger'
import { AppError }         from '../middleware/errorHandler'
import { env }              from '../config/env'

// ══════════════════════════════════════════════════════════
// CONFIG SDK
// ══════════════════════════════════════════════════════════

const MODO_STUB    = !env.RODAID_MP_ACCESS_TOKEN
const MODO_SANDBOX = env.RODAID_MP_ACCESS_TOKEN?.startsWith('TEST-') ?? false
const COMISION_PCT = parseFloat(process.env.RODAID_MP_COMISION_PCT ?? '2.50')
const BASE_URL     = env.RODAID_BASE_URL ?? 'https://rodaid.com.ar'
const API_URL      = process.env.RODAID_API_URL ?? 'https://api.rodaid.com.ar'
const WH_SECRET    = process.env.MP_WEBHOOK_SECRET ?? ''

function getMPConfig(accessToken?: string): MercadoPagoConfig {
  const token = accessToken ?? env.RODAID_MP_ACCESS_TOKEN ?? 'TEST-stub'
  return new MercadoPagoConfig({
    accessToken: token,
    options: {
      timeout:    10_000,
      idempotencyKey: crypto.randomUUID(),
    },
  })
}

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface PreferenciaPagoInput {
  transaccionId:     string        // referencia interna (UUID)
  compradorId:       string
  compradorEmail:    string
  compradorNombre:   string
  titulo:            string        // descripción del ítem en MP
  descripcion?:      string
  monto:             number        // ARS
  // Marketplace split
  vendedorMpToken?:  string        // access_token OAuth del vendedor
  marketplaceFee?:   number        // si es marketplace (override de COMISION_PCT)
  // Config
  cuotas?:           number        // default 1 (sin cuotas)
  expiraHoras?:      number        // default 48h
  ipComprador?:      string
  userAgent?:        string
}

export interface PreferenciaPagoResult {
  pagoId:          string          // ID en nuestra DB
  preferenceId:    string          // ID en MP
  initPoint:       string          // URL checkout MP (producción)
  sandboxInitPoint:string          // URL checkout MP (sandbox)
  modo:            'STUB' | 'SANDBOX' | 'LIVE'
  monto:           number
  expiraEn:        Date
}

export interface WebhookSDKResult {
  procesado:        boolean
  pagoId?:          string
  mpPaymentId?:     string
  estadoAnterior?:  string
  estadoNuevo?:     string
  accionesEjecutadas: string[]
  mensaje:          string
}

// Mapa de estados MP → estados RODAID
const ESTADO_MAP: Record<string, string> = {
  pending:    'PENDIENTE',
  approved:   'APROBADO',
  authorized: 'APROBADO',
  in_process: 'EN_PROCESO',
  in_mediation:'EN_PROCESO',
  rejected:   'RECHAZADO',
  cancelled:  'CANCELADO',
  refunded:   'REEMBOLSADO',
  charged_back:'REEMBOLSADO',
}

// ══════════════════════════════════════════════════════════
// 1. CREAR PREFERENCIA — SDK Preference.create()
// ══════════════════════════════════════════════════════════

export async function crearPreferenciaPago(
  input: PreferenciaPagoInput
): Promise<PreferenciaPagoResult> {
  const expiraEn      = new Date(Date.now() + (input.expiraHoras ?? 48) * 3_600_000)
  const idempotencyKey = `rodaid-pay-${input.transaccionId}`
  const comision       = input.marketplaceFee ?? Math.round(input.monto * COMISION_PCT) / 100

  // Registrar pago ANTES de llamar a MP (idempotente)
  const pagoRow = await queryOne<{ id: string }>(
    `INSERT INTO pagos_mp
       (transaccion_id, preference_id, comprador_id, comprador_email,
        monto_ars, comision_rodaid, estado, expira_en, idempotency_key,
        url_exito, url_fallo, url_pendiente, ip_comprador, user_agent, metadata)
     VALUES ($1,'PENDING',$2,$3,$4,$5,'CREADO',$6,$7,$8,$9,$10,$11::inet,$12,$13::jsonb)
     ON CONFLICT (idempotency_key) DO UPDATE SET estado=pagos_mp.estado
     RETURNING id`,
    [
      input.transaccionId, input.compradorId, input.compradorEmail,
      input.monto, comision, expiraEn, idempotencyKey,
      `${BASE_URL}/pago/ok?tx=${input.transaccionId}`,
      `${BASE_URL}/pago/error?tx=${input.transaccionId}`,
      `${BASE_URL}/pago/pendiente?tx=${input.transaccionId}`,
      input.ipComprador ?? null, input.userAgent?.slice(0, 200) ?? null,
      JSON.stringify({ transaccionId: input.transaccionId, compradorNombre: input.compradorNombre }),
    ]
  )
  const pagoId = pagoRow!.id

  // ── STUB — sin credenciales reales ────────────────────
  if (MODO_STUB) {
    const preferenceId   = `STUB_PREF_${Date.now()}_${input.transaccionId.slice(0, 8)}`
    const initPoint      = `${BASE_URL}/pago/stub?pref=${preferenceId}&monto=${input.monto}&tx=${input.transaccionId}`
    await query(`UPDATE pagos_mp SET preference_id=$2 WHERE id=$1`, [pagoId, preferenceId])
    log.escrow.warn({ pagoId: pagoId.slice(0, 8), monto: input.monto },
      '⚠ MP STUB — configurar RODAID_MP_ACCESS_TOKEN para pagos reales')
    return {
      pagoId, preferenceId, initPoint, sandboxInitPoint: initPoint,
      modo: 'STUB', monto: input.monto, expiraEn,
    }
  }

  // ── SDK real ───────────────────────────────────────────
  const config    = getMPConfig(input.vendedorMpToken)
  const prefClient = new Preference(config)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prefData = {
    items: [{
      id:          input.transaccionId,
      title:       input.titulo.slice(0, 256),
      description: (input.descripcion ?? input.titulo).slice(0, 600),
      quantity:    1,
      unit_price:  input.monto,
      currency_id: 'ARS',
    }],
    payer: {
      email:      input.compradorEmail,
      first_name: input.compradorNombre.split(' ')[0],
      last_name:  input.compradorNombre.split(' ').slice(1).join(' ') || undefined,
    },
    back_urls: {
      success: `${BASE_URL}/pago/ok?tx=${input.transaccionId}`,
      failure: `${BASE_URL}/pago/error?tx=${input.transaccionId}`,
      pending: `${BASE_URL}/pago/pendiente?tx=${input.transaccionId}`,
    },
    auto_return:       'approved',
    notification_url:  `${API_URL}/api/v1/webhooks/mp`,
    external_reference:input.transaccionId,
    expires:           true,
    expiration_date_from: new Date().toISOString(),
    expiration_date_to:   expiraEn.toISOString(),
    binary_mode:       false,
    // Split para marketplace
    ...(comision > 0 ? { marketplace_fee: comision } : {}),
  }

  let prefResult: { id?: string | null; init_point?: string | null; sandbox_init_point?: string | null } | null = null
  try {
    prefResult = await prefClient.create({ body: prefData as any })
  } catch (err) {
    // Fallback a STUB si falla MP (no bloquear al usuario)
    log.escrow.error({ err: (err as Error).message, transaccionId: input.transaccionId },
      '✗ MP SDK preference fallida — STUB fallback')
    const stubPref = `STUB_FALLBACK_${Date.now()}`
    await query(`UPDATE pagos_mp SET preference_id=$2, estado='CREADO' WHERE id=$1`, [pagoId, stubPref])
    return {
      pagoId, preferenceId: stubPref,
      initPoint:       `${BASE_URL}/pago/stub?pref=${stubPref}&monto=${input.monto}`,
      sandboxInitPoint:`${BASE_URL}/pago/stub?pref=${stubPref}&monto=${input.monto}`,
      modo: 'STUB', monto: input.monto, expiraEn,
    }
  }

  const preferenceId = prefResult.id!
  await query(
    `UPDATE pagos_mp SET preference_id=$2, estado='PENDIENTE' WHERE id=$1`,
    [pagoId, preferenceId]
  )

  log.escrow.info({
    pagoId: pagoId.slice(0, 8), preferenceId, monto: input.monto,
    modo: MODO_SANDBOX ? 'SANDBOX' : 'LIVE',
  }, '✅ Preferencia MP creada via SDK')

  return {
    pagoId,
    preferenceId,
    initPoint:        prefResult.init_point        ?? '',
    sandboxInitPoint: prefResult.sandbox_init_point ?? '',
    modo: MODO_SANDBOX ? 'SANDBOX' : 'LIVE',
    monto: input.monto,
    expiraEn,
  }
}

// ══════════════════════════════════════════════════════════
// 2. BACK URL — Retorno del comprador (solo UX, no confiable)
// ══════════════════════════════════════════════════════════

/**
 * Procesar los query params del retorno de MP (back_url).
 * NO actualizar el estado del pago aquí — esperar el webhook.
 * Retornar al frontend con el estado PROVISIONAL (puede cambiar).
 */
export async function procesarRetornoMP(params: {
  status:         string            // approved | rejected | pending
  paymentId?:     string            // payment_id en la URL
  externalRef?:   string            // external_reference = transaccionId
  preferenceId?:  string
}): Promise<{
  estadoProvisional:   string
  transaccionId?:      string
  pagoId?:             string
  mensajeUsuario:      string
  esperandoWebhook:    boolean
}> {
  const transaccionId = params.externalRef
  const pago = transaccionId ? await queryOne<{ id: string; estado: string }>(
    `SELECT id, estado FROM pagos_mp WHERE transaccion_id=$1 ORDER BY creado_en DESC LIMIT 1`,
    [transaccionId]
  ) : null

  // Actualizar mp_payment_id si viene en el retorno
  if (pago && params.paymentId) {
    await query(
      `UPDATE pagos_mp SET mp_payment_id=$2, webhook_count=webhook_count+1 WHERE id=$1`,
      [pago.id, parseInt(params.paymentId)]
    ).catch(() => {})
  }

  const mensajes: Record<string, string> = {
    approved: '✅ Pago aprobado. El vendedor recibirá la confirmación en breve.',
    rejected: '❌ El pago fue rechazado. Podés intentar con otro medio de pago.',
    pending:  '⏳ Pago en proceso. Te notificaremos cuando se confirme.',
    failure:  '❌ Hubo un problema con el pago.',
  }

  return {
    estadoProvisional:  ESTADO_MAP[params.status] ?? 'PENDIENTE',
    transaccionId,
    pagoId:             pago?.id,
    mensajeUsuario:     mensajes[params.status] ?? 'Estado pendiente de confirmación.',
    esperandoWebhook:   params.status !== 'rejected',  // el webhook confirmará
  }
}

// ══════════════════════════════════════════════════════════
// 3. WEBHOOK — Fuente de verdad (SDK Payment.get)
// ══════════════════════════════════════════════════════════

/**
 * Verificar firma HMAC del webhook de MP.
 * Formato de la cabecera X-Signature:
 *   "ts=1704908000,v1=abc123..."
 */
export function verificarFirmaWebhookMP(opts: {
  xSignature:  string
  xRequestId:  string
  rawBody:     string
}): { valida: boolean; ts?: string; v1?: string } {
  if (!WH_SECRET || MODO_STUB) return { valida: true }  // STUB: siempre válido

  const parts: Record<string, string> = {}
  opts.xSignature.split(',').forEach(p => {
    const [k, v] = p.split('=')
    if (k && v) parts[k.trim()] = v.trim()
  })

  const ts = parts['ts'] ?? ''
  const v1 = parts['v1'] ?? ''
  if (!ts || !v1) return { valida: false, ts, v1 }

  // Template: "id:{data.id};request-id:{X-Request-Id};ts:{ts};"
  // MP firma el id del recurso + request-id + timestamp
  const dataId = (() => {
    try { return JSON.parse(opts.rawBody)?.data?.id ?? '' } catch { return '' }
  })()

  const plantilla = `id:${dataId};request-id:${opts.xRequestId};ts:${ts};`
  const esperado  = crypto.createHmac('sha256', WH_SECRET).update(plantilla).digest('hex')

  const valida = crypto.timingSafeEqual(
    Buffer.from(v1.padEnd(64, '0').slice(0, 64),   'hex'),
    Buffer.from(esperado.slice(0, 64), 'hex')
  )
  return { valida, ts, v1 }
}

/**
 * Procesar webhook de MP usando el SDK para consultar el estado real.
 */
export async function procesarWebhookSDK(opts: {
  rawBody:    string
  xSignature: string
  xRequestId: string
}): Promise<WebhookSDKResult> {
  // 1. Verificar firma
  const firma = verificarFirmaWebhookMP(opts)
  if (!firma.valida) {
    log.escrow.warn({ sig: opts.xSignature.slice(0, 30) }, '⚠ Webhook MP: firma inválida')
    return { procesado: false, accionesEjecutadas: [], mensaje: 'Firma inválida' }
  }

  // 2. Parsear evento
  let evento: { type?: string; action?: string; data?: { id?: string | number } }
  try { evento = JSON.parse(opts.rawBody) } catch {
    return { procesado: false, accionesEjecutadas: [], mensaje: 'JSON inválido' }
  }

  const tipo = evento.type ?? evento.action?.split('.')?.[0]
  if (!['payment', 'merchant_order'].includes(tipo ?? '')) {
    return { procesado: false, accionesEjecutadas: [], mensaje: `Tipo ignorado: ${tipo}` }
  }

  const mpId = String(evento.data?.id ?? '')
  if (!mpId) return { procesado: false, accionesEjecutadas: [], mensaje: 'Sin data.id' }

  // 3. Deduplicar por redis (TTL 24h)
  const redis    = getRedis()
  const dedupKey = `mp:wh:${tipo}:${mpId}`
  const yaVisto  = await redis.get(dedupKey).catch(() => null)
  if (yaVisto && MODO_STUB !== true) {
    return { procesado: false, mpPaymentId: mpId, accionesEjecutadas: [], mensaje: `${tipo}:${mpId} ya procesado` }
  }
  await redis.set(dedupKey, '1', 'EX', 86_400).catch(() => {})

  const acciones: string[] = []
  let pagoId: string | undefined
  let estadoNuevo: string | undefined
  let estadoAnterior: string | undefined

  // 4. Consultar estado real en MP via SDK
  if (tipo === 'payment') {
    const config     = getMPConfig()
    const payClient  = new Payment(config)

    let mpPago: any = null

    if (!MODO_STUB) {
      mpPago = await payClient.get({ id: mpId }).catch(() => null)
    } else {
      // STUB: simular pago aprobado
      mpPago = {
        id:                 parseInt(mpId),
        status:             'approved',
        status_detail:      'accredited',
        payment_method_id:  'credit_card',
        installments:       1,
        transaction_amount: 0,
        external_reference: mpId,
      }
      acciones.push('STUB: pago simulado como aprobado')
    }

    if (!mpPago) {
      return { procesado: false, mpPaymentId: mpId, accionesEjecutadas: acciones,
        mensaje: `No se pudo consultar payment ${mpId} en MP` }
    }

    estadoNuevo    = ESTADO_MAP[mpPago.status ?? ''] ?? 'PENDIENTE'
    const transRef = mpPago.external_reference
    const mpFee    = (mpPago.fee_details as any[])?.find((f: any) => f.type === 'mercadopago_fee')?.amount ?? 0

    // Buscar nuestro pago (por transaccion_id o mp_payment_id)
    const mpIdNum = parseInt(mpId)
    const pago = await queryOne<{ id: string; estado: string; monto_ars: number }>(
      `SELECT id, estado, monto_ars FROM pagos_mp
       WHERE mp_payment_id=$1 OR (transaccion_id::text=$2 AND $2 IS NOT NULL)
       ORDER BY creado_en DESC LIMIT 1`,
      [isNaN(mpIdNum) ? null : mpIdNum, transRef ?? null]
    )

    if (pago) {
      estadoAnterior = pago.estado
      pagoId         = pago.id

      await query(
        `UPDATE pagos_mp SET
           mp_payment_id=$2, estado=$3, estado_mp=$4, estado_detalle=$5,
           metodo_pago=$6, cuotas=$7,
           pagado_en=CASE WHEN $3='APROBADO' AND pagado_en IS NULL THEN NOW() ELSE pagado_en END,
           webhook_recibido_en=NOW(), webhook_count=webhook_count+1
         WHERE id=$1`,
        [
          pago.id, mpPago.id, estadoNuevo, mpPago.status, mpPago.status_detail,
          mpPago.payment_method_id, mpPago.installments,
        ]
      )
      acciones.push(`Estado actualizado: ${estadoAnterior} → ${estadoNuevo}`)
    } else {
      // Pago nuevo no registrado previamente (edge case: webhook llegó antes del registro)
      if (transRef) {
        await query(
          `INSERT INTO pagos_mp
             (preference_id, mp_payment_id, monto_ars, estado, estado_mp, estado_detalle,
              metodo_pago, cuotas, pagado_en, webhook_recibido_en, transaccion_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
             CASE WHEN $4='APROBADO' THEN NOW() END,
             NOW(),$9)
           ON CONFLICT DO NOTHING`,
          [
            `MP_LATE_${mpId}`, mpPago.id, mpPago.transaction_amount ?? 0,
            estadoNuevo, mpPago.status, mpPago.status_detail,
            mpPago.payment_method_id, mpPago.installments, transRef,
          ]
        ).catch(() => {})
        acciones.push('Pago registrado tardíamente desde webhook')
      }
    }

    // 5. Consecuencias de negocio (fire-and-forget)
    if (estadoNuevo === 'APROBADO' && pagoId) {
      ejecutarConsecuencias(pagoId, mpId, acciones).catch(() => {})
    }
  }

  log.escrow.info({
    tipo, mpId, pagoId: pagoId?.slice(0, 8),
    estadoAnterior, estadoNuevo,
  }, `✅ Webhook MP procesado: ${estadoAnterior ?? '?'} → ${estadoNuevo ?? '?'}`)

  return {
    procesado:  true,
    pagoId,
    mpPaymentId:mpId,
    estadoAnterior,
    estadoNuevo,
    accionesEjecutadas: acciones,
    mensaje:    `Pago ${mpId} → ${estadoNuevo}`,
  }
}

async function ejecutarConsecuencias(pagoId: string, mpPaymentId: string, acciones: string[]) {
  // a. Confirmar transacción del marketplace si aplica
  const pago = await queryOne<{ transaccion_id: string | null }>(
    `SELECT transaccion_id FROM pagos_mp WHERE id=$1`, [pagoId]
  )
  if (pago?.transaccion_id) {
    await query(
      `UPDATE transacciones SET estado='PAGADO', actualizado_en=NOW() WHERE id=$1`,
      [pago.transaccion_id]
    ).catch(() => {})
    acciones.push(`Transacción ${pago.transaccion_id.slice(0, 8)} marcada PAGADA`)
  }

  // b. Notificar al comprador (fire-and-forget)
  const comprador = await queryOne<{ comprador_id: string }>(
    `SELECT comprador_id FROM pagos_mp WHERE id=$1`, [pagoId]
  )
  if (comprador?.comprador_id) {
    import('./device_token.service').then(dt =>
      dt.enviarPush(comprador.comprador_id, {
        titulo: '✅ Pago confirmado',
        cuerpo: 'Tu pago fue acreditado. La transacción está completa.',
        datos:  { tipo: 'PAGO_APROBADO', pagoId, mpPaymentId },
      })
    ).catch(() => {})
    acciones.push('Push de confirmación enviado')
  }
}

// ══════════════════════════════════════════════════════════
// QUERIES
// ══════════════════════════════════════════════════════════

export async function getPago(pagoId: string) {
  return queryOne<any>(`SELECT * FROM pagos_mp WHERE id=$1`, [pagoId])
}

export async function getPagoPorPreferencia(preferenceId: string) {
  return queryOne<any>(`SELECT * FROM pagos_mp WHERE preference_id=$1`, [preferenceId])
}

export async function getPagoPorTransaccion(transaccionId: string) {
  return queryOne<any>(
    `SELECT * FROM pagos_mp WHERE transaccion_id=$1 ORDER BY creado_en DESC LIMIT 1`,
    [transaccionId]
  )
}

export async function getResumenPagos(dias = 30) {
  return queryOne<any>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER(WHERE estado='APROBADO')::int AS aprobados,
            COUNT(*) FILTER(WHERE estado='RECHAZADO')::int AS rechazados,
            COUNT(*) FILTER(WHERE estado='PENDIENTE')::int AS pendientes,
            COALESCE(SUM(monto_ars) FILTER(WHERE estado='APROBADO'),0)::numeric AS volumen_ars,
            COALESCE(SUM(comision_rodaid) FILTER(WHERE estado='APROBADO'),0)::numeric AS comision_total
     FROM pagos_mp WHERE creado_en > NOW()-($1||' days')::interval`, [dias]
  )
}

export { getMPConfig, MODO_STUB, MODO_SANDBOX, COMISION_PCT }
