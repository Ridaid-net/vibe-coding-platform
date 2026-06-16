import { NextResponse } from 'next/server'
import { rotateRefreshSession } from '@/lib/auth'
import { getRequestMeta } from '@/lib/auth-http'
import { ApiError, jsonError } from '@/lib/marketplace'

export const runtime = 'nodejs'

/**
 * POST /api/v1/auth/refresh — Renueva la sesion a partir del RefreshToken.
 *
 * Rota el RefreshToken (revoca el anterior y emite uno nuevo) y devuelve un
 * AccessToken fresco. Si el RefreshToken es invalido, expiro o ya fue usado,
 * responde 401: el cliente debe descartar la sesion y forzar un nuevo login.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { refreshToken?: unknown }
    const refreshToken =
      typeof body.refreshToken === 'string' ? body.refreshToken : null

    if (!refreshToken) {
      throw new ApiError(
        400,
        'REFRESH_TOKEN_REQUERIDO',
        'Falta el refreshToken.'
      )
    }

    const result = await rotateRefreshSession(refreshToken, getRequestMeta(req))

    return NextResponse.json({
      accessToken: result.accessToken,
      token: result.accessToken,
      refreshToken: result.refreshToken,
      tokenType: 'Bearer' as const,
    })
  } catch (error) {
    return jsonError(error)
  }
}
