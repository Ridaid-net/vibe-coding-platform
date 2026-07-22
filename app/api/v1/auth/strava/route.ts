import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { getPool, jsonError, requireUser } from '@/lib/marketplace'
import { descifrarStravaSeguro } from '@/src/services/cifrado.service'

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID ?? ''
const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI ?? 'https://rodaid.net/api/v1/auth/strava/callback'

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
    client_id: STRAVA_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'read,activity:read_all',
    state,
    approval_prompt: 'auto',
  })

  return NextResponse.redirect(`https://www.strava.com/oauth/authorize?${params}`)
}

/**
 * DELETE /api/v1/auth/strava — desconecta la cuenta de Strava del usuario
 * autenticado. Best-effort: intenta revocar el acceso del lado de Strava
 * (POST /oauth/deauthorize) antes de borrar la fila local -- si esa llamada
 * falla (red, token ya invalido, etc.) igual se borra la conexion local, para
 * que "Desconectar" nunca quede trabado por un problema del lado de Strava.
 */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req)
    const pool = getPool()

    const fila = await pool.query<{ access_token: string }>(
      `SELECT access_token FROM oauth_connections WHERE user_id = $1 AND provider = 'strava' LIMIT 1`,
      [user.id]
    )
    const row = fila.rows[0]
    if (row) {
      try {
        const { texto: accessToken } = descifrarStravaSeguro(row.access_token)
        await fetch(`https://www.strava.com/oauth/deauthorize?access_token=${encodeURIComponent(accessToken)}`, {
          method: 'POST',
        })
      } catch (err) {
        console.error('No se pudo revocar el token en Strava (se borra igual la conexion local):', err)
      }
    }

    await pool.query(
      `DELETE FROM oauth_connections WHERE user_id = $1 AND provider = 'strava'`,
      [user.id]
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
