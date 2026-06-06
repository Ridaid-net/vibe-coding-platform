import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { getEventos, getTransaccion } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/** GET /api/v1/transacciones/:id/eventos — audit trail completo (solo las partes). */
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

    const eventos = await getEventos(id)
    return NextResponse.json({ eventos })
  } catch (error) {
    return jsonError(error)
  }
}
