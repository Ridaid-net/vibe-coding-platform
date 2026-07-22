import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireRole } from '@/lib/marketplace'
import { resolverAliadoParaLectura } from '@/src/services/inspeccion.service'
import { listarSolicitudesReservaPorAliado } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/taller/reservas — Solicitudes de reserva de CIT del Taller
 * Aliado autenticado (o, para un admin, del aliado elegido via "Ver como").
 * Restringido a aliado/admin. Query opcional: ?estado=pendiente|contactado|cerrada
 */
export async function GET(req: Request) {
  try {
    const user = await requireRole('aliado', 'admin')(req)
    const url = new URL(req.url)
    const verComoAliado = url.searchParams.get('verComoAliado')
    const estado = url.searchParams.get('estado') ?? undefined

    const { aliado, modo } = await resolverAliadoParaLectura(user, verComoAliado)
    if (!aliado) {
      throw new ApiError(403, 'SIN_ALIADO', 'No tenes un Taller Aliado propio vinculado.')
    }

    const solicitudes = await listarSolicitudesReservaPorAliado(aliado.id, estado)
    return NextResponse.json({ solicitudes, modoVista: modo })
  } catch (error) {
    return jsonError(error)
  }
}
