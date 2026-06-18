// ─── RODAID PAY · Cuenta MercadoPago Business ─────────────
//
// Gestiona la cuenta de RODAID S.A.S. como plataforma de
// pagos Marketplace de MercadoPago.
//
// ══ ESTRUCTURA DE LA CUENTA ══════════════════════════════
//
//   RODAID SAS
//     · App Marketplace registrada en MP (developers.mercadopago.com)
//     · Cuenta Business: pagos@rodaid.com.ar
//     · Recibe el 2.5% de cada transacción (marketplace_fee)
//
//   VENDEDORES (propietarios de bicicletas)
//     · Se conectan vía OAuth con su cuenta MP personal
//     · Reciben el 97.5% neto de cada venta
//     · El split ocurre automáticamente en el momento del pago
//
// ══ FLUJO DE PAGO ════════════════════════════════════════
//
//   1. CONNECT vendedor
//      GET /mp/connect → redirect OAuth MP → /mp/callback
//      → guardar access_token del vendedor en mp_vendedores
//
//   2. CREAR PREFERENCIA (al confirmar compra)
//      crearPreferenciaMarketplace({
//        vendedorId, compradorId, bicicletaId, monto
//      })
//      → POST /checkout/preferences con:
//        · application_fee (2.5% para RODAID)
//        · marketplace_fee
//        · "access_token" del VENDEDOR (MP divide automáticamente)
//
//   3. PAGO (comprador paga en MP)
//      → MP splitea: 97.5% → cuenta vendedor, 2.5% → cuenta RODAID
//
//   4. WEBHOOK
//      POST /webhooks/mp → actualizar estado en DB
//
// ══ MODOS ════════════════════════════════════════════════
//
//   STUB:    sin credenciales → simula pagos (tests y dev)
//   SANDBOX: RODAID_MP_ACCESS_TOKEN=TEST-... → sandbox real de MP
//   LIVE:    RODAID_MP_ACCESS_TOKEN=APP_USR-... → producción
//
// ══ VARIABLES DE ENTORNO ═════════════════════════════════
//
//   RODAID_MP_CLIENT_ID       = ID de la App Marketplace en MP
//   RODAID_MP_CLIENT_SECRET   = Secret de la App
//   RODAID_MP_ACCESS_TOKEN    = Token de la cuenta RODAID SAS
//   RODAID_MP_PUBLIC_KEY      = Clave pública para el frontend
//   RODAID_MP_REDIRECT_URI    = https://rodaid.com.ar/mp/callback
//   RODAID_MP_COMISION_PCT    = 2.50 (default)
//   MP_WEBHOOK_SECRET         = para validar webhooks

import crypto              from 'crypto'
import { query, queryOne } from '../config/database'
import { getRedis }        from '../config/redis'
import { log }             from '../middleware/logger'
import { env }             from '../config/env'
import { AppError }        from '../middleware/errorHandler'

// ══════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ══════════════════════════════════════════════════════════

const MP_BASE          = 'https://api.mercadopago.com'
const MP_OAUTH_URL     = 'https://auth.mercadopago.com/authorization'
const MP_TOKEN_URL     = 'https://api.mercadopago.com/oauth/token'
const COMISION_PCT     = parseFloat(process.env.RODAID_MP_COMISION_PCT ?? '2.50')
const REDIRECT_URI     = process.env.RODAID_MP_REDIRECT_URI ?? 'https://rodaid.com.ar/mp/callback'
const CLIENT_ID        = process.env.RODAID_MP_CLIENT_ID    ?? 'STUB_CLIENT_ID'
const CLIENT_SECRET    = process.env.RODAID_MP_CLIENT_SECRET ?? 'STUB_SECRET'
const RODAID_TOKEN     = process.env.RODAID_MP_ACCESS_TOKEN  ?? ''
const RODAID_PUB_KEY   = process.env.RODAID_MP_PUBLIC_KEY    ?? ''

function getModo(): 'LIVE' | 'SANDBOX' | 'STUB' {
  if (!RODAID_TOKEN)               return 'STUB'
  if (RODAID_TOKEN.startsWith('TEST-')) return 'SANDBOX'
  return 'LIVE'
}

