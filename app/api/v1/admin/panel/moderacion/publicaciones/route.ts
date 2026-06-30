import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { listarPublicacionesDisputa, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/moderacion/publicaciones — publicaciones bajo
 * escrutinio (en disputa, pausadas/rechazadas o de cuentas suspendidas).
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'moderacion:ver')
    return NextResponse.json({ publicaciones: await listarPublicacionesDisputa() })
  } catch (error) {
    return jsonError(error)
  }
}
