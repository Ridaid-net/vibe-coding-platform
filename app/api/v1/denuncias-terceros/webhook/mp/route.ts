import { after, NextResponse } from 'next/server'
import { webhookPagoDenunciaTercero } from '@/src/services/denuncia-tercero.service'
import { validarFirmaWebhook } from '@/src/services/mercadopago.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/denuncias-terceros/webhook/mp — IPN de MercadoPago para la
 * retencion de la denuncia de terceros (Fase 7, caso 3). Calco exacto de
 * /api/v1/denuncias/webhook/mp y /api/v1/escrow/webhook/mp -- webhook propio
 * y separado, mismo criterio de capas.
 *
 * Nota: mientras iniciarDenunciaTercero() siga bloqueado, nunca va a existir
 * una fila de denuncias_terceros real sobre la que este webhook pueda actuar
 * -- queda construido y listo para cuando el guard se saque.
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
        await webhookPagoDenunciaTercero({ paymentId })
      } catch (error) {
        console.error('[denuncia-tercero][webhook] fallo el procesamiento en background', error)
      }
    })
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

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
