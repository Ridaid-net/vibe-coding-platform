/**
 * RODAID — Motor de Notificaciones: transporte de los canales externos.
 *
 * Dos canales, cada uno detras de su configuracion y honesto respecto de su estado:
 *
 *   EMAIL  -> Resend API  (RESEND_API_KEY + RESEND_FROM)
 *   PUSH   -> Firebase Cloud Messaging, HTTP legacy  (FCM_SERVER_KEY)
 *
 * Si un canal no esta configurado, NO se finge un envio: la funcion devuelve un
 * resultado `omitido` con el motivo, y el llamador lo asienta. Igual disciplina que
 * la capa BFA: el estado externo siempre refleja la realidad.
 *
 * Solo `fetch` y variables de entorno; sin SDKs ni dependencias externas.
 */

export interface ResultadoCanal {
  enviado: boolean
  /** Motivo cuando no se envio (sin configuracion, error de red, rechazo). */
  motivo?: string
  /** Identificador del proveedor cuando se envio (id de Resend, multicast de FCM). */
  referencia?: string
  /** Tokens FCM invalidos que conviene depurar de las preferencias. */
  tokensInvalidos?: string[]
}

function env(clave: string): string | null {
  const valor = process.env[clave]
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

const TIMEOUT_MS = (() => {
  const crudo = Number(env('NOTIF_TIMEOUT_MS'))
  return Number.isFinite(crudo) && crudo > 0 ? crudo : 8000
})()

async function fetchConTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controlador = new AbortController()
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controlador.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ── EMAIL · Resend ────────────────────────────────────────────────────────────

export function emailConfigurado(): boolean {
  return env('RESEND_API_KEY') !== null && env('RESEND_FROM') !== null
}

export async function enviarEmail(input: {
  para: string
  asunto: string
  html: string
  text: string
}): Promise<ResultadoCanal> {
  const apiKey = env('RESEND_API_KEY')
  const from = env('RESEND_FROM')
  if (!apiKey || !from) {
    return { enviado: false, motivo: 'EMAIL_NO_CONFIGURADO' }
  }

  try {
    const respuesta = await fetchConTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.para],
        subject: input.asunto,
        html: input.html,
        text: input.text,
      }),
    })

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '')
      return {
        enviado: false,
        motivo: `EMAIL_RESEND_${respuesta.status}${detalle ? `: ${detalle.slice(0, 200)}` : ''}`,
      }
    }

    const datos = (await respuesta.json().catch(() => ({}))) as { id?: string }
    return { enviado: true, referencia: datos.id }
  } catch (error) {
    const motivo =
      error instanceof Error && error.name === 'AbortError'
        ? 'EMAIL_TIMEOUT'
        : 'EMAIL_ERROR_RED'
    return { enviado: false, motivo }
  }
}

// ── PUSH · Firebase Cloud Messaging (HTTP legacy) ─────────────────────────────

export function pushConfigurado(): boolean {
  return env('FCM_SERVER_KEY') !== null
}

export async function enviarPush(input: {
  tokens: string[]
  titulo: string
  cuerpo: string
  data?: Record<string, string>
}): Promise<ResultadoCanal> {
  const serverKey = env('FCM_SERVER_KEY')
  if (!serverKey) {
    return { enviado: false, motivo: 'PUSH_NO_CONFIGURADO' }
  }
  const tokens = input.tokens.filter((t) => typeof t === 'string' && t.length > 0)
  if (tokens.length === 0) {
    return { enviado: false, motivo: 'PUSH_SIN_TOKENS' }
  }

  try {
    const respuesta = await fetchConTimeout('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        authorization: `key=${serverKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        registration_ids: tokens,
        notification: { title: input.titulo, body: input.cuerpo },
        data: input.data ?? {},
      }),
    })

    if (!respuesta.ok) {
      return { enviado: false, motivo: `PUSH_FCM_${respuesta.status}` }
    }

    const datos = (await respuesta.json().catch(() => ({}))) as {
      multicast_id?: number
      results?: Array<{ error?: string }>
    }

    // Detecta tokens caducados/invalidos para que el llamador los depure.
    const tokensInvalidos: string[] = []
    datos.results?.forEach((r, i) => {
      if (
        r.error === 'NotRegistered' ||
        r.error === 'InvalidRegistration' ||
        r.error === 'MismatchSenderId'
      ) {
        tokensInvalidos.push(tokens[i])
      }
    })

    return {
      enviado: true,
      referencia: datos.multicast_id ? String(datos.multicast_id) : undefined,
      tokensInvalidos: tokensInvalidos.length ? tokensInvalidos : undefined,
    }
  } catch (error) {
    const motivo =
      error instanceof Error && error.name === 'AbortError'
        ? 'PUSH_TIMEOUT'
        : 'PUSH_ERROR_RED'
    return { enviado: false, motivo }
  }
}