async function mpFetch<T = unknown>(
  path: string,
  opts?: RequestInit,
  accessToken?: string
): Promise<T> {
  const token = accessToken ?? RODAID_TOKEN
  if (getModo() === 'STUB') throw new Error('MP_STUB')

  const res = await fetch(`${MP_BASE}${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
      ...(opts?.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string }
    throw new AppError(`MP API error ${res.status}: ${err.message ?? 'unknown'}`, res.status, 'MP_API_ERROR')
  }
  return res.json() as Promise<T>
}

// ══════════════════════════════════════════════════════════
// CUENTA RODAID — Información y configuración
// ══════════════════════════════════════════════════════════

export async function getCuentaRodaid() {
  const row = await queryOne<any>(
    `SELECT mp_user_id, mp_email, mp_public_key, mp_client_id,
            comision_pct, modo, razon_social, cuit, activa, creado_en
     FROM mp_cuenta_rodaid WHERE activa=TRUE LIMIT 1`, []
  )
  return {
    ...row,
    modo:       getModo(),
    comisionPct:COMISION_PCT,
    publicKey:  RODAID_PUB_KEY || row?.mp_public_key,
    configurada:!!RODAID_TOKEN,
  }
}

export async function verificarCuentaMP(): Promise<{
  ok: boolean; userId?: string; email?: string; nickname?: string; error?: string
}> {
  if (getModo() === 'STUB') {
    return { ok: true, userId: 'STUB', email: 'pagos@rodaid.com.ar', nickname: 'RODAID_SAS' }
  }
  try {
    const me = await mpFetch<{ id: number; email: string; nickname: string }>('/users/me')
    return { ok: true, userId: String(me.id), email: me.email, nickname: me.nickname }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ══════════════════════════════════════════════════════════
// OAUTH — Conectar vendedores
// ══════════════════════════════════════════════════════════

/**
 * Generar URL de autorización OAuth para que el vendedor conecte su cuenta MP.
 */
export async function generarUrlOAuth(usuarioId: string): Promise<{
  url: string; state: string
}> {
  const redis = getRedis()
  // State anti-CSRF (TTL 10 minutos)
  const state = crypto.randomBytes(16).toString('hex')
  await redis.set(`mp:oauth:state:${state}`, usuarioId, 'EX', 600)

  if (getModo() === 'STUB') {
    log.marketplace.warn({ usuarioId: usuarioId.slice(0, 8) }, '⚠ MP OAuth STUB')
    return {
      url:   `https://auth.mercadopago.com/stub/oauth?client_id=${CLIENT_ID}&state=${state}`,
      state,
    }
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    state,
    scope:         'offline_access payments write',
  })

  return { url: `${MP_OAUTH_URL}?${params}`, state }
}

/**
 * Procesar callback OAuth → obtener access_token del vendedor.
 */
