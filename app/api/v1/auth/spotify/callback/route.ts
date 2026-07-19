import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getPool } from '@/lib/marketplace'
import { cifrarSpotify } from '@/src/services/cifrado.service'
import { spotifyBasicAuthHeader } from '@/src/services/spotify.service'

/**
 * GET /api/v1/auth/spotify/callback — intercambia el `code` por tokens
 * (Basic Auth con client_id:client_secret, requerido por el token endpoint
 * de Spotify -- distinto del body JSON que usa Strava), identifica la
 * cuenta (GET /v1/me, el token endpoint de Spotify no devuelve el user id
 * como si lo hace Strava en `athlete.id`) y guarda la conexion cifrada en
 * `oauth_connections` (provider = 'spotify').
 *
 * Un rechazo de Spotify (p. ej. el usuario #6 en Development Mode, no
 * agregado como tester) llega aca como `?error=...` en la query -- mismo
 * manejo que el `error`/`state` invalido de Strava, sin caso especial.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code || !state) {
    return NextResponse.redirect(new URL('/garaje?error=spotify_cancelada', req.url))
  }

  let userId: string
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
    userId = decoded.userId
    if (!userId) throw new Error('Estado invalido')
  } catch {
    return NextResponse.redirect(new URL('/garaje?error=spotify_state_invalido', req.url))
  }

  try {
    const redirectUri =
      process.env.SPOTIFY_REDIRECT_URI ?? 'https://rodaid.net/api/v1/auth/spotify/callback'

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: spotifyBasicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })
    if (!tokenRes.ok) throw new Error('Error token Spotify')
    const data = (await tokenRes.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { authorization: `Bearer ${data.access_token}` },
    })
    if (!meRes.ok) throw new Error('No se pudo identificar la cuenta de Spotify')
    const me = (await meRes.json()) as { id: string }

    const pool = getPool()
    await pool.query(
      `INSERT INTO oauth_connections
        (user_id, provider, provider_user_id, access_token, refresh_token, expires_at, scope)
       VALUES ($1, 'spotify', $2, $3, $4, $5, 'user-top-read')
       ON CONFLICT (provider, provider_user_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [
        userId,
        me.id,
        cifrarSpotify(data.access_token),
        cifrarSpotify(data.refresh_token),
        new Date(Date.now() + data.expires_in * 1000),
      ]
    )

    return NextResponse.redirect(new URL('/garaje?spotify=vinculada', req.url))
  } catch (err) {
    console.error('[Spotify callback]', err)
    return NextResponse.redirect(new URL('/garaje?error=spotify_error', req.url))
  }
}
