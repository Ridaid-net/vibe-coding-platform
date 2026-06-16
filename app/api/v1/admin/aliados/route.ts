import { NextResponse } from 'next/server'
import { jsonError, requireStaff } from '@/lib/marketplace'
import { listarAliados } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/aliados?estado=pendiente — Listado de solicitudes de aliados.
 *
 * Restringido a staff (rol admin via JWT o token de sistema). Sin filtro,
 * devuelve todas, con las pendientes primero.
 */
export async function GET(req: Request) {
  try {
    await requireStaff(req, 'admin')
    const url = new URL(req.url)
    const estado = url.searchParams.get('estado') ?? undefined
    const aliados = await listarAliados(estado)
    return NextResponse.json({ aliados })
  } catch (error) {
    return jsonError(error)
  }
}
