// ─── RODAID · Escudo perimetral anti-abuso (Rate Limiting) ────────────────
//
// Stack de rate limiting para los endpoints públicos del Verificador, adaptado
// al modelo serverless de Netlify. El backend Express original usaba Redis con
// sliding windows; aquí el conteo se respalda en **Netlify Blobs** (con TTL
// lógico, ya que Blobs no expira nativamente) leído con consistencia fuerte.
//
// Stack aplicado a GET /api/v1/verificar/[serial]:
//
//   1. isIPBlocked(ip)        → 429 IP_BLOCKED si la IP está en la blocklist
//   2. burstRateLimit         → 20 req / 10 s  por IP (anti-ráfaga)
//   3. verificadorRateLimit   → 100 req / min  por IP
//   4. handler                → responder
//
// Cada 429 emitido a una IP registra un "strike". Los strikes acumulan
// bloqueos escalonados (5 min → 30 min → 24 h). Todas las respuestas inyectan
// los headers estándar RFC 6585 (X-RateLimit-Limit, X-RateLimit-Remaining,
// X-RateLimit-Reset y, en 429, Retry-After).
//
// Diseño resiliente (fail-open): si el runtime de Blobs no está disponible
// (p. ej. type-check local o un incidente de infraestructura), el limitador
// degrada permitiendo la petición en lugar de tumbar el verificador público.

import { getStore } from '@netlify/blobs'

const STORE_NAME = 'rodaid-ratelimit'

// ── Configuración de limiters ──────────────────────────────────────────────

export interface LimiterConfig {
  /** Identificador corto, usado como prefijo de clave en el store. */
  id: string
  /** Máximo de peticiones permitidas dentro de la ventana. */
  limit: number
  /** Tamaño de la ventana deslizante, en milisegundos. */
  windowMs: number
}

/** Anti-ráfaga: 20 peticiones cada 10 segundos por IP. */
export const BURST_LIMITER: LimiterConfig = {
  id: 'burst',
  limit: 20,
  windowMs: 10_000,
}

/** Límite del verificador: 100 peticiones por minuto por IP. */
export const VERIFICADOR_LIMITER: LimiterConfig = {
  id: 'verificador',
  limit: 100,
  windowMs: 60_000,
}

// Bloqueo progresivo por strikes acumulados.
const STRIKES_TTL_MS = 60 * 60 * 1000 // los strikes caducan a la hora.

interface EscalonBloqueo {
  minStrikes: number
  duracionMs: number
  etiqueta: string
}

// Ordenados de mayor a menor umbral para resolver el escalón aplicable.
const ESCALONES_BLOQUEO: EscalonBloqueo[] = [
  { minStrikes: 10, duracionMs: 24 * 60 * 60 * 1000, etiqueta: '24 h' },
  { minStrikes: 6, duracionMs: 30 * 60 * 1000, etiqueta: '30 min' },
  { minStrikes: 3, duracionMs: 5 * 60 * 1000, etiqueta: '5 min' },
]

// ── Acceso al store ─────────────────────────────────────────────────────────

function getRateStore() {
  // Consistencia fuerte: el conteo debe reflejar la escritura inmediatamente
  // anterior. getStore puede lanzar si el entorno de Blobs no está configurado;
  // las funciones que lo usan capturan ese caso y degradan (fail-open).
  return getStore({ name: STORE_NAME, consistency: 'strong' })
}

// ── Extracción de la IP real ────────────────────────────────────────────────
//
// Prioridad de cabeceras (de más confiable a menos):
//   x-nf-client-connection-ip  → IP de cliente que inyecta el edge de Netlify
//   cf-connecting-ip           → Cloudflare (no falsificable)
//   x-real-ip                  → upstream nginx
//   x-forwarded-for            → primera IP de la cadena (cliente original)

export function extraerIP(req: Request): string {
  const h = req.headers
  const nf = h.get('x-nf-client-connection-ip')
  if (nf) return nf.trim()

  const cf = h.get('cf-connecting-ip')
  if (cf) return cf.trim()

  const real = h.get('x-real-ip')
  if (real) return real.trim()

  const fwd = h.get('x-forwarded-for')
  if (fwd) {
    const primera = fwd.split(',')[0]?.trim()
    if (primera) return primera
  }

  // Fallback: sin IP identificable, se agrupan bajo una clave común. Es
  // conservador (comparten cupo) pero evita dejar la puerta abierta.
  return 'desconocida'
}

// ── Resultado de consumir un limiter ────────────────────────────────────────

