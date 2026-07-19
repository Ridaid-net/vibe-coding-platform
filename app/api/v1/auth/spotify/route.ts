import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

/**
 * GET /api/v1/auth/spotify — arranca el OAuth2 authorization-code de
 * Spotify. Mismo patron que /api/v1/auth/strava (lee el userId de la cookie
 * `nf_jwt`, lo viaja en `state`). Scope minimo: `user-top-read` (ver
 * spotify.service.ts para el motivo de por que no se pide
 * `user-read-recently-played`).
 */
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? ''
const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ?? 'https://rodaid.net/api/v1/auth/spotify/callback'

export async function GET(req: NextRequest) {
  let userId = 'anonimo'
  try {
    const cookie = req.cookies.get('nf_jwt')?.value
    if (cookie) {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'rodaid')
      const { payload } = await jwtVerify(cookie, secret)
      if (payload.sub) userId = payload.sub as string
    }
  } catch {}

  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64url')

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'user-top-read',
    state,
    show_dialog: 'false',
  })

  return NextResponse.redirect(`https://accounts.spotify.com/authorize?${params}`)
}
