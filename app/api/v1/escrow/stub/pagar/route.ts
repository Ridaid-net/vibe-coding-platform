import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireUser } from '@/lib/marketplace'
import { getTransaccion, simularDeposito } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

interface Body {
  transaccionId?: unknown
  transaccion_id?: unknown
  paymentId?: unknown
  payment_id?: unknown
}

/**
 * POST /api/v1/escrow/stub/pagar — simula un deposito aprobado.
 * Disponible solo fuera del modo LIVE, para ejercitar el flujo sin pagos reales.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Body

    const transaccionId = optionalText(body.transaccionId ?? body.transaccion_id)
    if (!transaccionId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'transaccionId es obligatorio.')
    }

    const transaccion = await getTransaccion(transaccionId)
    if (transaccion.compradorId !== user.id) {
      throw new ApiError(403, 'NOT_BUYER', 'Solo el comprador puede simular el pago.')
    }

    const resultado = await simularDeposito({
      transaccionId,
      paymentId: optionalText(body.paymentId ?? body.payment_id) ?? undefined,
    })

    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
