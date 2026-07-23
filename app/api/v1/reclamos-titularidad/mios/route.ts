import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { listarReclamosPorUsuario } from '@/src/services/reclamos-titularidad.service'

export const runtime = 'nodejs'

/** GET /api/v1/reclamos-titularidad/mios — reclamos donde participo, como reclamante o como dueño actual. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const reclamos = await listarReclamosPorUsuario(user.id)
    return NextResponse.json({ reclamos })
  } catch (error) {
    return jsonError(error)
  }
}
