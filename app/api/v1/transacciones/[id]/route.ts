import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { getTransaccion } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/** GET /api/v1/transacciones/:id — estado de la transaccion (solo las partes). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const transaccion = await getTransaccion(id)

    if (
      transaccion.compradorId !== user.id &&
      transaccion.vendedorId !== user.id
    ) {
      throw new ApiError(403, 'NOT_PARTICIPANT', 'No participas de esta transaccion.')
    }

    return NextResponse.json({ transaccion })
  } catch (error) {
    return jsonError(error)
  }
}
