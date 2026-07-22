import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireRole } from '@/lib/marketplace'
import { resolverAliadoDeUsuario } from '@/src/services/inspeccion.service'
import { listarPrestamosPorTaller } from '@/src/services/prestamos-bici.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/taller/prestamos — bicis en préstamo/disponibles del Taller
 * Aliado autenticado. Ownership-scoped al aliado propio -- sin soporte de
 * Admin View-As (esta feature no lo necesita, a diferencia del resto del
 * panel que sí lo tiene para paneles con mas trafico de soporte).
 */
export async function GET(req: Request) {
  try {
    const user = await requireRole('aliado', 'admin')(req)
    const aliado = await resolverAliadoDeUsuario(user.id)
    if (!aliado) {
      throw new ApiError(403, 'SIN_ALIADO', 'No tenes un Taller Aliado propio vinculado.')
    }
    const prestamos = await listarPrestamosPorTaller(aliado.id)
    return NextResponse.json({ prestamos })
  } catch (error) {
    return jsonError(error)
  }
}
