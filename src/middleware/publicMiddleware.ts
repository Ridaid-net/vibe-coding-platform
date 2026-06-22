// ─── RODAID · Middleware Público ──────────────────────────
// Middleware de seguridad, CORS y reputación de IP para
// endpoints públicos sin autenticación.
//
// Stack de middlewares para GET /verificar/:serial:
//   1. resolverIP(req)          → extraer IP real (CF / nginx / directo)
//   2. checkIPBlocklist(req)    → bloquear IPs con historial de abuso
//   3. checkIPWhitelist(req)    → skip rate limit para fuentes confiables
//   4. corsPublico(req, res)    → CORS headers para apps web/mobile
//   5. securityHeaders(res)     → Content-Security-Policy, X-Frame-Options, etc.
//   6. burstRateLimit           → anti-DoS 20 req / 10s
//   7. verificadorRateLimit     → 100 req / min por IP
//   8. requestLogger            → registrar request en audit log
//   9. handler(req, res)        → lógica de negocio
//
// CORS policy para endpoints públicos:
//   Allow-Origin: * (verificador es público por diseño)
//   Allow-Methods: GET, POST
//   Allow-Headers: Content-Type, X-Origen, X-Request-ID
//   Expose-Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
//
// IP Reputation:
//   · IPs que superan rate limit 5+ veces en 24h → auto-block 6h
//   · IPs en ip_whitelist → exentas de rate limit (Gobierno, socios)
//   · IP en ip_bloqueadas → 403 inmediato

import { Request, Response, NextFunction } from 'express'
import { query, queryOne }  from '../config/database'
import { getRedis }         from '../config/redis'
import { log }              from './logger'
import { getClientIP }      from './rateLimiter'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

interface IPReputacion {
  bloqueada:     boolean
  whitelist:     boolean
  nombre?:       string      // nombre del cliente en whitelist
  motivo?:       string      // motivo del bloqueo
  expiraEn?:     Date
}

// ══════════════════════════════════════════════════════════
// CACHÉ EN REDIS DE REPUTACIÓN (TTL 5 min)
// ══════════════════════════════════════════════════════════

