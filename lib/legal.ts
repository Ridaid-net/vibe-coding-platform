'use client'

/**
 * Cliente del Asistente Oficial de Soporte y Consultoría Legal de RODAID. Habla
 * con el endpoint PÚBLICO `POST /api/legal/consulta` y consume su STREAMING por
 * Server-Sent Events. No envía credenciales: es un asistente abierto cuyo
 * conocimiento se limita al corpus legal de RODAID.
 */

export interface TurnoChat {
  role: 'user' | 'assistant'
  content: string
}

export interface PaginaContexto {
  ruta?: string
  etiqueta?: string
  enFormularioDeCarga?: boolean
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
 * Envía una consulta al asistente legal y transmite la respuesta token a token
 * mediante callbacks. Devuelve cuando el stream se cierra. Si el endpoint
 * responde un error JSON (validación, rate limit), lo informa por `onError`.
 */
export async function consultarLegalStream(
  pregunta: string,
  historial: TurnoChat[],
  pagina: PaginaContexto | null,
  callbacks: ConsultaCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch('/api/legal/consulta', {
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

/** Etiquetas legibles por primer segmento de ruta. */
const ETIQUETAS: Record<string, string> = {
  '': 'Inicio',
  terminos: 'Términos y Condiciones',
  verificar: 'Verificador Público',
  marketplace: 'Marketplace',
  publicar: 'Formulario de carga',
  garaje: 'Garaje Digital',
  asistente: 'RODAID-GPT',
  aliados: 'Aliados y Talleres',
  ingresar: 'Ingreso',
  checkout: 'Checkout / RODAID PAY',
  admin: 'Panel de administración',
}

/**
 * Deriva el contexto de navegación a partir de la ruta actual, para que el
 * asistente sepa dónde está el usuario (la URL) y pueda anticipar dudas; en el
 * formulario de carga, sobre la Declaración Jurada de Licitud.
 */
export function contextoDePagina(ruta: string): PaginaContexto {
  const limpia = ruta.split('?')[0] || '/'
  const segmentos = limpia.split('/').filter(Boolean)
  const clave = segmentos[0] ?? ''
  const etiqueta = ETIQUETAS[clave] ?? 'RODAID'
  return {
    ruta: limpia,
    etiqueta,
    enFormularioDeCarga: clave === 'publicar',
  }
}
