import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { listarApiKeys, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/identidades/api-keys — accesos de terceros (Hito 16):
 * aplicaciones de aseguradoras / logistica con su estado, scopes y uso reciente.
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'identidades:ver')
    return NextResponse.json({ apps: await listarApiKeys() })
  } catch (error) {
    return jsonError(error)
  }
}
