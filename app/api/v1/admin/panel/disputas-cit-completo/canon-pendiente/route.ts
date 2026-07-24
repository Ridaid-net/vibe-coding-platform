import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { obtenerColaCanonPendienteDisputasCit, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/disputas-cit-completo/canon-pendiente — disputas
 * con canon retenido sin devolver, sin importar el estado (incluye
 * RESUELTA_AMARILLO, que nunca aparece en la cola de revisión humana).
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'moderacion:ver')
    return NextResponse.json({ disputas: await obtenerColaCanonPendienteDisputasCit() })
  } catch (error) {
    return jsonError(error)
  }
}
