'use client'

import { authedFetch } from '@/lib/session'

/**
 * Cliente de RODAID-GPT (Hito 15). Habla con el endpoint seguro
 * `POST /api/gpt/consulta` y consume su STREAMING por Server-Sent Events.
 *
 * Se usa `authedFetch` (no `EventSource`) porque la consulta es un POST con el
 * Bearer del usuario: el navegador no puede abrir un EventSource autenticado con
 * cuerpo. Aca se hace el fetch, se lee el `ReadableStream` de la respuesta y se
 * parsean los frames `data: {json}` a mano.
 */

export interface TurnoChat {
  role: 'user' | 'assistant'
  content: string
}

export interface EstadoCuota {
  usadas: number
  limite: number
  restantes: number
  permitido: boolean
}

export interface MetaConsulta {
  cacheHit: boolean
  modelo: string
  cuota: EstadoCuota
}

export interface ConsultaCallbacks {
  onMeta?: (meta: MetaConsulta) => void
  onDelta: (texto: string) => void
  onDone?: (info: { cacheHit: boolean }) => void
  onError: (mensaje: string) => void
}

/**
 * Envía una consulta y transmite la respuesta token a token mediante callbacks.
 * Devuelve cuando el stream se cierra. Si el endpoint responde un error JSON
 * (validación, cuota agotada), lo informa por `onError`.
 */
export async function consultarGptStream(
  pregunta: string,
  historial: TurnoChat[],
  callbacks: ConsultaCallbacks,
  signal?: AbortSignal
): Promise<void> {
  let res: Response
  try {
    res = await authedFetch('/api/gpt/consulta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pregunta, historial }),
      signal,
    })
  } catch (err) {
    console.error('[rodaid-gpt] no se pudo conectar con el asistente', err)
    callbacks.onError('No pudimos contactar al asistente. Revisá tu conexión e intentá de nuevo.')
    return
  }

  const tipo = res.headers.get('content-type') ?? ''

  // Error de negocio (no es un stream): cuota agotada, validación, etc.
  if (!tipo.includes('text/event-stream')) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null
    callbacks.onError(
      data?.message ?? 'No pudimos procesar tu consulta. Intentá de nuevo.'
    )
    return
  }

  if (!res.body) {
    callbacks.onError('No pudimos abrir la respuesta del asistente.')
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const procesarEvento = (raw: string) => {
    // Un evento SSE puede tener varias líneas `data:`; las concatenamos.
    const datas = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
    if (datas.length === 0) return
    const payload = datas.join('\n')
    try {
      const obj = JSON.parse(payload) as {
        type: 'meta' | 'delta' | 'done' | 'error'
        text?: string
        message?: string
        cacheHit?: boolean
        modelo?: string
        cuota?: EstadoCuota
      }
      if (obj.type === 'meta') {
        callbacks.onMeta?.({
          cacheHit: Boolean(obj.cacheHit),
          modelo: obj.modelo ?? '',
          cuota: obj.cuota ?? { usadas: 0, limite: 0, restantes: 0, permitido: true },
        })
      } else if (obj.type === 'delta' && obj.text) {
        callbacks.onDelta(obj.text)
      } else if (obj.type === 'done') {
        callbacks.onDone?.({ cacheHit: Boolean(obj.cacheHit) })
      } else if (obj.type === 'error') {
        callbacks.onError(obj.message ?? 'Ocurrió un error en el asistente.')
      }
    } catch {
      // Frame incompleto/no-JSON: se ignora.
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Los eventos SSE se separan por una línea en blanco.
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const evento = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      procesarEvento(evento)
    }
  }
  if (buffer.trim()) procesarEvento(buffer)
}
