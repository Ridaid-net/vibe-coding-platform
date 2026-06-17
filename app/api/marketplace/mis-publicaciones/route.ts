import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerMisPublicaciones } from '@/src/services/garaje.service'

export const runtime = 'nodejs'

/**
 * GET /api/marketplace/mis-publicaciones — Hito 14: Garaje Digital.
 *
 * Lista las publicaciones del usuario como VENDEDOR (listados activos e
 * historicos) con la transaccion de escrow viva asociada, para la gestion de
 * venta desde el Garaje. No expone datos del comprador.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const publicaciones = await obtenerMisPublicaciones(user.id)
    return NextResponse.json(
      {
        publicaciones,
        activas: publicaciones.filter((p) => p.estado === 'ACTIVA').length,
      },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
