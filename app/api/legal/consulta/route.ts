import { NextResponse } from 'next/server'
import { getStore } from '@netlify/blobs'
import {
  buildCacheKey,
  classifyUrlContext,
  consultarGateway,
  LEGAL_CACHE_STORE,
  LegalError,
  type UrlContext,
} from '@/lib/legal'
import systemPromptTemplate from './prompt.md'

// El endpoint usa node:crypto (claves de caché) y Netlify Blobs, por lo que
// debe ejecutarse en el runtime Node, nunca como respuesta estática.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PREGUNTA_LENGTH = 2000

interface BodyData {
  // Aceptamos varios alias para el texto del usuario.
  pregunta?: unknown
  mensaje?: unknown
  texto?: unknown
  url?: unknown
}

interface CachedConsulta {
  respuesta: string
  modelo: string
  cacheadoEn: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as BodyData

    const preguntaRaw =
      firstString(body.pregunta) ??
      firstString(body.mensaje) ??
      firstString(body.texto)

    if (!preguntaRaw) {
      throw new LegalError(
        400,
        'PREGUNTA_REQUERIDA',
        'Debe incluir el texto de la consulta.'
      )
    }

    const pregunta = preguntaRaw.trim()
    if (pregunta.length === 0) {
      throw new LegalError(
        400,
        'PREGUNTA_REQUERIDA',
        'La consulta no puede estar vacía.'
      )
    }
    if (pregunta.length > MAX_PREGUNTA_LENGTH) {
      throw new LegalError(
        400,
        'PREGUNTA_DEMASIADO_LARGA',
        `La consulta no puede superar ${MAX_PREGUNTA_LENGTH} caracteres.`
      )
    }

    const url = firstString(body.url)
    const context = classifyUrlContext(url)
    const cacheKey = buildCacheKey(context, pregunta)
    const store = getStore(LEGAL_CACHE_STORE)

    // 1. Servir desde la caché si la pregunta frecuente ya fue respondida.
    const cached = await store
      .get(cacheKey, { type: 'json' })
      .catch(() => null)

    if (cached && typeof (cached as CachedConsulta).respuesta === 'string') {
      const hit = cached as CachedConsulta
      return jsonRespuesta(
        {
          respuesta: hit.respuesta,
          modelo: hit.modelo,
          fromCache: true,
          context: context.segment,
        },
        true
      )
    }

    // 2. Construir el system prompt autoritativo del servidor. El system prompt
    //    NO se acepta desde el cliente para evitar manipulación; solo se inyecta
    //    la URL del usuario para la dinámica de contexto.
    const system = buildSystemPrompt(url, context)

    // 3. Consultar el modelo a través de Netlify AI Gateway.
    const { respuesta, modelo } = await consultarGateway({
      system,
      pregunta,
    })

    // 4. Cachear la respuesta para futuras consultas idénticas.
    const payload: CachedConsulta = {
      respuesta,
      modelo,
      cacheadoEn: new Date().toISOString(),
    }
    await store.setJSON(cacheKey, payload).catch((error) => {
      // Un fallo al cachear no debe romper la respuesta al usuario.
      console.error('No se pudo cachear la consulta legal', error)
    })

    return jsonRespuesta(
      { respuesta, modelo, fromCache: false, context: context.segment },
      false
    )
  } catch (error) {
    return jsonError(error)
  }
}

function buildSystemPrompt(
  url: string | undefined,
  context: UrlContext
): string {
  const urlLabel = url && url.length > 0 ? url : 'No informada'
  let system = systemPromptTemplate.replace(/\{USER_URL\}/g, urlLabel)

  if (context.enFormularioCarga) {
    system +=
      '\n\n## Contexto activo\n\nEl usuario se encuentra ACTUALMENTE en el Formulario de Carga. ' +
      'Prioriza explicar la importancia y los efectos legales de la Declaración Jurada de Licitud.'
  }

  return system
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function jsonRespuesta(
  body: Record<string, unknown>,
  fromCache: boolean
) {
  return NextResponse.json(body, {
    headers: { 'X-From-Cache': fromCache ? '1' : '0' },
  })
}

function jsonError(error: unknown) {
  if (error instanceof LegalError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status }
    )
  }

  console.error('Error en /api/legal/consulta', error)
  return NextResponse.json(
    {
      error: 'INTERNAL_ERROR',
      message: 'No se pudo procesar la consulta legal.',
    },
    { status: 500 }
  )
}
