import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireRole } from '@/lib/marketplace'
import { resolverAliadoDeUsuario } from '@/src/services/inspeccion.service'
import { marcarSolicitudReserva } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

interface Body {
  estado?: unknown
}

/**
 * POST /api/v1/taller/reservas/[id] — El taller marca una solicitud como
 * "contactado" o "cerrada". Ownership-scoped al aliado propio del usuario
 * autenticado (nunca via "Ver como" -- mismo criterio que el resto de las
 * acciones que mutan, ver Admin View-As en CLAUDE.md).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireRole('aliado', 'admin')(req)
    const body = (await req.json().catch(() => ({}))) as Body

    const estado = body.estado === 'contactado' || body.estado === 'cerrada' ? body.estado : null
    if (!estado) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'estado debe ser contactado o cerrada.')
    }

    const aliado = await resolverAliadoDeUsuario(user.id)
    if (!aliado) {
      throw new ApiError(403, 'SIN_ALIADO', 'No tenes un Taller Aliado propio vinculado.')
    }

    await marcarSolicitudReserva(aliado.id, id, estado)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
