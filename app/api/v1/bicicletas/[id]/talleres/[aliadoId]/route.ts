import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { revocarAccesoTaller } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

/**
 * DELETE /api/v1/bicicletas/[id]/talleres/[aliadoId] — el dueño revoca el
 * acceso de un taller a su bici. Si era el principal, la bici queda SIN
 * principal (bloqueada para CIT Completo, 422 SIN_TALLER_VINCULADO) hasta
 * que el dueño elija uno nuevo -- nunca se promueve otro automaticamente.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; aliadoId: string }> }
) {
  try {
    const { id, aliadoId } = await params
    const user = await requireUser(req)
    await revocarAccesoTaller({ propietarioId: user.id, bicicletaId: id, aliadoId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
