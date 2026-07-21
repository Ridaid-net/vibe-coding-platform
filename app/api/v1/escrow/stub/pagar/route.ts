import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireUser } from '@/lib/marketplace'
import { getTransaccion, simularDeposito } from '@/src/services/escrow.service'
import {
  getEstadoSolicitudCitExpress,
  webhookPagoCitExpress,
} from '@/src/services/cit-express-pago.service'
import { getModo } from '@/src/services/mercadopago.service'

export const runtime = 'nodejs'

interface Body {
  transaccionId?: unknown
  transaccion_id?: unknown
  paymentId?: unknown
  payment_id?: unknown
}

/**
 * POST /api/v1/escrow/stub/pagar — simula un deposito/pago aprobado.
 * Disponible solo fuera del modo LIVE, para ejercitar el flujo sin pagos
 * reales. Polimorfico (escrow o CIT Express) -- misma pantalla de checkout
 * simulada (app/escrow/stub/checkout/page.tsx) sirve a ambos flujos de pago.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Body

    const transaccionId = optionalText(body.transaccionId ?? body.transaccion_id)
    if (!transaccionId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'transaccionId es obligatorio.')
    }

    try {
      const transaccion = await getTransaccion(transaccionId)
      if (transaccion.compradorId !== user.id) {
        throw new ApiError(403, 'NOT_BUYER', 'Solo el comprador puede simular el pago.')
      }
      const resultado = await simularDeposito({
        transaccionId,
        paymentId: optionalText(body.paymentId ?? body.payment_id) ?? undefined,
      })
      return NextResponse.json({ tipo: 'escrow', ...resultado })
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'TRANSACCION_NOT_FOUND') {
        throw error
      }
    }

    if (getModo() === 'LIVE') {
      throw new ApiError(403, 'STUB_DESHABILITADO', 'La simulacion no esta disponible en modo LIVE.')
    }
    const solicitud = await getEstadoSolicitudCitExpress(transaccionId)
    if (!solicitud) {
      throw new ApiError(404, 'TRANSACCION_NOT_FOUND', 'La transaccion no existe.')
    }
    if (solicitud.ciclistaId !== user.id) {
      throw new ApiError(403, 'NOT_BUYER', 'Solo el comprador puede simular el pago.')
    }
    const paymentId =
      optionalText(body.paymentId ?? body.payment_id) ?? `stub-pay-${transaccionId}`
    const resultado = await webhookPagoCitExpress({
      paymentId,
      externalReferenceHint: transaccionId,
    })
    return NextResponse.json({ tipo: 'cit_express', ...resultado })
  } catch (error) {
    return jsonError(error)
  }
}
