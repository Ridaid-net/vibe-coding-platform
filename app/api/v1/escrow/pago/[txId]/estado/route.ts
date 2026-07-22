import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { getEstadoPago, getTransaccion } from '@/src/services/escrow.service'
import { getEstadoSolicitudCitExpress } from '@/src/services/cit-express-pago.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/escrow/pago/:txId/estado — estado del pago de una transaccion.
 *
 * Polimorfico a proposito: :txId puede ser un id de escrow_transacciones (el
 * caso original, Marketplace/CIT Completo) o de solicitudes_cit_express (CIT
 * Express, self-service o via "Iniciar Certificacion") -- misma pantalla de
 * resultado (app/checkout/resultado/page.tsx) sirve a ambos flujos de pago,
 * asi que este endpoint prueba escrow primero y cae a CIT Express si no
 * encuentra nada. Ver CLAUDE.md, bug real encontrado 2026-07-21.
 */
export async function GET(
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
      const pago = await getEstadoPago(txId)
      return NextResponse.json({
        tipo: 'escrow',
        transaccionId: txId,
        estado: transaccion.estado,
        plan: transaccion.plan,
        pago,
      })
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'TRANSACCION_NOT_FOUND') {
        throw error
      }
    }

    const solicitud = await getEstadoSolicitudCitExpress(txId)
    if (!solicitud) {
      throw new ApiError(404, 'TRANSACCION_NOT_FOUND', 'La transaccion no existe.')
    }
    if (solicitud.ciclistaId !== user.id) {
      throw new ApiError(403, 'NOT_PARTICIPANT', 'No participas de esta transaccion.')
    }
    return NextResponse.json({
      tipo: 'cit_express',
      transaccionId: txId,
      estado: solicitud.estado,
      pago: { monto: solicitud.montoARS, paymentId: solicitud.feePaymentId },
    })
  } catch (error) {
    return jsonError(error)
  }
}
