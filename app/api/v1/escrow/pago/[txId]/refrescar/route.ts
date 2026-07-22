import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { getTransaccion, refrescarPago } from '@/src/services/escrow.service'
import {
  getEstadoSolicitudCitExpress,
  refrescarPagoCitExpress,
} from '@/src/services/cit-express-pago.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/escrow/pago/:txId/refrescar — re-consulta a MercadoPago el
 * estado real del pago y reaplica la transicion correspondiente. Polimorfico
 * (escrow o CIT Express) -- ver el comentario del GET .../estado hermano.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ txId: string }> }
) {
  try {
    const { txId } = await params
    const user = await requireUser(req)

    try {
      const transaccion = await getTransaccion(txId)
      if (
        transaccion.compradorId !== user.id &&
        transaccion.vendedorId !== user.id
      ) {
        throw new ApiError(403, 'NOT_PARTICIPANT', 'No participas de esta transaccion.')
      }
      const resultado = await refrescarPago(txId)
      return NextResponse.json({ tipo: 'escrow', ...resultado })
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'TRANSACCION_NOT_FOUND') {
        throw error
      }
    }

    const solicitudPrevia = await getEstadoSolicitudCitExpress(txId)
    if (!solicitudPrevia) {
      throw new ApiError(404, 'TRANSACCION_NOT_FOUND', 'La transaccion no existe.')
    }
    if (solicitudPrevia.ciclistaId !== user.id) {
      throw new ApiError(403, 'NOT_PARTICIPANT', 'No participas de esta transaccion.')
    }
    const resultado = await refrescarPagoCitExpress(txId)
    return NextResponse.json({ tipo: 'cit_express', ...resultado })
  } catch (error) {
    return jsonError(error)
  }
}
