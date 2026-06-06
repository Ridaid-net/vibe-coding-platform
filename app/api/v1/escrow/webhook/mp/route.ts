import { after, NextResponse } from 'next/server'
import { webhookPago } from '@/src/services/escrow.service'
import { validarFirmaWebhook } from '@/src/services/mercadopago.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/escrow/webhook/mp — IPN de MercadoPago.
 *
 * 1. Captura el raw body ANTES de parsear el JSON (para validar la firma).
 * 2. Valida la firma X-Signature (HMAC-SHA256) en modo LIVE.
 * 3. Responde 200 inmediato (<500ms — MP reintenta si tarda mas).
 * 4. Procesa en background: re-consulta el estado real a MP y, si esta
 *    approved, mueve los fondos a mp_pagos en estado FONDOS_RETENIDOS.
 */
export async function POST(req: Request) {
  // 1. Raw body antes de cualquier parse.
  const rawBody = await req.text()

  const xSignature = req.headers.get('x-signature')
  const xRequestId = req.headers.get('x-request-id')

  const url = new URL(req.url)
  const dataId =
    url.searchParams.get('data.id') ??
    url.searchParams.get('id') ??
    extractDataId(rawBody)

  // 2. Validacion de firma (omitida en SANDBOX/STUB).
  const firma = validarFirmaWebhook({ xSignature, xRequestId, dataId })
  if (!firma.valido) {
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 })
  }

  // 3. Determinar el paymentId del payload y responder 200 cuanto antes.
  const paymentId = extractPaymentId(rawBody, url)

  if (paymentId) {
    // 4. Procesamiento en background: no bloquea la respuesta.
    after(async () => {
      try {
        await webhookPago({ paymentId })
      } catch (error) {
        console.error('[escrow][webhook] fallo el procesamiento en background', error)
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
    // Formato IPN clasico: ?topic=payment&id=...
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