async function getReputacionCache(ip: string): Promise<IPReputacion | null> {
  try {
    const redis = getRedis()
    const raw   = await redis.get(`ip:rep:${ip}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

async function setReputacionCache(ip: string, rep: IPReputacion): Promise<void> {
  try {
    const redis = getRedis()
    await redis.set(`ip:rep:${ip}`, JSON.stringify(rep), 'EX', 300)
  } catch { /* best-effort */ }
}

// ══════════════════════════════════════════════════════════
// LOOKUP DE REPUTACIÓN EN DB
// ══════════════════════════════════════════════════════════

async function consultarReputacion(ip: string): Promise<IPReputacion> {
  // Chequear caché primero
  const cached = await getReputacionCache(ip)
  if (cached) return cached

  // Consultar DB en paralelo
  const [bloqueo, whitelist] = await Promise.all([
    queryOne<{ motivo: string; expira_en: Date | null }>(
      `SELECT motivo, expira_en FROM ip_bloqueadas
       WHERE ip=$1 AND activa=TRUE
         AND (expira_en IS NULL OR expira_en > NOW())
       LIMIT 1`,
      [ip]
    ),
    queryOne<{ nombre: string }>(
      `SELECT nombre FROM ip_whitelist
       WHERE activa=TRUE AND (
         ip_cidr = $1
         OR (
           position('/' IN ip_cidr) > 0
           AND $1::inet <<= ip_cidr::cidr
         )
       ) LIMIT 1`,
      [ip]
    ),
  ])

  const rep: IPReputacion = {
    bloqueada: !!bloqueo,
    whitelist: !!whitelist,
    nombre:    whitelist?.nombre,
    motivo:    bloqueo?.motivo,
    expiraEn:  bloqueo?.expira_en ?? undefined,
  }

  await setReputacionCache(ip, rep)
  return rep
}

// ══════════════════════════════════════════════════════════
// AUTO-BLOCK: registrar abuso y bloquear si supera umbral
// ══════════════════════════════════════════════════════════

export async function registrarAbusoIP(ip: string, endpoint: string): Promise<void> {
  const redis   = getRedis()
  const key     = `ip:abuse:${ip}`

  try {
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 86400)   // ventana de 24 horas

    // Bloquear automáticamente si supera 50 rate limits en 24h
    if (count >= 50) {
      const yaExiste = await queryOne(
        `SELECT id FROM ip_bloqueadas WHERE ip=$1 AND activa=TRUE LIMIT 1`, [ip]
      )
      if (!yaExiste) {
        await query(
          `INSERT INTO ip_bloqueadas (ip, motivo, expira_en, bloqueada_por)
           VALUES ($1, $2, NOW() + INTERVAL '6 hours', 'AUTO')
           ON CONFLICT DO NOTHING`,
          [ip, `Auto-block: ${count} rate limit violations en 24h (último: ${endpoint})`]
        )
        // Invalidar caché de reputación
        await redis.del(`ip:rep:${ip}`)
        log.public.warn({ ip, count, endpoint }, '🚫 IP auto-bloqueada por abuso')
      }
    }
  } catch { /* best-effort */ }
}

// ══════════════════════════════════════════════════════════
// CORS PARA ENDPOINTS PÚBLICOS
// ══════════════════════════════════════════════════════════

const ALLOWED_ORIGINS_PUBLIC = [
  'https://rodaid.com.ar',
  'https://www.rodaid.com.ar',
  'https://app.rodaid.com.ar',
  'https://verificar.rodaid.com.ar',
  'http://localhost:3000',
  'http://localhost:5173',
]

export function corsPublico(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin ?? ''

  // Permitir cualquier origen para GET (verificador es público)
  // Para POST se restringe a orígenes conocidos
  if (req.method === 'GET' || req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (ALLOWED_ORIGINS_PUBLIC.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else {
    // POST desde origen desconocido → permitir pero no setear ACAO
    // (el browser bloqueará la respuesta pero la API funcionará para server-to-server)
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }

  res.setHeader('Access-Control-Allow-Methods',  'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, X-Origen, X-Request-ID, Accept')
  res.setHeader('Access-Control-Expose-Headers',
    'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After')
  res.setHeader('Access-Control-Max-Age', '86400')   // pre-flight cache 24h

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  next()
}

// ══════════════════════════════════════════════════════════
// SECURITY HEADERS
// ══════════════════════════════════════════════════════════

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Evitar que el navegador detecte el tipo MIME incorrecto
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // No permitir que la respuesta sea mostrada en iframes (clickjacking)
  res.setHeader('X-Frame-Options', 'DENY')
  // Solo HTTPS en producción
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  // Deshabilitar caché en respuestas de la API
  res.setHeader('Cache-Control', 'no-store')
  // Identificar la API
  res.setHeader('X-API-Version', '2.0.0')
  res.setHeader('X-Powered-By',  'RODAID')
  next()
}

// ══════════════════════════════════════════════════════════
// MIDDLEWARE PRINCIPAL: check de IP bloqueada / whitelist
// ══════════════════════════════════════════════════════════

export async function checkIPReputacion(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  const ip = getClientIP(req)

  let rep: IPReputacion
  try {
    rep = await consultarReputacion(ip)
  } catch {
    // Si falla la consulta → no bloquear (fail open para el verificador)
    next(); return
  }

  // Whitelist → saltar rate limiting (agregar flag al request)
  if (rep.whitelist) {
    ;(req as unknown as Record<string, unknown>)['_rodaid_whitelist'] = true
    ;(req as unknown as Record<string, unknown>)['_rodaid_nombre']    = rep.nombre
    res.setHeader('X-RateLimit-Whitelist', rep.nombre ?? '1')
    log.public.debug({ ip, nombre: rep.nombre }, 'IP en whitelist — rate limit exento')
    next(); return
  }

  // Bloqueada → 403 inmediato
  if (rep.bloqueada) {
    const expiraMsg = rep.expiraEn
      ? ` Expira: ${rep.expiraEn.toLocaleString('es-AR')}`
      : ' Bloqueo permanente.'
    log.public.warn({ ip, motivo: rep.motivo }, '🚫 Request bloqueado — IP en blocklist')
    res.status(403).json({
      ok:    false,
      error: {
        code:    'IP_BLOQUEADA',
        message: `Acceso denegado desde esta IP.${expiraMsg} Contactá a soporte@rodaid.com.ar si es un error.`,
      },
    })
    return
  }

  next()
}

// ══════════════════════════════════════════════════════════
// REQUEST ID — tracing distribuido
// ══════════════════════════════════════════════════════════

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = req.headers['x-request-id'] as string
    || `rodaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  res.setHeader('X-Request-ID', id)
  ;(req as unknown as Record<string, unknown>)['requestId'] = id
  next()
}

// ══════════════════════════════════════════════════════════
// ADMIN: gestión de bloqueos y whitelist
// ══════════════════════════════════════════════════════════

export async function bloquearIP(
  ip: string, motivo: string, horas?: number
): Promise<void> {
  const expira = horas ? `NOW() + INTERVAL '${horas} hours'` : 'NULL'
  await query(
    `INSERT INTO ip_bloqueadas (ip, motivo, expira_en, bloqueada_por)
     VALUES ($1, $2, ${expira}, 'ADMIN')
     ON CONFLICT (ip) DO UPDATE
       SET motivo=$2, expira_en=EXCLUDED.expira_en, activa=TRUE, bloqueada_en=NOW()`,
    [ip, motivo]
  )
  const redis = getRedis()
  await redis.del(`ip:rep:${ip}`).catch(() => {})
  log.public.info({ ip, motivo, horas }, '🚫 IP bloqueada manualmente')
}

export async function desbloquearIP(ip: string): Promise<void> {
  await query(`UPDATE ip_bloqueadas SET activa=FALSE WHERE ip=$1`, [ip])
  const redis = getRedis()
  await redis.del(`ip:rep:${ip}`).catch(() => {})
  log.public.info({ ip }, '✓ IP desbloqueada')
}

export async function agregarWhitelist(ipCidr: string, nombre: string): Promise<void> {
  await query(
    `INSERT INTO ip_whitelist (ip_cidr, nombre) VALUES ($1, $2)
     ON CONFLICT (ip_cidr) DO UPDATE SET nombre=$2, activa=TRUE`,
    [ipCidr, nombre]
  )
  // Invalidar caché de todas las IPs en ese rango
  const redis = getRedis()
  const keys  = await redis.keys('ip:rep:*')
  if (keys.length > 0) await redis.del(...keys)
}

export async function getIPStats() {
  const [bloqueadas, whitelist, abusos] = await Promise.all([
    query<{ ip: string; motivo: string; expira_en: Date | null; bloqueada_en: Date }>(
      `SELECT ip, motivo, expira_en, bloqueada_en FROM ip_bloqueadas
       WHERE activa=TRUE ORDER BY bloqueada_en DESC LIMIT 20`,
      []
    ),
    query<{ ip_cidr: string; nombre: string }>(
      `SELECT ip_cidr, nombre FROM ip_whitelist WHERE activa=TRUE ORDER BY creada_en DESC`,
      []
    ),
    (async () => {
      const redis  = getRedis()
      const keys   = await redis.keys('ip:abuse:*')
      const result = await Promise.all(
        keys.slice(0, 20).map(async k => ({
          ip:    k.replace('ip:abuse:', ''),
          count: parseInt((await redis.get(k)) ?? '0'),
        }))
      )
      return result.sort((a, b) => b.count - a.count).slice(0, 10)
    })(),
  ])

  return { bloqueadas, whitelist, abusos }
}