export async function procesarCallbackOAuth(opts: {
  code:  string
  state: string
}): Promise<{
  ok:          boolean
  usuarioId?:  string
  mpUserId?:   string
  mpEmail?:    string
  error?:      string
}> {
  const redis     = getRedis()
  const usuarioId = await redis.get(`mp:oauth:state:${opts.state}`)
  if (!usuarioId) {
    return { ok: false, error: 'State OAuth inválido o expirado' }
  }
  await redis.del(`mp:oauth:state:${opts.state}`)

  if (getModo() === 'STUB') {
    // Simular conexión OAuth exitosa
    const mpUserId = `STUB_${usuarioId.slice(0, 8)}`
    await upsertVendedor({
      usuarioId, mpUserId,
      accessToken:  `TEST-stub-token-${Date.now()}`,
      refreshToken: `TEST-stub-refresh-${Date.now()}`,
      mpEmail:      `vendedor_${mpUserId}@stub.com`,
      scope:        'offline_access payments write',
      expiraEn:     new Date(Date.now() + 180 * 86_400_000),
    })
    return { ok: true, usuarioId, mpUserId, mpEmail: `vendedor_${mpUserId}@stub.com` }
  }

  try {
    const tokenRes = await fetch(MP_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    'authorization_code',
        code:          opts.code,
        redirect_uri:  REDIRECT_URI,
      }),
    })

    if (!tokenRes.ok) throw new Error(`OAuth token error: ${tokenRes.status}`)
    const token = await tokenRes.json() as {
      access_token: string; refresh_token: string; user_id: number; scope: string
      expires_in: number; public_key: string
    }

    // Obtener info del vendedor
    const me = await mpFetch<{ id: number; email: string; nickname: string }>(
      '/users/me', {}, token.access_token
    )

    const expiraEn = new Date(Date.now() + (token.expires_in ?? 15_552_000) * 1000)
    await upsertVendedor({
      usuarioId, mpUserId: String(token.user_id),
      accessToken: token.access_token, refreshToken: token.refresh_token,
      mpEmail: me.email, mpPublicKey: token.public_key,
      scope: token.scope, expiraEn,
    })

    log.marketplace.info({ usuarioId: usuarioId.slice(0, 8), mpUserId: token.user_id }, '✅ Vendedor conectado a MP')
    return { ok: true, usuarioId, mpUserId: String(token.user_id), mpEmail: me.email }

  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

async function upsertVendedor(opts: {
  usuarioId: string; mpUserId: string; accessToken: string; refreshToken?: string
  mpEmail?: string; mpPublicKey?: string; scope?: string; expiraEn?: Date
}) {
  await query(
    `INSERT INTO mp_vendedores
       (usuario_id, mp_user_id, mp_access_token, mp_refresh_token,
        mp_email, mp_public_key, scope, expira_en, activo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
     ON CONFLICT (usuario_id) DO UPDATE SET
       mp_user_id      = EXCLUDED.mp_user_id,
       mp_access_token = EXCLUDED.mp_access_token,
       mp_refresh_token= EXCLUDED.mp_refresh_token,
       mp_email        = EXCLUDED.mp_email,
       mp_public_key   = EXCLUDED.mp_public_key,
       scope           = EXCLUDED.scope,
       expira_en       = EXCLUDED.expira_en,
       activo          = TRUE,
       actualizado_en  = NOW()`,
    [
      opts.usuarioId, opts.mpUserId, opts.accessToken, opts.refreshToken ?? null,
      opts.mpEmail ?? null, opts.mpPublicKey ?? null, opts.scope ?? null,
      opts.expiraEn ?? null,
    ]
  )
}

// ══════════════════════════════════════════════════════════
// PREFERENCIAS DE PAGO (MARKETPLACE SPLIT)
// ══════════════════════════════════════════════════════════

export interface PreferenciaInput {
  transaccionId:    string
  compradorId:      string
  vendedorId:       string
  bicicletaId:      string
  titulo:           string
  monto:            number      // ARS
  descripcion?:     string
  urlExito?:        string
  urlFallo?:        string
  urlPendiente?:    string
}

export interface PreferenciaResult {
  preferenceId:     string
  initPoint:        string      // URL de pago MP
  sandboxInitPoint: string
  monto:            number
  montoRodaid:      number
  montoVendedor:    number
  modo:             string
  pagoId:           string      // ID en nuestra DB
}

/**
 * Crear preferencia de pago con split automático:
 *   vendedor recibe 97.5%, RODAID retiene 2.5% como marketplace_fee
 */
