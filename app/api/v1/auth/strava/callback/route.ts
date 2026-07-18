import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getPool } from '@/lib/marketplace'
import { cifrarStrava } from '@/src/services/cifrado.service'

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID ?? ''
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET ?? ''

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code || !state) {
    return NextResponse.redirect(new URL('/garaje?error=strava_cancelada', req.url))
  }

  let userId: string
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
    userId = decoded.userId
    if (!userId) throw new Error('Estado invalido')
  } catch {
    return NextResponse.redirect(new URL('/garaje?error=strava_state_invalido', req.url))
  }

  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) throw new Error('Error token Strava')
    const data = await tokenRes.json() as {
      access_token: string
      refresh_token: string
      expires_at: number
      athlete: { id: number }
    }

    const pool = getPool()
    await pool.query(
      `INSERT INTO oauth_connections
        (user_id, provider, provider_user_id, access_token, refresh_token, expires_at)
       VALUES ($1, 'strava', $2, $3, $4, to_timestamp($5))
       ON CONFLICT (provider, provider_user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [userId, String(data.athlete.id), cifrarStrava(data.access_token), cifrarStrava(data.refresh_token), data.expires_at]
    )

    return NextResponse.redirect(new URL('/garaje?strava=vinculada', req.url))
  } catch (err) {
    console.error('[Strava callback]', err)
    return NextResponse.redirect(new URL('/garaje?error=strava_error', req.url))
  }
}
