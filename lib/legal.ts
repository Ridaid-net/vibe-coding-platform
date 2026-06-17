import { createHash } from 'node:crypto'

/**
 * Versión del corpus legal. El corpus (TYC, CIT, SEG, PEN) es estable, por lo
 * que las respuestas se cachean en Netlify Blobs. Si el corpus o el system
 * prompt cambian, incrementar esta versión invalida automáticamente toda la
 * caché previa (las claves quedan huérfanas y dejan de leerse).
 */
export const CORPUS_VERSION = 'v1'

/** Modelo de IA servido a través de Netlify AI Gateway. */
export const LEGAL_MODEL = 'claude-sonnet-4-6'

/** Nombre del store de Netlify Blobs donde se cachean las consultas. */
export const LEGAL_CACHE_STORE = 'rodaid-legal-consultas'

export class LegalError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export interface UrlContext {
  /** Segmento corto y estable usado como parte de la clave de caché. */
  segment: string
  /** El usuario está en el Formulario de Carga (alta de un rodado). */
  enFormularioCarga: boolean
}

/**
 * Clasifica la URL del usuario en un contexto estable. Distintos contextos
 * producen distintas claves de caché, de modo que la guía contextual (por
 * ejemplo, la Declaración Jurada de Licitud en el Formulario de Carga) no se
 * mezcla con respuestas de otras secciones.
 */
export function classifyUrlContext(rawUrl: string | null | undefined): UrlContext {
  if (!rawUrl) {
    return { segment: 'general', enFormularioCarga: false }
  }

  let pathname = ''
  try {
    pathname = new URL(rawUrl).pathname.toLowerCase()
  } catch {
    // No es una URL absoluta: tratamos el valor como ruta directa.
    pathname = String(rawUrl).toLowerCase()
  }

  const enFormularioCarga =
    /(formulario[-/]?carga|\/carga|\/cargar|\/alta|\/registrar|\/publicar|\/nuevo)/.test(
      pathname
    )

  if (enFormularioCarga) {
    return { segment: 'formulario-carga', enFormularioCarga: true }
  }

  return { segment: 'general', enFormularioCarga: false }
}

/**
 * Normaliza la pregunta para maximizar los aciertos de caché entre variantes
 * de una misma pregunta frecuente: minúsculas, sin acentos, sin puntuación y
 * con los espacios colapsados.
 */
export function normalizeQuestion(question: string): string {
  return question
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Construye la clave de caché determinística a partir de la versión del
 * corpus, el contexto de la URL y la pregunta normalizada (hasheada para
 * respetar el límite de longitud de clave de Blobs).
 */
export function buildCacheKey(context: UrlContext, question: string): string {
  const normalized = normalizeQuestion(question)
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 32)
  return `${CORPUS_VERSION}/${context.segment}/${hash}`
}

export interface ConsultaResultado {
  respuesta: string
  modelo: string
}

/**
 * Envía la consulta al modelo de IA a través de Netlify AI Gateway usando las
 * variables de entorno inyectadas por Netlify (`ANTHROPIC_API_KEY` y
 * `ANTHROPIC_BASE_URL`). Las claves nunca se exponen al frontend.
 */
export async function consultarGateway(options: {
  system: string
  pregunta: string
}): Promise<ConsultaResultado> {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!baseUrl || !apiKey) {
    throw new LegalError(
      503,
      'AI_GATEWAY_NO_CONFIGURADO',
      'El proveedor de IA no está configurado. Verifique que AI Gateway esté habilitado en Netlify.'
    )
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: LEGAL_MODEL,
        max_tokens: 1024,
        temperature: 0.2,
        system: options.system,
        messages: [{ role: 'user', content: options.pregunta }],
      }),
    })
  } catch (error) {
    console.error('Error de red al contactar AI Gateway', error)
    throw new LegalError(
      502,
      'AI_GATEWAY_ERROR',
      'No se pudo contactar al proveedor de IA.'
    )
  }

  if (!response.ok) {
    // No filtrar el cuerpo del error del proveedor al cliente.
    console.error(
      'AI Gateway respondió con error',
      response.status,
      await response.text().catch(() => '')
    )
    throw new LegalError(
      502,
      'AI_GATEWAY_ERROR',
      'El proveedor de IA devolvió un error.'
    )
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>
  }

  const respuesta =
    data.content
      ?.filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('\n')
      .trim() ?? ''

  if (!respuesta) {
    throw new LegalError(
      502,
      'AI_GATEWAY_VACIO',
      'El proveedor de IA no devolvió contenido.'
    )
  }

  return { respuesta, modelo: LEGAL_MODEL }
}
