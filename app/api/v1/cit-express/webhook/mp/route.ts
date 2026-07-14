import { after, NextResponse } from 'next/server'
import { webhookPagoCitExpress } from '@/src/services/cit-express-pago.service'
import { validarFirmaWebhook } from '@/src/services/mercadopago.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/cit-express/webhook/mp — IPN de MercadoPago para el cobro real
 * del CIT Express. Calco exacto de /api/v1/denuncias/webhook/mp -- webhook
 * propio y separado del de escrow y del de denuncias, mismo criterio de
 * capas: cada dominio de dinero con su propio webhook.
 *
 * 1. Captura el raw body ANTES de parsear el JSON (para validar la firma).
 * 2. Valida la firma X-Signature (HMAC-SHA256) en modo LIVE.
 * 3. Responde 200 inmediato (<500ms — MP reintenta si tarda mas).
 * 4. Procesa en background: re-consulta el estado real a MP y, si esta
 *    approved, RECIEN ACA crea el CIT y arranca el pipeline de 72hs.
 */
export async function POST(req: Request) {
  const rawBody = await req.text()

  const xSignature = req.headers.get('x-signature')
  const xRequestId = req.headers.get('x-request-id')

  const url = new URL(req.url)
  const dataId =
    url.searchParams.get('data.id') ??
    url.searchParams.get('id') ??
    extractDataId(rawBody)

  const firma = validarFirmaWebhook({ xSignature, xRequestId, dataId })
  if (!firma.valido) {
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 })
  }

  const paymentId = extractPaymentId(rawBody, url)

  if (paymentId) {
    after(async () => {
      try {
        await webhookPagoCitExpress({ paymentId })
      } catch (error) {
        console.error('[cit-express][webhook] fallo el procesamiento en background', error)
      }
    })
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

/** Extrae el id del pago del payload IPN (body o querystring). */
function extractPaymentId(rawBody: string, url: URL): string | null {
  const tipo =
    url.searchParams.get('type') ?? url.searchParams.get('topic') ?? null

  try {
    const parsed = JSON.parse(rawBody) as {
      type?: string
      action?: string
      data?: { id?: string | number }
      resource?: string
    }

    const esPago =
      parsed.type === 'payment' ||
      parsed.action?.startsWith('payment') ||
      tipo === 'payment'

    if (esPago && parsed.data?.id != null) {
      return String(parsed.data.id)
    }
    if (tipo === 'payment') {
      return url.searchParams.get('data.id') ?? url.searchParams.get('id')
    }
  } catch {
    if (tipo === 'payment') {
      return url.searchParams.get('data.id') ?? url.searchParams.get('id')
    }
  }
  return null
}

function extractDataId(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { data?: { id?: string | number } }
    return parsed.data?.id != null ? String(parsed.data.id) : null
  } catch {
    return null
  }
}
