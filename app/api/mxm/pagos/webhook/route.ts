import { after, NextResponse } from 'next/server'
import { confirmarPagoTasa, validarFirmaWebhookMxm } from '@/src/services/tasa-cit.service'

export const runtime = 'nodejs'

/**
 * POST /api/mxm/pagos/webhook — confirmacion ASINCRONA de la pasarela estatal
 * (Mendoza por Mi) para la Tasa CIT. Idempotente: localiza la tasa por su
 * referencia externa y solo transiciona desde PENDIENTE. Responde 200 rapido y
 * procesa en background (la pasarela reintenta si tarda).
 */
export async function POST(req: Request) {
  const rawBody = await req.text()
  const firma = req.headers.get('x-mxm-signature') ?? req.headers.get('x-signature')

  const verificacion = validarFirmaWebhookMxm({ rawBody, firma })
  if (!verificacion.valido) {
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 })
  }

  let payload: {
    referencia?: string
    referencia_externa?: string
    estado?: string
    status?: string
    comprobante?: string
  } = {}
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const referenciaExterna = payload.referencia_externa ?? payload.referencia ?? null
  const estadoRaw = (payload.estado ?? payload.status ?? '').toUpperCase()
  const estado: 'PAGADA' | 'RECHAZADA' =
    estadoRaw === 'PAGADA' || estadoRaw === 'APPROVED' || estadoRaw === 'PAID'
      ? 'PAGADA'
      : 'RECHAZADA'

  if (referenciaExterna) {
    after(async () => {
      try {
        await confirmarPagoTasa({
          referenciaExterna,
          estado,
          comprobante: payload.comprobante ?? null,
        })
      } catch (error) {
        console.error('[mxm-pagos][webhook] fallo el procesamiento', error)
      }
    })
  }

  return NextResponse.json({ received: true }, { status: 200 })
}
