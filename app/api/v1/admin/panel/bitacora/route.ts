import { NextResponse } from 'next/server'
import { jsonError, optionalText } from '@/lib/marketplace'
import { listarBitacora, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/bitacora — bitacora INMUTABLE de las acciones del panel
 * (quien, que, cuando, sobre que recurso). Disponible para auditores.
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'bitacora:ver')
    const accion = optionalText(new URL(req.url).searchParams.get('accion'))
    return NextResponse.json({ entradas: await listarBitacora({ accion: accion ?? undefined }) })
  } catch (error) {
    return jsonError(error)
  }
}
