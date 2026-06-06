import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { getEstadoPago, getTransaccion } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/** GET /api/v1/escrow/pago/:txId/estado — estado del pago de una transaccion. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ txId: string }> }
) {
  try {
    const { txId } = await params
    const user = await requireUser(req)
    const transaccion = await getTransaccion(txId)

    if (
      transaccion.compradorId !== user.id &&
      transaccion.vendedorId !== user.id
    ) {
      throw new ApiError(403, 'NOT_PARTICIPANT', 'No participas de esta transaccion.')
    }

    const pago = await getEstadoPago(txId)
    return NextResponse.json({ transaccionId: txId, estado: transaccion.estado, pago })
  } catch (error) {
    return jsonError(error)
  }
}
