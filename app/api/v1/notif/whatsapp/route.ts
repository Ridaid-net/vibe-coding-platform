/**
 * RODAID · WhatsApp Business API
 * POST /api/v1/notif/whatsapp
 * Envía mensajes automáticos via WhatsApp Cloud API (Meta)
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireStaff } from '@/lib/marketplace'

const WA_TOKEN = process.env.WHATSAPP_TOKEN
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID
const WA_API = 'https://graph.facebook.com/v18.0'

type PlantillaWA = 'bienvenida_rodaid' | 'cit_emitido' | 'denuncia_activa' | 'bici_recuperada' | 'recordatorio_renovacion'

interface WaParams {
  telefono: string
  plantilla: PlantillaWA
  variables?: string[]
}

async function enviarWA({ telefono, plantilla, variables = [] }: WaParams) {
  if (!WA_TOKEN || !WA_PHONE_ID) return { ok: false, motivo: 'WhatsApp no configurado' }
  
  const tel = telefono.replace(/[^0-9]/g, '').replace(/^0/, '54')
  
  const res = await fetch(`${WA_API}/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: tel,
      type: 'template',
      template: {
        name: plantilla,
        language: { code: 'es_AR' },
        components: variables.length > 0 ? [{
          type: 'body',
          parameters: variables.map(v => ({ type: 'text', text: v }))
        }] : []
      }
    })
  })
  const data = await res.json()
  return { ok: res.ok, data }
}

export async function POST(req: Request) {
  try {
    await requireStaff(req, 'admin')
    const body = await req.json()
    const { telefono, plantilla, variables, usuarioId } = body

    if (!telefono && !usuarioId) {
      return NextResponse.json({ error: 'telefono o usuarioId es obligatorio.' }, { status: 400 })
    }

    let tel = telefono
    if (!tel && usuarioId) {
      const pool = getPool()
      const res = await pool.query('SELECT telefono FROM usuarios WHERE id = $1', [usuarioId])
      tel = res.rows[0]?.telefono
      if (!tel) return NextResponse.json({ error: 'Usuario sin teléfono registrado.' }, { status: 404 })
    }

    const resultado = await enviarWA({ telefono: tel, plantilla, variables })
    return NextResponse.json({ ok: resultado.ok, resultado })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// Webhook para recibir mensajes entrantes de WhatsApp
export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? '', { status: 200 })
  }
  return NextResponse.json({ error: 'Verificación fallida' }, { status: 403 })
}
