import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { obtenerColaRevisionDisputasCit, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/disputas-cit-completo — cola de revisión humana
 * (Esquema 1 Caso B: 2da+ cancelación con evidencia de un vendedor).
 * Priorizada (no filtrada) por si el vendedor está en el umbral anti-fraude.
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'moderacion:ver')
    return NextResponse.json({ disputas: await obtenerColaRevisionDisputasCit() })
  } catch (error) {
    return jsonError(error)
  }
}
