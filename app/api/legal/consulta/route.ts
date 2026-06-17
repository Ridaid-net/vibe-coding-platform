import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import {
  buildCacheKey,
  CACHE_VERSION,
  getConsultaCacheStore,
  type ConsultaCacheEntry,
} from '@/lib/legal-cache'

// El handler usa Netlify Blobs y el SDK de Anthropic, que requieren el runtime
// de Node.js (no Edge). Se fuerza ejecución dinámica para que cada consulta se
// evalúe en tiempo de request y la cache la gestione Netlify Blobs.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Modelo servido a través de Netlify AI Gateway. El SDK de Anthropic detecta
// automáticamente ANTHROPIC_API_KEY y ANTHROPIC_BASE_URL inyectadas por
// Netlify, por lo que no se gestiona ninguna clave en el código.
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 1024
const MAX_CONSULTA_LENGTH = 4000

const SYSTEM_PROMPT = [
  'Sos un asistente legal de RODAID especializado en la compraventa de',
  'bicicletas en Argentina (marketplace, escrow y resolución de disputas).',
  'Respondé en español rioplatense, de forma clara, concisa y estructurada.',
  'Brindá orientación general y aclará siempre que no constituye asesoramiento',
  'legal formal y que ante dudas concretas se consulte a un profesional',
  'matriculado.',
].join(' ')

interface BodyData {
  consulta?: unknown
}

export async function POST(req: Request) {
  let body: BodyData
  try {
    body = (await req.json()) as BodyData
  } catch {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: 'El cuerpo debe ser JSON válido.' },
      { status: 400 }
    )
  }

  const consulta = typeof body.consulta === 'string' ? body.consulta.trim() : ''

  if (!consulta) {
    return NextResponse.json(
      {
        error: 'MISSING_CONSULTA',
        message: 'El campo "consulta" es obligatorio y no puede estar vacío.',
      },
      { status: 400 }
    )
  }

  if (consulta.length > MAX_CONSULTA_LENGTH) {
    return NextResponse.json(
      {
        error: 'CONSULTA_TOO_LONG',
        message: `La consulta no puede superar los ${MAX_CONSULTA_LENGTH} caracteres.`,
      },
      { status: 400 }
    )
  }

  const cacheKey = buildCacheKey(consulta, MODEL)
  const store = getConsultaCacheStore()

  // 1) Intentar servir desde cache (lectura tolerante a fallos del store).
  try {
    const cached = await store.get(cacheKey, { type: 'json' })
    if (cached) {
      const entry = cached as ConsultaCacheEntry
      return NextResponse.json(
        {
          consulta: entry.consulta,
          respuesta: entry.respuesta,
          modelo: entry.modelo,
          generadoEn: entry.generadoEn,
          fromCache: true,
        },
        { headers: { 'X-From-Cache': '1' } }
      )
    }
  } catch (error) {
    console.error('No se pudo leer la cache de consultas legales:', error)
  }

  // 2) No hay cache: generar la respuesta vía Netlify AI Gateway.
  let respuesta: string
  try {
    const anthropic = new Anthropic()
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: consulta }],
    })

    respuesta = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    if (!respuesta) {
      throw new Error('El modelo no devolvió contenido de texto.')
    }
  } catch (error) {
    console.error('Error al generar la consulta legal:', error)
    return NextResponse.json(
      {
        error: 'AI_GATEWAY_ERROR',
        message: 'No se pudo generar la respuesta en este momento.',
      },
      { status: 502 }
    )
  }

  const entry: ConsultaCacheEntry = {
    consulta,
    respuesta,
    modelo: MODEL,
    generadoEn: new Date().toISOString(),
    version: CACHE_VERSION,
  }

  // 3) Persistir en cache (no bloquear la respuesta si la escritura falla).
  try {
    await store.setJSON(cacheKey, entry)
  } catch (error) {
    console.error('No se pudo escribir en la cache de consultas legales:', error)
  }

  return NextResponse.json(
    {
      consulta: entry.consulta,
      respuesta: entry.respuesta,
      modelo: entry.modelo,
      generadoEn: entry.generadoEn,
      fromCache: false,
    },
    { headers: { 'X-From-Cache': '0' } }
  )
}
