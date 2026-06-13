import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { detalleBicicleta } from '@/src/services/garaje.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/usuario/bicicletas/:id — detalle de un rodado propio más el
 * historial de hasta 10 de sus CITs. Requiere JWT y verifica propiedad.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser(req)
    const { id } = await params
    const data = await detalleBicicleta(user.id, id)
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return jsonError(error)
  }
}