export async function crearPreferenciaMarketplace(
  input: PreferenciaInput
): Promise<PreferenciaResult> {
  // Calcular split
  const montoRodaid   = Math.round(input.monto * COMISION_PCT) / 100
  const montoVendedor = Math.round((input.monto - montoRodaid) * 100) / 100

  // Obtener token del vendedor
  const vendedor = await queryOne<{ mp_user_id: string; mp_access_token: string }>(
    `SELECT mp_user_id, mp_access_token FROM mp_vendedores
     WHERE usuario_id=$1 AND activo=TRUE`, [input.vendedorId]
  )

  if (!vendedor && getModo() !== 'STUB') {
    throw new AppError(
      'El vendedor no tiene una cuenta MercadoPago conectada. Debe autorizar desde /mp/connect',
      422, 'VENDEDOR_SIN_MP'
    )
  }

  const idempotencyKey = `rodaid-pref-${input.transaccionId}`

  // Registrar pago en DB ANTES de llamar a MP (idempotente)
  const pagoRow = await queryOne<{ id: string }>(
    `INSERT INTO mp_pagos
       (transaccion_id, comprador_id, vendedor_id, vendedor_mp_id,
        monto_total_ars, pct_rodaid, monto_rodaid_ars, monto_vendedor_ars, estado, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDIENTE',$9)
     ON CONFLICT (idempotency_key) DO UPDATE SET estado=mp_pagos.estado
     RETURNING id`,
    [
      input.transaccionId ?? null, input.compradorId, input.vendedorId,
      vendedor?.mp_user_id ?? 'STUB',
      input.monto, COMISION_PCT, montoRodaid, montoVendedor, idempotencyKey,
    ]
  )

  if (getModo() === 'STUB') {
    const prefId = `STUB_PREF_${Date.now()}`
    await query(
      `UPDATE mp_pagos SET mp_preference_id=$2 WHERE id=$1`, [pagoRow!.id, prefId]
    )
    log.marketplace.warn({ monto: input.monto, montoRodaid }, '⚠ MP STUB — preferencia simulada')
    return {
      preferenceId:     prefId,
      initPoint:        `https://www.mercadopago.com.ar/sandbox/checkout/stub/?pref=${prefId}`,
      sandboxInitPoint: `https://sandbox.mercadopago.com.ar/checkout/stub/?pref=${prefId}`,
      monto:            input.monto,
      montoRodaid,
      montoVendedor,
      modo:             'STUB',
      pagoId:           pagoRow!.id,
    }
  }

  // Crear preferencia en MP con marketplace split
  const pref = await mpFetch<{
    id: string; init_point: string; sandbox_init_point: string
  }>(
    '/checkout/preferences',
    {
      method: 'POST',
      body:   JSON.stringify({
        items: [{
          id:          input.bicicletaId,
          title:       input.titulo,
          description: input.descripcion ?? '',
          quantity:    1,
          unit_price:  input.monto,
          currency_id: 'ARS',
        }],
        // Split: MP carga la comisión directamente sobre el pago del vendedor
        marketplace_fee: montoRodaid,
        application_fee: montoRodaid,
        // Token del vendedor → los fondos van a su cuenta (menos marketplace_fee)
        // Este campo hace que el pago se procese en la cuenta del vendedor
        back_urls: {
          success: input.urlExito      ?? `${process.env.RODAID_FRONTEND_URL}/pago/exitoso`,
          failure: input.urlFallo      ?? `${process.env.RODAID_FRONTEND_URL}/pago/fallido`,
          pending: input.urlPendiente  ?? `${process.env.RODAID_FRONTEND_URL}/pago/pendiente`,
        },
        auto_return:     'approved',
        notification_url:`${process.env.RODAID_API_URL ?? 'https://api.rodaid.com.ar'}/api/v1/webhooks/mp`,
        external_reference: input.transaccionId,
        statement_descriptor: 'RODAID MARKETPLACE',
        metadata: {
          transaccion_id: input.transaccionId,
          pago_id:        pagoRow!.id,
          vendedor_id:    input.vendedorId,
          comprador_id:   input.compradorId,
          comision_rodaid:montoRodaid,
        },
      }),
    },
    vendedor!.mp_access_token  // Usar token del VENDEDOR para el split
  )

  await query(
    `UPDATE mp_pagos SET mp_preference_id=$2 WHERE id=$1`,
    [pagoRow!.id, pref.id]
  )

  log.marketplace.info({
    pagoId: pagoRow!.id.slice(0, 8), monto: input.monto,
    montoRodaid, montoVendedor, prefId: pref.id,
  }, `✅ Preferencia MP creada (split ${COMISION_PCT}%/${100-COMISION_PCT}%)`)

  return {
    preferenceId:     pref.id,
    initPoint:        pref.init_point,
    sandboxInitPoint: pref.sandbox_init_point,
    monto:            input.monto,
    montoRodaid,
    montoVendedor,
    modo:             getModo(),
    pagoId:           pagoRow!.id,
  }
}

