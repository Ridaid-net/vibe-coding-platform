import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { confirmarEntrega } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/transacciones/:id/confirmar-entrega — el comprador confirma la
 * recepcion y libera la liquidacion (precio - comision) al vendedor.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)

    const transaccion = await confirmarEntrega({
      transaccionId: id,
      compradorId: user.id,
    })

    return NextResponse.json({ transaccion })
  } catch (error) {
    return jsonError(error)
  }
}
