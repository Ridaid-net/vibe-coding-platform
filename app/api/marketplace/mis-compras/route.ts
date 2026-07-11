import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerMisCompras } from '@/src/services/garaje.service'

export const runtime = 'nodejs'

/**
 * GET /api/marketplace/mis-compras — Item 4 (prioridad 3): seguimiento del
 * comprador.
 *
 * Lista las compras/reservas del usuario como COMPRADOR (flujo generico y
 * las tres etapas del flujo CIT Completo) para el seguimiento desde el
 * Garaje. No expone datos del vendedor mas alla de lo publico de la
 * publicacion.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const compras = await obtenerMisCompras(user.id)
    return NextResponse.json(
      { compras },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
