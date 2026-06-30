import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import {
  MAX_PREGUNTA,
  chequearRateLimit,
  claveCache,
  construirSystemPrompt,
  guardarCache,
  hashIp,
  leerCache,
  modeloFaq,
  prepararMensajes,
  streamRespuesta,
  type PaginaContexto,
  type TurnoChat,
  type VeredictoCompacto,
} from '@/src/services/rodaid-faq.service'
import {
  buscarYVerificar,
  normalizarTermino,
} from '@/src/services/verificacion.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/faq/consulta — Asistente de Soporte Técnico y Legal del Footer.
 *
 * Endpoint PÚBLICO (sin autenticación) del widget de preguntas frecuentes. No
 * accede a datos privados de ningún usuario: responde sobre la base de
 * conocimiento del ecosistema RODAID (los hitos), su marco legal y sus garantías
 * de seguridad y privacidad. El backend es el ÚNICO intermediario con el modelo
 * (Claude vía Netlify AI Gateway): la credencial del proveedor nunca llega al
 * cliente.
 *
 * Flujo:
 *   1. Validación de la pregunta + RATE LIMITING por IP (anti-abuso del endpoint
 *      público de IA).
 *   2. CONTEXTO DINÁMICO de la página: si el usuario está en la página de un CIT,
 *      se consulta el Verificador Público (sin PII) para fundamentar la respuesta.
 *   3. CACHÉ (Netlify Blobs) de preguntas frecuentes genéricas, para optimizar el
 *      costo de tokens.
 *   4. STREAMING SSE de la respuesta token a token.
 *
 * La respuesta se transmite como Server-Sent Events: cada evento es una línea
 * `data: {json}` con un campo `type`: 'meta' | 'delta' | 'done' | 'error'.
 */

interface Body {
  pregunta?: unknown
  historial?: unknown
  pagina?: unknown
}

function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

function parseHistorial(value: unknown): TurnoChat[] {
  if (!Array.isArray(value)) return []
  const out: TurnoChat[] = []
  for (const item of value) {
    if (item && typeof item === 'object') {
      const role = (item as TurnoChat).role
      const content = (item as TurnoChat).content
      if ((role === 'user' || role === 'assistant') && typeof content === 'string') {
        out.push({ role, content: content.slice(0, MAX_PREGUNTA) })
      }
    }
  }
  return out.slice(-6)
}

function texto(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t ? t.slice(0, max) : undefined
}

function parsePagina(value: unknown): PaginaContexto | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const ruta = texto(raw.ruta, 200)
  const etiqueta = texto(raw.etiqueta, 80)
  // El serial sólo se acepta con el formato del verificador (alfanumérico/guiones).
  const serialRaw = texto(raw.serial, 120)
  const serial =
    serialRaw && /^[A-Za-z0-9\- ]{3,120}$/.test(serialRaw) ? serialRaw : undefined
  if (!ruta && !etiqueta && !serial) return null
  return { ruta, etiqueta, serial }
}

function obtenerIp(req: Request): string | null {
  const nf = req.headers.get('x-nf-client-connection-ip')
  if (nf && nf.trim()) return nf.trim()
  const xff = req.headers.get('x-forwarded-for')
  if (xff && xff.trim()) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')?.trim() || null
}

/** Veredicto público compacto (sin PII) de la unidad que el usuario tiene en pantalla. */
async function veredictoDeSerial(serial: string): Promise<VeredictoCompacto | null> {
  try {
    const termino = normalizarTermino(serial)
    if (termino.length < 3) return null
    const v = await buscarYVerificar(termino)
    return {
      serial: termino,
      estado: v.estado,
      titulo: v.titulo,
      mensaje: v.mensaje,
      codigoCit: v.codigoCit ?? null,
      bfaCoincide: v.bfa ? v.bfa.coincide : null,
    }
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body
    const pregunta = typeof body.pregunta === 'string' ? body.pregunta.trim() : ''
    if (!pregunta) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Escribí tu consulta para el asistente.' },
        { status: 400, headers: { 'cache-control': 'no-store' } }
      )
    }
    if (pregunta.length > MAX_PREGUNTA) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: `La consulta no puede superar ${MAX_PREGUNTA} caracteres.`,
        },
        { status: 400, headers: { 'cache-control': 'no-store' } }
      )
    }

    // 1) Rate limiting por IP (anti-abuso del endpoint público de IA).
    const ipHash = hashIp(obtenerIp(req))
    const rate = await chequearRateLimit(ipHash)
    if (!rate.permitido) {
      return NextResponse.json(
        {
          error: 'RATE_LIMITED',
          message:
            'Recibimos muchas consultas desde tu conexión. Esperá un momento y volvé a intentar.',
          retryAfter: rate.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rate.retryAfter),
            'cache-control': 'no-store',
          },
        }
      )
    }

    const historial = parseHistorial(body.historial)
    const pagina = parsePagina(body.pagina)

    // 2) Contexto dinámico: veredicto público de la bici en pantalla (sin PII).
    const veredicto = pagina?.serial ? await veredictoDeSerial(pagina.serial) : null

    // 3) Caché: sólo para preguntas genéricas de un solo turno (sin serial puntual).
    const cacheable = historial.length === 0 && !pagina?.serial
    const tipoPagina = pagina?.etiqueta ?? 'general'
    const clave = claveCache(pregunta, tipoPagina)

    if (cacheable) {
      const hit = await leerCache(clave)
      if (hit) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder()
            controller.enqueue(
              enc.encode(sseFrame({ type: 'meta', cacheHit: true, modelo: hit.modelo }))
            )
            controller.enqueue(enc.encode(sseFrame({ type: 'delta', text: hit.texto })))
            controller.enqueue(enc.encode(sseFrame({ type: 'done', cacheHit: true })))
            controller.close()
          },
        })
        return sseResponse(stream)
      }
    }

    // 4) Consulta real al modelo + streaming SSE.
    const system = construirSystemPrompt(pagina, veredicto)
    const mensajes = prepararMensajes(pregunta, historial)
    const modelo = modeloFaq()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder()
        let textoResp = ''
        try {
          controller.enqueue(
            enc.encode(sseFrame({ type: 'meta', cacheHit: false, modelo }))
          )
          for await (const chunk of streamRespuesta(system, mensajes)) {
            if (chunk.texto) {
              textoResp += chunk.texto
              controller.enqueue(enc.encode(sseFrame({ type: 'delta', text: chunk.texto })))
            }
          }
          controller.enqueue(enc.encode(sseFrame({ type: 'done', cacheHit: false })))
          controller.close()

          if (cacheable && textoResp.trim()) {
            await guardarCache(clave, {
              texto: textoResp,
              modelo,
              creadoEn: new Date().toISOString(),
            })
          }
        } catch (err) {
          console.error('[rodaid-faq] error en el stream', err)
          controller.enqueue(
            enc.encode(
              sseFrame({
                type: 'error',
                message:
                  'No pudimos completar la respuesta del asistente. Intentá de nuevo en un momento.',
              })
            )
          )
          controller.close()
        }
      },
    })

    return sseResponse(stream)
  } catch (error) {
    return jsonError(error)
  }
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
