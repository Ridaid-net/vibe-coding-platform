import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { estadoIntegridad, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/integridad — Monitor de Integridad del Sistema: estado
 * en tiempo real de los servicios (BFA, API Gateway, Netlify Blobs, Webhooks del
 * Ministerio) y el semaforo de los nodos de la Blockchain Federal Argentina.
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'integridad:ver')
    return NextResponse.json(await estadoIntegridad())
  } catch (error) {
    return jsonError(error)
  }
}
