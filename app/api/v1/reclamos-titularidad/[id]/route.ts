import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerReclamoConEvidencia } from '@/src/services/reclamos-titularidad.service'

export const runtime = 'nodejs'

/** GET /api/v1/reclamos-titularidad/:id — lectura para el reclamante o el dueño actual. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const resultado = await obtenerReclamoConEvidencia(id, user.id)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
