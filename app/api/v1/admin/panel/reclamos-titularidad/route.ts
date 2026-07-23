import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { obtenerColaRevisionReclamos, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/reclamos-titularidad — cola de revisión humana
 * (Esquema 3: dueño actual no respondió en 48hs). Priorizada (no filtrada)
 * por si el cruce contra la base de robadas del Ministerio dio ROJO.
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'moderacion:ver')
    return NextResponse.json({ reclamos: await obtenerColaRevisionReclamos() })
  } catch (error) {
    return jsonError(error)
  }
}
