import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerDisputaConEvidencia } from '@/src/services/disputas-cit-completo.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/disputas-cit-completo/:id — estado + metadata de evidencia
 * (sin los bytes) de una disputa. Solo el comprador o el vendedor de esa
 * disputa. Para descargar un archivo puntual, ver el endpoint
 * /evidencia/:evidenciaId.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const resultado = await obtenerDisputaConEvidencia(id, user.id)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
