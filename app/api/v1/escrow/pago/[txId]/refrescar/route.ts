import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { getTransaccion, refrescarPago } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/escrow/pago/:txId/refrescar — re-consulta a MercadoPago el
 * estado real del pago y reaplica la transicion del escrow si corresponde.
 */
export async function POST(
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

    const resultado = await refrescarPago(txId)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
