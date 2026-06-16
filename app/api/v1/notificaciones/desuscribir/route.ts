import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { eliminarSuscripcion } from '@/src/services/notification.service'

export const runtime = 'nodejs'

interface DesuscribirBody {
  endpoint?: unknown
}

/**
 * DELETE /api/v1/notificaciones/desuscribir
 *
 * Da de baja la suscripcion de Web Push del navegador (el usuario apaga las
 * notificaciones). Acotada al usuario duenno: no borra suscripciones ajenas.
 */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as DesuscribirBody
    const endpoint =
      typeof body.endpoint === 'string' && body.endpoint.trim().length > 0
        ? body.endpoint.trim()
        : null

    if (!endpoint) {
      throw new ApiError(
        400,
        'ENDPOINT_REQUERIDO',
        'Falta el endpoint de la suscripción a dar de baja.'
      )
    }

    const eliminada = await eliminarSuscripcion(user.id, endpoint)
    return NextResponse.json({ ok: true, eliminada })
  } catch (error) {
    return jsonError(error)
  }
}
