import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { marcarLeida } from '@/src/services/notif.service'

export const runtime = 'nodejs'

/**
 * PATCH /api/v1/usuario/notificaciones/:id/leer — marca una notificacion del usuario
 * autenticado como leida. Solo afecta notificaciones propias.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser(req)
    const { id } = await params
    const notificacion = await marcarLeida(user.id, id)
    if (!notificacion) {
      throw new ApiError(404, 'NOTIF_NOT_FOUND', 'La notificacion no existe.')
    }
    return NextResponse.json({ notificacion })
  } catch (error) {
    return jsonError(error)
  }
}
