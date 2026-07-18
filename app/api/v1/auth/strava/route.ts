import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

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
