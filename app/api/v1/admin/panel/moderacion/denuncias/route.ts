import { NextResponse } from 'next/server'
import { jsonError, optionalText } from '@/lib/marketplace'
import { listarDenunciasModeracion, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/moderacion/denuncias — denuncias del MPF a moderar
 * (por defecto EN_REVISION). Permite verificar el PDF, aprobar/rechazar y
 * desbloquear activos.
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'moderacion:ver')
    const estado = optionalText(new URL(req.url).searchParams.get('estado'))
    return NextResponse.json({ denuncias: await listarDenunciasModeracion(estado ?? undefined) })
  } catch (error) {
    return jsonError(error)
  }
}
