import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerDenunciaTercero } from '@/src/services/denuncia-tercero.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/denuncias-terceros/:id — estado de una denuncia de tercero.
 * Solo la puede consultar quien la inicio (403 NOT_DENUNCIANTE si no).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const denuncia = await obtenerDenunciaTercero(id, user.id)
    return NextResponse.json({ denuncia }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return jsonError(error)
  }
}
