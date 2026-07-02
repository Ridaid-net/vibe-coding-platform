import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN ?? 'rodaid-strava-webhook'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const challenge = searchParams.get('hub.challenge')
  const token = searchParams.get('hub.verify_token')
  if (token !== VERIFY_TOKEN) {
    return NextResponse.json({ error: 'Token invalido' }, { status: 403 })
  }
  return NextResponse.json({ 'hub.challenge': challenge })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    console.info('[Strava Webhook] Evento recibido:', JSON.stringify(body))
    return NextResponse.json({ recibido: true })
  } catch {
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
