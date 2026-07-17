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
  /** TEMPORAL (diagnostico 2026-07-16): piezas del contexto que usaron su valor de respaldo. */
  piezasConTimeout?: string[]
  /** TEMPORAL (diagnostico 2026-07-16): piezas del contexto que fallaron con un error. */
  piezasConError?: string[]
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
  // TEMPORAL (diagnostico 2026-07-16): instrumentacion del lado cliente. Los
  // timeouts que ya agregamos en el backend (recolectarContexto/streamRespuesta)
  // solo pueden avisar del fallo si el PROCESO DE NODE sigue vivo para correr
  // el catch y emitir el frame SSE -- si la conexion se corta antes de eso (o
  // directamente nunca se establece), el cliente caia en mensajes 100%
  // genericos y fijos que descartaban el status HTTP, el content-type y
  // cuanto se alcanzo a recibir -- exactamente los datos que hacen falta para
  // saber que esta pasando. Revertir junto con el resto del diagnostico
  // temporal una vez confirmada la causa real de la falla.
  const inicio = Date.now()
  let res: Response
  try {
    res = await authedFetch('/api/gpt/consulta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pregunta, historial }),
      signal,
    })
  } catch (err) {
    const detalle = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    callbacks.onError(
      `[DEBUG TEMPORAL] la conexion con el asistente fallo antes de recibir` +
        ` respuesta (${Date.now() - inicio}ms): ${detalle}`
    )
    return
  }

  const tipo = res.headers.get('content-type') ?? ''

  // Error de negocio (no es un stream): cuota agotada, validación, etc. --
  // o una respuesta inesperada de la plataforma (ej. una pagina de error de
  // Netlify, no JSON) si la conexion se corto antes de llegar a nuestro codigo.
  if (!tipo.includes('text/event-stream')) {
    const textoBruto = await res.text().catch(() => '')
    let data: { message?: string } | null = null
    try {
      data = textoBruto ? JSON.parse(textoBruto) : null
    } catch {
      data = null
    }
    callbacks.onError(
      data?.message ??
        `[DEBUG TEMPORAL] respuesta inesperada del servidor (status ${res.status}` +
          ` ${res.statusText}, content-type "${tipo}", ${Date.now() - inicio}ms):` +
          ` ${textoBruto.slice(0, 300) || '(sin cuerpo)'}`
    )
    return
  }

  if (!res.body) {
    callbacks.onError('[DEBUG TEMPORAL] el navegador no pudo abrir el stream de respuesta (res.body vacio).')
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let caracteresRecibidos = 0

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
        piezasConTimeout?: string[]
        piezasConError?: string[]
      }
      if (obj.type === 'meta') {
        callbacks.onMeta?.({
          cacheHit: Boolean(obj.cacheHit),
          modelo: obj.modelo ?? '',
          cuota: obj.cuota ?? { usadas: 0, limite: 0, restantes: 0, permitido: true },
          piezasConTimeout: obj.piezasConTimeout,
          piezasConError: obj.piezasConError,
        })
      } else if (obj.type === 'delta' && obj.text) {
        caracteresRecibidos += obj.text.length
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

  try {
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
  } catch (err) {
    const detalle = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    callbacks.onError(
      `[DEBUG TEMPORAL] el stream se cortó a los ${Date.now() - inicio}ms` +
        ` (${caracteresRecibidos} caracteres recibidos hasta el corte): ${detalle}`
    )
  }
}
