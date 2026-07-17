import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import {
  MODELO_GPT,
  claveCache,
  construirSystemPrompt,
  guardarCache,
  leerCache,
  prepararMensajes,
  recolectarContexto,
  registrarConsulta,
  streamRespuestaConReintento,
  verificarCuota,
  type TurnoChat,
} from '@/src/services/rodaid-gpt.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/gpt/consulta — Hito 15: RODAID-GPT.
 *
 * Endpoint SEGURO (Bearer obligatorio) del asistente experto en seguridad y
 * gestion ciclista. El backend es el UNICO intermediario con el modelo (Claude
 * Sonnet via Netlify AI Gateway): la credencial del proveedor nunca llega al
 * cliente.
 *
 * Flujo:
 *   1. Autenticacion + validacion de la pregunta.
 *   2. CUOTA mensual (rate limiting): si el usuario la agoto, 429.
 *   3. Recoleccion CONTROLADA del contexto del usuario (CITs, BFA, actas, uso y
 *      zona) + el mapa de calor de seguridad (Hito 8).
 *   4. CACHE (Netlify Blobs): si la misma pregunta con el mismo estado ya fue
 *      respondida, se transmite la respuesta cacheada (sin gastar tokens).
 *   5. ANONIMIZACION + system prompt dinamico + STREAMING SSE de la respuesta.
 *
 * La respuesta se transmite como Server-Sent Events. Cada evento es una linea
 * `data: {json}` con un campo `type`: 'meta' | 'delta' | 'done' | 'error'.
 */

interface Body {
  pregunta?: unknown
  historial?: unknown
}

const MAX_PREGUNTA = 2000

function parseHistorial(value: unknown): TurnoChat[] {
  if (!Array.isArray(value)) return []
  const out: TurnoChat[] = []
  for (const item of value) {
    if (
      item &&
      typeof item === 'object' &&
      (item as TurnoChat).role &&
      typeof (item as TurnoChat).content === 'string'
    ) {
      const role = (item as TurnoChat).role
      if (role === 'user' || role === 'assistant') {
        out.push({ role, content: (item as TurnoChat).content })
      }
    }
  }
  return out
}

function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

export async function POST(req: Request) {
  let user: { id: string }
  try {
    user = await requireUser(req)

    const body = (await req.json().catch(() => ({}))) as Body
    const pregunta = typeof body.pregunta === 'string' ? body.pregunta.trim() : ''
    if (!pregunta) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Escribí tu consulta para el asistente.')
    }
    if (pregunta.length > MAX_PREGUNTA) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `La consulta no puede superar ${MAX_PREGUNTA} caracteres.`
      )
    }
    const historial = parseHistorial(body.historial)

    // 2) Cuota mensual.
    const cuota = await verificarCuota(user.id)
    if (!cuota.permitido) {
      return NextResponse.json(
        {
          error: 'CUOTA_AGOTADA',
          message: `Alcanzaste el límite de ${cuota.limite} consultas de este mes. Se renueva el mes próximo.`,
          cuota,
        },
        { status: 429, headers: { 'cache-control': 'no-store' } }
      )
    }

    // 3) Contexto controlado del usuario + seguridad de la ciudad.
    const { contexto, perfil } = await recolectarContexto(user.id)

    // 4) Cache (solo en consultas de un solo turno, para no servir algo fuera de
    //    contexto conversacional).
    const cacheable = historial.length === 0
    const clave = claveCache(user.id, contexto, pregunta)
    const inicio = Date.now()

    if (cacheable) {
      const hit = await leerCache(clave)
      if (hit) {
        await registrarConsulta({
          userId: user.id,
          pregunta,
          modelo: hit.modelo,
          cacheHit: true,
          rehusada: hit.rehusada,
        })
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder()
            controller.enqueue(
              enc.encode(
                sseFrame({
                  type: 'meta',
                  cacheHit: true,
                  modelo: hit.modelo,
                  cuota: { ...cuota }, // no consume cuota
                })
              )
            )
            controller.enqueue(enc.encode(sseFrame({ type: 'delta', text: hit.texto })))
            controller.enqueue(enc.encode(sseFrame({ type: 'done', cacheHit: true })))
            controller.close()
          },
        })
        return sseResponse(stream)
      }
    }

    // 5) Consulta real al modelo, con anonimizacion + system prompt dinamico.
    const system = construirSystemPrompt(contexto)
    const mensajes = prepararMensajes(pregunta, historial, perfil)
    const rehusada = !contexto.tieneDatos

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder()
        let texto = ''
        let tokensEntrada: number | null = null
        let tokensSalida: number | null = null
        try {
          controller.enqueue(
            enc.encode(
              sseFrame({
                type: 'meta',
                cacheHit: false,
                modelo: MODELO_GPT,
                cuota: {
                  ...cuota,
                  usadas: cuota.usadas + 1,
                  restantes: Math.max(0, cuota.restantes - 1),
                },
              })
            )
          )

          for await (const chunk of streamRespuestaConReintento(system, mensajes)) {
            if (chunk.texto) {
              texto += chunk.texto
              controller.enqueue(enc.encode(sseFrame({ type: 'delta', text: chunk.texto })))
            }
            if (chunk.usage) {
              tokensEntrada = chunk.usage.entrada
              tokensSalida = chunk.usage.salida
            }
          }

          controller.enqueue(enc.encode(sseFrame({ type: 'done', cacheHit: false })))
          controller.close()

          // Persistencia best-effort tras cerrar el stream.
          if (cacheable && texto.trim()) {
            await guardarCache(clave, {
              texto,
              modelo: MODELO_GPT,
              creadoEn: new Date().toISOString(),
              rehusada,
            })
          }
          await registrarConsulta({
            userId: user.id,
            pregunta,
            modelo: MODELO_GPT,
            cacheHit: false,
            rehusada,
            tokensEntrada,
            tokensSalida,
            latenciaMs: Date.now() - inicio,
          })
        } catch (err) {
          console.error('[rodaid-gpt] error en el stream', err)
          controller.enqueue(
            enc.encode(
              sseFrame({
                type: 'error',
                message: 'Ocurrió un error en el asistente. Intentá de nuevo.',
              })
            )
          )
          controller.close()
          await registrarConsulta({
            userId: user.id,
            pregunta,
            modelo: MODELO_GPT,
            cacheHit: false,
            rehusada,
            latenciaMs: Date.now() - inicio,
          })
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
      // Evita el buffering de proxies para que el stream llegue token a token.
      'x-accel-buffering': 'no',
    },
  })
}
