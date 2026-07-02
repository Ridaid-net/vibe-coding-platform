import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireUser } from '@/lib/marketplace'

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID ?? ''
const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI ?? 'https://rodaid.net/api/v1/auth/strava/callback'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  let userId = 'anonimo'
  try { const u = await requireUser(req); userId = u.id } catch {}
  const tenantId = searchParams.get('tenantId') ?? 'rodaid'

  const state = Buffer.from(JSON.stringify({ userId, tenantId, ts: Date.now() })).toString('base64url')

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
