import { after, NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { procesarEventoStrava, type EventoStrava } from '@/src/services/strava-webhook.service'

export const runtime = 'nodejs'

const VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN ?? 'rodaid-strava-webhook'

/**
 * Verificación de suscripción del webhook (handshake de Strava). Sin
 * cambios respecto al stub original -- ya estaba bien implementado.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const challenge = searchParams.get('hub.challenge')
  const token = searchParams.get('hub.verify_token')
  if (token !== VERIFY_TOKEN) {
    return NextResponse.json({ error: 'Token invalido' }, { status: 403 })
  }
  return NextResponse.json({ 'hub.challenge': challenge })
}

/**
 * Ingesta de eventos. Responde 200 rápido (Strava reintenta si no ve un
 * 2xx en poco tiempo) y procesa en segundo plano con after() -- mismo
 * patrón ya usado en /api/v1/denuncias/webhook/mp y
 * /api/v1/cit-express/webhook/mp.
 */
export async function POST(req: NextRequest) {
  const evento = (await req.json().catch(() => null)) as EventoStrava | null

  if (evento) {
    after(async () => {
      try {
        await procesarEventoStrava(evento)
      } catch (error) {
        console.error('[strava][webhook] fallo el procesamiento en background', error)
      }
    })
  }

  return NextResponse.json({ recibido: true }, { status: 200 })
}
