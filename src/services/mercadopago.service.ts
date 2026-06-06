import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * MercadoPago como gateway de pago primario de RODAID PAY.
 *
 * El modo se infiere automaticamente del access token:
 *   APP_USR-...        -> LIVE    (produccion real, valida firma del webhook)
 *   TEST-...           -> SANDBOX (sandbox de MercadoPago, omite firma)
 *   (sin token)        -> STUB    (simulado, no realiza llamadas HTTP)
 */
export type MercadoPagoModo = 'LIVE' | 'SANDBOX' | 'STUB'

const MP_API_BASE = 'https://api.mercadopago.com'

function getAccessToken(): string | null {
  const token = process.env.RODAID_MP_ACCESS_TOKEN
  return token && token.trim().length > 0 ? token.trim() : null
}

export function getModo(): MercadoPagoModo {
  const token = getAccessToken()
  if (!token) {
    return 'STUB'
  }
  if (token.startsWith('APP_USR-')) {
    return 'LIVE'
  }
  return 'SANDBOX'
}

export function getBaseUrl(): string {
  return (
    process.env.RODAID_BASE_URL?.replace(/\/+$/, '') ?? 'https://rodaid.com.ar'
  )
}

export interface CrearPreferenciaInput {
  transaccionId: string
  titulo: string
  descripcion: string
  precioARS: number
  compradorEmail?: string | null
  compradorNombre?: string | null
}

export interface PreferenciaCreada {
  preferenceId: string
  initPoint: string
  sandboxPoint: string | null
  gateway: MercadoPagoModo
  expiraEn: string
}

const EXPIRACION_MS = 48 * 60 * 60 * 1000 // 48 horas

/**
 * Crea una preferencia de Checkout Pro. El link vence a las 48 hs y usa
 * binary_mode:false para permitir multiples intentos de pago. El
 * external_reference correlaciona el pago con la transaccion de escrow.
 */
export async function crearPreferencia(
  input: CrearPreferenciaInput
): Promise<PreferenciaCreada> {
  const modo = getModo()
  const baseUrl = getBaseUrl()
  const expiraEn = new Date(Date.now() + EXPIRACION_MS).toISOString()
  const desde = new Date().toISOString()

  if (modo === 'STUB') {
    // Sin token: link simulado, sin llamadas a la API de MercadoPago.
    const preferenceId = `stub-pref-${input.transaccionId}`
    return {
      preferenceId,
      initPoint: `${baseUrl}/escrow/stub/checkout?pref=${preferenceId}&tx=${input.transaccionId}`,
      sandboxPoint: null,
      gateway: 'STUB',
      expiraEn,
    }
  }

  const body = {
    items: [
      {
        title: input.titulo,
        description: input.descripcion.slice(0, 250),
        quantity: 1,
        unit_price: input.precioARS,
        currency_id: 'ARS',
      },
    ],
    payer: {
      email: input.compradorEmail ?? undefined,
      name: input.compradorNombre ?? undefined,
    },
    back_urls: {
      success: `${baseUrl}/escrow/retorno/success`,
      failure: `${baseUrl}/escrow/retorno/failure`,
      pending: `${baseUrl}/escrow/retorno/pending`,
    },
    auto_return: 'approved',
    notification_url: `${baseUrl}/api/v1/escrow/webhook/mp`,
    external_reference: input.transaccionId,
    expires: true,
    expiration_date_from: desde,
    expiration_date_to: expiraEn,
    binary_mode: false,
  }

  const res = await mpFetch('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detalle = await safeText(res)
    throw new MercadoPagoError(
      `No se pudo crear la preferencia de MercadoPago (${res.status}): ${detalle}`
    )
  }

  const data = (await res.json()) as {
    id: string
    init_point?: string
    sandbox_init_point?: string
  }

  return {
    preferenceId: data.id,
    initPoint:
      data.init_point ??
      data.sandbox_init_point ??
      `${baseUrl}/escrow/retorno/pending`,
    sandboxPoint: data.sandbox_init_point ?? null,
    gateway: modo,
    expiraEn,
  }
}

export interface PagoMP {
  paymentId: string
  status: string // approved | pending | rejected | refunded | cancelled ...
  statusDetail: string | null
  monto: number | null
  externalReference: string | null
}

/**
 * Re-consulta el estado real de un pago a la API de MercadoPago. Nunca se
 * debe confiar en el payload del webhook: siempre se reconsulta la fuente.
 */
