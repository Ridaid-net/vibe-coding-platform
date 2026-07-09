import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerDenunciaTerceroPorBici } from '@/src/services/denuncia-tercero.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/bicicletas/:id/denuncia-tercero — denuncia de tercero mas
 * reciente sobre esta bici, para el propietario (vista del Garaje). Devuelve
 * `{ denuncia: null }` si no hay ninguna. Cuando estado === 'ESPERANDO_PROPIETARIO',
 * el frontend deberia mostrarle al dueño el prompt de confirmar/negar.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const denuncia = await obtenerDenunciaTerceroPorBici(id, user.id)
    return NextResponse.json({ denuncia }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return jsonError(error)
  }
}
