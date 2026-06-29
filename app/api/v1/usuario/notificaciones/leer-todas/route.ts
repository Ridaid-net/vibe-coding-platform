import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { marcarTodasLeidas } from '@/src/services/notif.service'

export const runtime = 'nodejs'

/**
 * PATCH /api/v1/usuario/notificaciones/leer-todas — marca todas las notificaciones no
 * leidas del usuario autenticado como leidas.
 */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser(req)
    const resultado = await marcarTodasLeidas(user.id)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
