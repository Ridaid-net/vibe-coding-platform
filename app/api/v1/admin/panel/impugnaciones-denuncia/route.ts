import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { obtenerColaRevisionImpugnaciones, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/impugnaciones-denuncia — cola de revisión humana
 * (Esquema 4: toda impugnación dispara revisión obligatoria, no hay camino
 * automático). Incluye los antecedentes del denunciante para darle contexto
 * al revisor.
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'moderacion:ver')
    return NextResponse.json({ impugnaciones: await obtenerColaRevisionImpugnaciones() })
  } catch (error) {
    return jsonError(error)
  }
}
