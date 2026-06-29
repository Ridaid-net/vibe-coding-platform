import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { listarNotificaciones } from '@/src/services/notif.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/usuario/notificaciones — bandeja de notificaciones del ciclista
 * autenticado. Soporta paginado (?limit, ?offset) y filtro ?soloNoLeidas=true.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const url = new URL(req.url)
    const soloNoLeidas =
      url.searchParams.get('soloNoLeidas') === 'true' ||
      url.searchParams.get('soloNoLeidas') === '1'
    const limitParam = url.searchParams.get('limit')
    const offsetParam = url.searchParams.get('offset')

    const resultado = await listarNotificaciones(user.id, {
      soloNoLeidas,
      limit: limitParam ? Number(limitParam) : undefined,
      offset: offsetParam ? Number(offsetParam) : undefined,
    })
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
