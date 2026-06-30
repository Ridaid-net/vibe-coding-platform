import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { listarInspectores, listarTalleresAprobados, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/identidades/inspectores — inspectores (Hito 11) con su
 * licencia, talleres autorizados y volumen de inspecciones, mas el catalogo de
 * talleres aprobados disponibles para asignar. Sin datos personales en claro.
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'identidades:ver')
    const [inspectores, talleres] = await Promise.all([
      listarInspectores(),
      listarTalleresAprobados(),
    ])
    return NextResponse.json({ inspectores, talleres })
  } catch (error) {
    return jsonError(error)
  }
}