export async function consultarPago(paymentId: string): Promise<PagoMP> {
  if (getModo() === 'STUB') {
    // En STUB no hay API: se asume aprobado para poder simular el flujo.
    return {
      paymentId,
      status: 'approved',
      statusDetail: 'stub',
      monto: null,
      externalReference: null,
    }
  }

  const res = await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
  })

  if (!res.ok) {
    const detalle = await safeText(res)
    throw new MercadoPagoError(
      `No se pudo consultar el pago ${paymentId} (${res.status}): ${detalle}`
    )
  }

  const data = (await res.json()) as {
    id: number | string
    status: string
    status_detail?: string
    transaction_amount?: number
    external_reference?: string
  }

  return {
    paymentId: String(data.id),
    status: data.status,
    statusDetail: data.status_detail ?? null,
    monto: typeof data.transaction_amount === 'number' ? data.transaction_amount : null,
    externalReference: data.external_reference ?? null,
  }
}

export interface ReembolsoInput {
  paymentId: string
  motivo?: string | null
  monto?: number | null
}

export interface ReembolsoResultado {
  ok: boolean
  refundId: string | null
  gateway: MercadoPagoModo
}

/**
 * Emite un reembolso real contra POST /v1/payments/:id/refunds.
 * En STUB solo registra y devuelve ok:true.
 */
export async function emitirReembolso(
  input: ReembolsoInput
): Promise<ReembolsoResultado> {
  const modo = getModo()

  if (modo === 'STUB') {
    console.info('[mercadopago][stub] reembolso simulado', {
      paymentId: input.paymentId,
      motivo: input.motivo ?? null,
    })
    return { ok: true, refundId: `stub-refund-${input.paymentId}`, gateway: 'STUB' }
  }

  // Reembolso total (sin monto) o parcial (con monto).
  const body = input.monto && input.monto > 0 ? JSON.stringify({ amount: input.monto }) : '{}'

  const res = await mpFetch(
    `/v1/payments/${encodeURIComponent(input.paymentId)}/refunds`,
    {
      method: 'POST',
      body,
      // Clave de idempotencia para que MP no duplique el reembolso.
      headers: { 'X-Idempotency-Key': `refund-${input.paymentId}` },
    }
  )

  if (!res.ok) {
    const detalle = await safeText(res)
    throw new MercadoPagoError(
      `No se pudo emitir el reembolso del pago ${input.paymentId} (${res.status}): ${detalle}`
    )
  }

  const data = (await res.json()) as { id?: number | string }
  return {
    ok: true,
    refundId: data.id != null ? String(data.id) : null,
    gateway: modo,
  }
}

/**
 * Valida la firma del webhook (header X-Signature) segun el esquema de
 * MercadoPago: HMAC-SHA256 sobre el template
 *   `id:{data.id};request-id:{x-request-id};ts:{ts};`
 * En SANDBOX/STUB la validacion se omite (no hay secreto configurado).
 */
export function validarFirmaWebhook(params: {
  xSignature: string | null
  xRequestId: string | null
  dataId: string | null
}): { valido: boolean; omitido: boolean } {
  const modo = getModo()
  const secret = process.env.RODAID_MP_WEBHOOK_SECRET

  // Solo se exige firma en LIVE con secreto configurado.
  if (modo !== 'LIVE' || !secret) {
    return { valido: true, omitido: true }
  }

  if (!params.xSignature) {
    return { valido: false, omitido: false }
  }

  const partes = Object.fromEntries(
    params.xSignature.split(',').map((kv) => {
      const [k, ...rest] = kv.split('=')
      return [k.trim(), rest.join('=').trim()]
    })
  ) as { ts?: string; v1?: string }

  if (!partes.ts || !partes.v1) {
    return { valido: false, omitido: false }
  }

  const template =
    `id:${params.dataId ?? ''};` +
    `request-id:${params.xRequestId ?? ''};` +
    `ts:${partes.ts};`

  const esperado = createHmac('sha256', secret).update(template).digest('hex')

  const valido = safeEqualHex(esperado, partes.v1)
  return { valido, omitido: false }
}

export class MercadoPagoError extends Error {}

async function mpFetch(path: string, init: RequestInit): Promise<Response> {
  const token = getAccessToken()
  if (!token) {
    throw new MercadoPagoError('RODAID_MP_ACCESS_TOKEN no configurado.')
  }

  return fetch(`${MP_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return '<sin cuerpo>'
  }
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'hex')
    const bufB = Buffer.from(b, 'hex')
    if (bufA.length !== bufB.length || bufA.length === 0) {
      return false
    }
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}
