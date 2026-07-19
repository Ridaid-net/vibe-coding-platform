import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerTopTracks } from '@/src/services/spotify.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/spotify/top-tracks — top tracks recientes del usuario
 * autenticado (para la tarjeta semanal del Garaje). Requiere sesion real
 * (a diferencia de /marketplace/[id], esto es siempre un dato privado del
 * propio usuario, nunca contenido publico).
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const data = await obtenerTopTracks(user.id)
    return NextResponse.json(data)
  } catch (error) {
    return jsonError(error)
  }
}