export interface ResultadoLimiter {
  permitido: boolean
  limit: number
  restante: number
  /** Momento (ms epoch) en que se libera al menos un cupo de la ventana. */
  reset: number
  /** Segundos a esperar antes de reintentar (solo relevante si !permitido). */
  retryAfter: number
}

interface RegistroVentana {
  // Timestamps (ms epoch) de las peticiones dentro de la ventana vigente.
  hits: number[]
}

/**
 * Consume un cupo del limiter para la IP dada mediante una ventana deslizante
 * (sliding window log) persistida en Blobs.
 *
 * No es atómico —Blobs no ofrece operaciones atómicas—, por lo que bajo alta
 * concurrencia el conteo es "best effort". Es suficiente para mitigar abuso de
 * un mismo origen, que es el objetivo del escudo perimetral.
 */
export async function consumir(
  cfg: LimiterConfig,
  ip: string,
  ahora: number
): Promise<ResultadoLimiter> {
  const store = getRateStore()
  const key = `window:${cfg.id}:${ip}`
  const desde = ahora - cfg.windowMs

  const previo = (await store.get(key, { type: 'json' })) as RegistroVentana | null
  const hitsVigentes = (previo?.hits ?? []).filter((t) => t > desde)

  const usados = hitsVigentes.length
  const permitido = usados < cfg.limit

  if (permitido) {
    hitsVigentes.push(ahora)
    await store.setJSON(key, { hits: hitsVigentes } satisfies RegistroVentana)
  }

  // El cupo más antiguo se libera cuando su hit sale de la ventana.
  const hitMasAntiguo = hitsVigentes.length > 0 ? hitsVigentes[0] : ahora
  const reset = hitMasAntiguo + cfg.windowMs
  const restante = Math.max(0, cfg.limit - hitsVigentes.length)
  const retryAfter = permitido ? 0 : Math.max(1, Math.ceil((reset - ahora) / 1000))

  return { permitido, limit: cfg.limit, restante, reset, retryAfter }
}

// ── Bloqueo de IP (blocklist con TTL lógico) ────────────────────────────────

interface RegistroBloqueo {
  hasta: number // ms epoch en que expira el bloqueo.
  motivo: string
  strikes: number
}

export interface EstadoBloqueo {
  bloqueado: boolean
  hasta?: number
  motivo?: string
  retryAfter?: number
}

/** Indica si la IP está actualmente bloqueada (respeta el TTL lógico). */
export async function isIPBlocked(ip: string, ahora: number): Promise<EstadoBloqueo> {
  const store = getRateStore()
  const reg = (await store.get(`block:${ip}`, { type: 'json' })) as RegistroBloqueo | null
  if (!reg || reg.hasta <= ahora) return { bloqueado: false }
  return {
    bloqueado: true,
    hasta: reg.hasta,
    motivo: reg.motivo,
    retryAfter: Math.max(1, Math.ceil((reg.hasta - ahora) / 1000)),
  }
}

interface RegistroStrikes {
  count: number
  expiresAt: number
}

/**
 * Registra un strike para la IP y aplica el bloqueo escalonado correspondiente.
 *
 *   1-2 strikes  → solo log (sin bloqueo)
 *   3-5 strikes  → bloqueo 5 min
 *   6-9 strikes  → bloqueo 30 min
 *   10+ strikes  → bloqueo 24 h
 *
 * Los strikes caducan a la hora del último incidente.
 */
export async function registrarStrike(
  ip: string,
  motivo: string,
  ahora: number
): Promise<void> {
  const store = getRateStore()

  const prev = (await store.get(`strikes:${ip}`, { type: 'json' })) as RegistroStrikes | null
  const baseCount = prev && prev.expiresAt > ahora ? prev.count : 0
  const count = baseCount + 1
  await store.setJSON(`strikes:${ip}`, {
    count,
    expiresAt: ahora + STRIKES_TTL_MS,
  } satisfies RegistroStrikes)

  const escalon = ESCALONES_BLOQUEO.find((e) => count >= e.minStrikes)
  if (!escalon) {
    // 1-2 strikes: solo se deja constancia, sin bloquear.
    console.warn(`[ratelimit] strike ${count} para IP ${ip} (${motivo}) — sin bloqueo`)
    return
  }

  const hasta = ahora + escalon.duracionMs
  await store.setJSON(`block:${ip}`, {
    hasta,
    motivo: `${motivo} — ${count} infracciones, bloqueo ${escalon.etiqueta}`,
    strikes: count,
  } satisfies RegistroBloqueo)
  console.warn(
    `[ratelimit] IP ${ip} bloqueada ${escalon.etiqueta} (${count} strikes, ${motivo})`
  )
}

// ── Construcción de headers RFC 6585 ────────────────────────────────────────