// ══════════════════════════════════════════════════════════
// WEBHOOK — Actualizar estado de pagos
// ══════════════════════════════════════════════════════════

export async function procesarWebhookMP(opts: {
  payload:    unknown
  signature?: string
  eventId?:   string
}): Promise<{ procesado: boolean; pagoId?: string; nuevoEstado?: string; mensaje: string }> {
  const event = opts.payload as any
  const mpEventId = opts.eventId ?? event?.id ?? crypto.randomUUID()

  // Deduplicar
  const existe = await queryOne<{ id: string }>(
    `SELECT id FROM mp_webhooks WHERE mp_event_id=$1`, [String(mpEventId)]
  )
  if (existe) return { procesado: false, mensaje: `Webhook ${mpEventId} ya procesado` }

  const tipo        = event?.type ?? event?.action?.split?.('.')?.[0]
  const mpPaymentId = event?.data?.id ?? event?.resource?.split?.('/')?.pop()

  // Registrar webhook
  await query(
    `INSERT INTO mp_webhooks (mp_event_id, tipo, mp_payment_id, payload)
     VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
    [String(mpEventId), tipo, mpPaymentId ?? null, JSON.stringify(event)]
  )

  if (tipo !== 'payment' || !mpPaymentId) {
    return { procesado: false, mensaje: `Tipo no manejado: ${tipo}` }
  }

  // Consultar el pago en MP
  let mpEstado = 'unknown'
  let mpDetalle = ''
  let mpFee = 0

  if (getModo() !== 'STUB') {
    const mpPago = await mpFetch<any>(`/v1/payments/${mpPaymentId}`).catch(() => null)
    if (mpPago) {
      mpEstado  = mpPago.status
      mpDetalle = mpPago.status_detail
      mpFee     = mpPago.fee_details?.find((f: any) => f.type === 'mercadopago_fee')?.amount ?? 0
    }
  } else {
    mpEstado  = event?.data?.status ?? 'approved'
    mpDetalle = 'stub'
  }

  // Mapear estado MP → estado RODAID
  const estadoRodaid: Record<string, string> = {
    approved:    'APROBADO',
    rejected:    'RECHAZADO',
    pending:     'PENDIENTE',
    in_process:  'EN_PROCESO',
    cancelled:   'CANCELADO',
    refunded:    'REEMBOLSADO',
  }
  const nuevoEstado = estadoRodaid[mpEstado] ?? 'PENDIENTE'

  const pago = await queryOne<{ id: string; transaccion_id: string; comprador_id: string; vendedor_id: string }>(
    `SELECT id, transaccion_id, comprador_id, vendedor_id FROM mp_pagos WHERE mp_payment_id=$1 OR mp_preference_id=$1`,
    [String(mpPaymentId)]
  )

  if (pago) {
    await query(
      `UPDATE mp_pagos SET
         mp_payment_id=$2, estado=$3, estado_mp=$4, estado_detalle=$5,
         mp_fee_ars=$6, webhook_payload=$7::jsonb,
         aprobado_en=CASE WHEN $3='APROBADO' THEN NOW() ELSE aprobado_en END
       WHERE id=$1`,
      [pago.id, String(mpPaymentId), nuevoEstado, mpEstado, mpDetalle, mpFee, JSON.stringify(event)]
    )

    // Si se aprobó → confirmar transacción del marketplace
    if (nuevoEstado === 'APROBADO' && pago.transaccion_id) {
      await query(
        `UPDATE transacciones SET estado='PAGADO', actualizado_en=NOW() WHERE id=$1`,
        [pago.transaccion_id]
      ).catch(() => {})
    }
  }

  await query(`UPDATE mp_webhooks SET procesado=TRUE, mp_payment_id=$2 WHERE mp_event_id=$1`, [String(mpEventId), mpPaymentId])

  log.marketplace.info({ mpPaymentId, nuevoEstado, tipo }, `💳 Webhook MP: ${mpEstado}`)
  return { procesado: true, pagoId: pago?.id, nuevoEstado, mensaje: `Pago ${mpPaymentId} → ${nuevoEstado}` }
}

// ══════════════════════════════════════════════════════════
// REEMBOLSOS
// ══════════════════════════════════════════════════════════

export async function reembolsarPago(opts: {
  pagoId:  string
  monto?:  number    // parcial o total si undefined
  motivo?: string
}): Promise<{ ok: boolean; reembolsoId?: string; error?: string }> {
  const pago = await queryOne<{ mp_payment_id: string; monto_total_ars: number; estado: string }>(
    `SELECT mp_payment_id, monto_total_ars, estado FROM mp_pagos WHERE id=$1`, [opts.pagoId]
  )
  if (!pago) return { ok: false, error: 'Pago no encontrado' }
  if (pago.estado !== 'APROBADO') return { ok: false, error: `Pago en estado ${pago.estado}, no reembolsable` }

  if (getModo() === 'STUB') {
    await query(`UPDATE mp_pagos SET estado='REEMBOLSADO' WHERE id=$1`, [opts.pagoId])
    return { ok: true, reembolsoId: `STUB_REFUND_${Date.now()}` }
  }

  try {
    const body: Record<string, unknown> = {}
    if (opts.monto) body.amount = opts.monto
    const refund = await mpFetch<{ id: number }>(
      `/v1/payments/${pago.mp_payment_id}/refunds`, { method: 'POST', body: JSON.stringify(body) }
    )
    await query(`UPDATE mp_pagos SET estado='REEMBOLSADO' WHERE id=$1`, [opts.pagoId])
    return { ok: true, reembolsoId: String(refund.id) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ══════════════════════════════════════════════════════════
// QUERIES Y ESTADÍSTICAS
// ══════════════════════════════════════════════════════════

export async function getPagoVendedor(vendedorId: string, pagina = 1, porPagina = 25) {
  const offset = (pagina - 1) * porPagina
  const [pagos, total] = await Promise.all([
    query<any>(
      `SELECT id, transaccion_id, mp_payment_id, mp_preference_id,
              monto_total_ars, monto_rodaid_ars, monto_vendedor_ars,
              pct_rodaid, estado, estado_detalle, metodo_pago, cuotas,
              creado_en, aprobado_en
       FROM mp_pagos WHERE vendedor_id=$1
       ORDER BY creado_en DESC LIMIT $2 OFFSET $3`,
      [vendedorId, porPagina, offset]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM mp_pagos WHERE vendedor_id=$1`, [vendedorId]
    ),
  ])
  return { pagos, total: parseInt(total?.count ?? '0'), pagina, porPagina }
}

export async function getEstadisticasRodaidPay(dias = 30) {
  const resumen = await queryOne<any>(
    `SELECT COUNT(*)::int                                                AS total,
            COUNT(*) FILTER(WHERE estado='APROBADO')::int               AS aprobados,
            COALESCE(SUM(monto_total_ars) FILTER(WHERE estado='APROBADO'),0)::numeric AS volumen_ars,
            COALESCE(SUM(monto_rodaid_ars) FILTER(WHERE estado='APROBADO'),0)::numeric AS comision_rodaid,
            COALESCE(AVG(monto_total_ars) FILTER(WHERE estado='APROBADO'),0)::numeric AS ticket_promedio
     FROM mp_pagos WHERE creado_en > NOW()-($1||' days')::interval`, [dias]
  )
  const vendedoresActivos = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM mp_vendedores WHERE activo=TRUE`, []
  )
  return {
    modo:             getModo(),
    comisionPct:      COMISION_PCT,
    dias,
    resumen,
    vendedoresConectados: parseInt(vendedoresActivos?.count ?? '0'),
  }
}
