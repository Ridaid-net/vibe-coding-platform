'use client'

/**
 * Cliente del Asistente de Soporte (FAQ) del Footer. Habla con el endpoint
 * PÚBLICO `POST /api/faq/consulta` y consume su STREAMING por Server-Sent
 * Events. A diferencia del cliente de RODAID-GPT (`lib/asistente.ts`), este NO
 * envía credenciales: es un asistente abierto de preguntas frecuentes.
 */

export interface TurnoChat {
  role: 'user' | 'assistant'
  content: string
}

export interface PaginaContexto {
  ruta?: string
  etiqueta?: string
  serial?: string
}

export interface MetaConsulta {
  cacheHit: boolean
  modelo: string
}

export interface ConsultaCallbacks {
  onMeta?: (meta: MetaConsulta) => void
  onDelta: (texto: string) => void
  onDone?: (info: { cacheHit: boolean }) => void
  onError: (mensaje: string) => void
}

/**
 * Envía una consulta al asistente de FAQ y transmite la respuesta token a token
 * mediante callbacks. Devuelve cuando el stream se cierra. Si el endpoint
 * responde un error JSON (validación, rate limit), lo informa por `onError`.
 */
export async function consultarFaqStream(
  pregunta: string,
  historial: TurnoChat[],
  pagina: PaginaContexto | null,
  callbacks: ConsultaCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch('/api/faq/consulta', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pregunta, historial, pagina }),
    signal,
  })

  const tipo = res.headers.get('content-type') ?? ''

  // Error de negocio (no es un stream): validación, rate limit, etc.
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
    const datas = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('')
    if (!datas) return
    let evento: {
      type?: string
      text?: string
      message?: string
      cacheHit?: boolean
      modelo?: string
    } | null
    try {
      evento = JSON.parse(datas)
    } catch {
      return
    }
    if (!evento) return
    switch (evento.type) {
      case 'meta':
        callbacks.onMeta?.({ cacheHit: !!evento.cacheHit, modelo: evento.modelo ?? '' })
        break
      case 'delta':
        if (evento.text) callbacks.onDelta(evento.text)
        break
      case 'done':
        callbacks.onDone?.({ cacheHit: !!evento.cacheHit })
        break
      case 'error':
        callbacks.onError(evento.message ?? 'No pudimos completar la respuesta.')
        break
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      procesarEvento(raw)
    }
  }
  if (buffer.trim()) procesarEvento(buffer)
}

// ── Contexto dinámico de la página ───────────────────────────────────────────

/**
 * Deriva el contexto de navegación a partir de la ruta actual, para que el
 * asistente sepa en qué sección está el usuario (y, si aplica, sobre qué número
 * de serie/CIT puede tratar la consulta).
 */
export function contextoDePagina(ruta: string): PaginaContexto {
  const segmentos = ruta.split('?')[0]!.split('/').filter(Boolean)

  // /verificar/[serial] → la consulta puede ser sobre esa unidad puntual.
  if (segmentos[0] === 'verificar' && segmentos[1]) {
    return {
      ruta,
      etiqueta: 'Verificador Público (unidad)',
      serial: safeDecode(segmentos[1]),
    }
  }

  const mapa: Record<string, string> = {
    '': 'Inicio',
    verificar: 'Verificador Público',
    marketplace: 'Marketplace',
    publicar: 'Publicar una bici',
    garaje: 'Garaje Digital',
    asistente: 'RODAID-GPT (asistente personal)',
    aliados: 'Aliados y Talleres',
    desarrolladores: 'Portal de Desarrolladores',
    conectar: 'Conexión Open-Connect',
    ingresar: 'Ingreso',
    checkout: 'Checkout / RODAID PAY',
    admin: 'Panel de administración',
  }
  const clave = segmentos[0] ?? ''
  const etiqueta = mapa[clave] ?? 'RODAID'

  // /marketplace/[id] → publicación puntual.
  if (segmentos[0] === 'marketplace' && segmentos[1]) {
    return { ruta, etiqueta: 'Publicación del Marketplace' }
  }

  return { ruta, etiqueta }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