export interface CabecerasRateLimit {
  'X-RateLimit-Limit': string
  'X-RateLimit-Remaining': string
  'X-RateLimit-Reset': string
  'Retry-After'?: string
  'X-Block-Reason'?: string
}

export function construirHeaders(
  r: ResultadoLimiter,
  opts?: { retryAfter?: number; blockReason?: string }
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.restante),
    'X-RateLimit-Reset': new Date(r.reset).toISOString(),
  }
  const retryAfter = opts?.retryAfter ?? (r.permitido ? 0 : r.retryAfter)
  if (retryAfter > 0) headers['Retry-After'] = String(retryAfter)
  if (opts?.blockReason) headers['X-Block-Reason'] = opts.blockReason
  return headers
}

// ── Guardia compuesta para el endpoint público ──────────────────────────────

export interface GuardiaResultado {
  /** true si la petición puede continuar al handler. */
  ok: boolean
  /** Headers RFC 6585 a inyectar en la respuesta (siempre presentes). */
  headers: Record<string, string>
  /** Código de bloqueo y cuerpo, presentes solo cuando ok === false. */
  status?: number
  body?: { error: string; code: string; mensaje: string; retryAfter: number }
}

function respuesta429(
  code: string,
  mensaje: string,
  headers: Record<string, string>,
  retryAfter: number
): GuardiaResultado {
  return {
    ok: false,
    status: 429,
    headers,
    body: { error: 'Too Many Requests', code, mensaje, retryAfter },
  }
}

/**
 * Aplica el stack completo de rate limiting a una petición pública:
 * blocklist → burst → verificador. Devuelve los headers a inyectar y, si
 * corresponde, la respuesta 429 lista para emitir.
 *
 * Fail-open: ante cualquier fallo de la capa de Blobs, permite la petición con
 * headers informativos por defecto. El verificador nunca se rompe por el escudo.
 */
export async function aplicarRateLimit(req: Request): Promise<GuardiaResultado> {
  const ahora = Date.now()
  const ip = extraerIP(req)

  try {
    // 1 — Blocklist: una IP bloqueada se rechaza antes de consumir cupos.
    const bloqueo = await isIPBlocked(ip, ahora)
    if (bloqueo.bloqueado) {
      const headers = construirHeaders(
        {
          permitido: false,
          limit: VERIFICADOR_LIMITER.limit,
          restante: 0,
          reset: bloqueo.hasta ?? ahora,
          retryAfter: bloqueo.retryAfter ?? 1,
        },
        { retryAfter: bloqueo.retryAfter, blockReason: bloqueo.motivo }
      )
      return respuesta429(
        'IP_BLOCKED',
        'Tu IP está temporalmente bloqueada por uso abusivo.',
        headers,
        bloqueo.retryAfter ?? 1
      )
    }

    // 2 — Anti-ráfaga (burst).
    const burst = await consumir(BURST_LIMITER, ip, ahora)
    if (!burst.permitido) {
      await registrarStrike(ip, 'Burst rate limit excedido', ahora)
      const headers = construirHeaders(burst, { retryAfter: burst.retryAfter })
      return respuesta429(
        'BURST_RATE_LIMIT',
        'Demasiadas peticiones en muy poco tiempo. Reducí la frecuencia.',
        headers,
        burst.retryAfter
      )
    }

    // 3 — Límite del verificador. Sus contadores son los que se reportan en los
    //     headers de las respuestas exitosas (es el límite informativo público).
    const verif = await consumir(VERIFICADOR_LIMITER, ip, ahora)
    if (!verif.permitido) {
      await registrarStrike(ip, 'Verificador rate limit excedido', ahora)
      const headers = construirHeaders(verif, { retryAfter: verif.retryAfter })
      return respuesta429(
        'RATE_LIMIT_EXCEEDED',
        'Superaste el límite de consultas por minuto. Intentá más tarde.',
        headers,
        verif.retryAfter
      )
    }

    // OK: se reporta el estado del limiter del verificador.
    return { ok: true, headers: construirHeaders(verif) }
  } catch (err) {
    // Fail-open: sin runtime de Blobs (type-check local, incidente, etc.) se
    // permite la petición con headers por defecto en lugar de romper el servicio.
    console.error('[ratelimit] fail-open por error de infraestructura', err)
    return {
      ok: true,
      headers: {
        'X-RateLimit-Limit': String(VERIFICADOR_LIMITER.limit),
        'X-RateLimit-Remaining': String(VERIFICADOR_LIMITER.limit),
        'X-RateLimit-Reset': new Date(ahora + VERIFICADOR_LIMITER.windowMs).toISOString(),
      },
    }
  }
}
