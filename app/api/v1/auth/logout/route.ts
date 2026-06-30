import { NextResponse } from 'next/server'
import { revokeSession } from '@/lib/auth'
import { jsonError } from '@/lib/marketplace'

export const runtime = 'nodejs'

/**
 * POST /api/v1/auth/logout — Cierra la sesion revocando el RefreshToken.
 *
 * Idempotente: si el token no existe o ya estaba revocado, responde igual sin
 * error. El AccessToken (de vida corta) caduca por si solo.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { refreshToken?: unknown }
    const refreshToken =
      typeof body.refreshToken === 'string' ? body.refreshToken : null

    if (refreshToken) {
      await revokeSession(refreshToken)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
