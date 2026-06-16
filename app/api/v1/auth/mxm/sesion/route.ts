import { NextResponse } from 'next/server'
import { canjearHandoff } from '@/src/services/mxm.service'
import { ApiError, jsonError } from '@/lib/marketplace'

export const runtime = 'nodejs'

/**
 * POST /api/v1/auth/mxm/sesion — Canjea el ticket de handoff por la sesion.
 *
 * Tras el callback de MxM, el frontend recibe un ticket de un solo uso (no los
 * tokens en la URL). Esta ruta lo canjea por la sesion real (AccessToken +
 * RefreshToken + datos del usuario) y la invalida en el acto. El cliente la
 * persiste con el mismo mecanismo que el login local.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON valido.')
    })) as { ticket?: unknown }

    const ticket = typeof body.ticket === 'string' ? body.ticket.trim() : ''
    if (!ticket) {
      throw new ApiError(400, 'MXM_TICKET_REQUERIDO', 'Falta el ticket de acceso.')
    }

    const sesion = await canjearHandoff(ticket)
    return NextResponse.json({
      ...sesion,
      token: sesion.accessToken,
      tokenType: 'Bearer' as const,
    })
  } catch (error) {
    return jsonError(error)
  }
}
