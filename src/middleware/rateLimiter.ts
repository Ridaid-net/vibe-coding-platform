// ─── RODAID · Rate Limiting & Throttling ─────────────────
// Sliding window (RateLimiterRedis) — distribuido, sobrevive reinicios
// Fallback transparente a memoria si Redis no está disponible
// Límites por: IP global · IP por endpoint · usuario autenticado · inspector

import {
  RateLimiterRedis, RateLimiterMemory,
  RateLimiterAbstract, RateLimiterRes,
} from 'rate-limiter-flexible'
import Redis from 'ioredis'
import { Request, Response, NextFunction } from 'express'
import { AuthRequest } from '../types'
import { env } from '../config/env'
import { logger } from './logger'

// ══════════════════════════════════════════════════════════
// CLIENTE REDIS COMPARTIDO
// ══════════════════════════════════════════════════════════

let redisClient: Redis | null = null

async function getRedisClient(): Promise<Redis | null> {
  if (redisClient?.status === 'ready') return redisClient

  try {
    const url = env.REDIS_URL || 'redis://127.0.0.1:6379'
    redisClient = new Redis(url, {
      enableReadyCheck:     true,
      maxRetriesPerRequest: 3,
      lazyConnect:          true,
    })
    redisClient.on('error', (err: Error) =>
      logger.warn({ err: err.message }, 'RateLimiter Redis error — usando fallback en memoria')
    )
    await redisClient.connect()
    logger.info('✓ RateLimiter conectado a Redis')
    return redisClient
  } catch {
    logger.warn('RateLimiter: Redis no disponible — usando fallback en memoria')
    return null
  }
}

// ══════════════════════════════════════════════════════════
// FACTORY — crea limiter Redis con fallback a Memory
// ══════════════════════════════════════════════════════════

interface LimiterConfig {
  keyPrefix:  string
  points:     number   // número de requests permitidos
  duration:   number   // ventana en segundos
  blockDuration?: number  // segundos de bloqueo al superar el límite
}

function createLimiter(config: LimiterConfig, client: Redis | null): RateLimiterAbstract {
  const base = {
    keyPrefix:     config.keyPrefix,
    points:        config.points,
    duration:      config.duration,
    blockDuration: config.blockDuration ?? 0,
  }

  if (client?.status === 'ready') {
    return new RateLimiterRedis({ ...base, storeClient: client as any })
  }
  return new RateLimiterMemory(base)
}

// ══════════════════════════════════════════════════════════
// LIMITERS — uno por contexto de uso
// ══════════════════════════════════════════════════════════

let limiters: {
  // Límites globales (sin auth)
  globalIP:      RateLimiterAbstract   // 200 req / 15 min por IP
  // Endpoints de autenticación (ataque de fuerza bruta)
  authLogin:     RateLimiterAbstract   // 5 intentos / 15 min por IP
  authRegister:  RateLimiterAbstract   // 3 registros / hora por IP
  authRefresh:   RateLimiterAbstract   // 10 refreshes / min por IP
  // Usuarios autenticados
  userAPI:       RateLimiterAbstract   // 300 req / min por userId
  // Inspectores — emisión de CITs
  inspectorCIT:  RateLimiterAbstract   // 30 CITs / hora por inspectorId
  // Verificador público — puede recibir mucho tráfico
  verificador:   RateLimiterAbstract   // 100 req / min por IP
  // Denuncia — evitar spam
  denuncia:      RateLimiterAbstract   // 5 denuncias / hora por userId
  // Admin — throttle generoso pero registrado
  admin:         RateLimiterAbstract   // 200 req / min por userId
  // Burst: anti-DoS (cortocircuito muy estricto)
  burst:         RateLimiterAbstract   // 20 req / 10 seg por IP
  // Strict público: POST sensibles sin auth
  publicStrict:  RateLimiterAbstract   // 30 req / min por IP
} | null = null

export async function initRateLimiters(): Promise<void> {
  const client = await getRedisClient()

  limiters = {
    globalIP: createLimiter(
      { keyPrefix: 'rl:global', points: 200, duration: 900 },     // 200/15min
      client
    ),
    authLogin: createLimiter(
      { keyPrefix: 'rl:auth:login', points: 5, duration: 900 },  // 5/15min, bloquea 15min
      client
    ),
    authRegister: createLimiter(
      { keyPrefix: 'rl:auth:register', points: 3, duration: 3600 },  // 3/hora
      client
    ),
    authRefresh: createLimiter(
      { keyPrefix: 'rl:auth:refresh', points: 10, duration: 60 },    // 10/min
      client
    ),
    userAPI: createLimiter(
      { keyPrefix: 'rl:user', points: 300, duration: 60 },           // 300/min por userId
      client
    ),
    inspectorCIT: createLimiter(
      { keyPrefix: 'rl:inspector:cit', points: 30, duration: 3600 }, // 30 CITs/hora
      client
    ),
    verificador: createLimiter(
      { keyPrefix: 'rl:verificador', points: 100, duration: 60 },    // 100/min — endpoint público
      client
    ),
    denuncia: createLimiter(
      { keyPrefix: 'rl:denuncia', points: 5, duration: 3600 },       // 5 denuncias/hora
      client
    ),
    admin: createLimiter(
      { keyPrefix: 'rl:admin', points: 200, duration: 60 },          // 200/min
      client
    ),
    burst: createLimiter(
      { keyPrefix: 'rl:burst', points: 20, duration: 10,
        blockDuration: 60 },  // bloquea 60s si supera 20 req/10s
      client
    ),
    publicStrict: createLimiter(
      { keyPrefix: 'rl:public', points: 30, duration: 60 },          // 30/min
      client
    ),
  }

  logger.info({
    backend: client?.status === 'ready' ? 'Redis (sliding window)' : 'Memory (fallback)',
    limiters: Object.keys(limiters).length,
  }, '✓ Rate limiters inicializados')
}

// ══════════════════════════════════════════════════════════
// BLOCKLIST DE IPs EN REDIS
// Clave: rl:block:{ip}  — valor: motivo  — TTL: segundos de bloqueo
// ══════════════════════════════════════════════════════════

const BLOCK_KEY = (ip: string) => `rl:block:${ip}`
const STRIKE_KEY = (ip: string) => `rl:strikes:${ip}`

/** Verificar si una IP está en la blocklist */
export async function isIPBlocked(ip: string): Promise<{ blocked: boolean; ttlSec: number; motivo?: string }> {
  try {
    const client = await getRedisClient()
    if (!client) return { blocked: false, ttlSec: 0 }
    const [motivo, ttl] = await Promise.all([
      client.get(BLOCK_KEY(ip)),
      client.ttl(BLOCK_KEY(ip)),
    ])
    return motivo
      ? { blocked: true, ttlSec: Math.max(0, ttl), motivo }
      : { blocked: false, ttlSec: 0 }
  } catch {
    return { blocked: false, ttlSec: 0 }
  }
}

/** Bloquear una IP manualmente (admin) */
export async function bloquearIP(
  ip: string,
  motivo: string,
  duracionSec: number = 86400  // 24h por defecto
): Promise<void> {
  try {
    const client = await getRedisClient()
    if (!client) return
    await client.set(BLOCK_KEY(ip), motivo, 'EX', duracionSec)
    logger.warn({ ip, motivo, duracionSec }, '🚫 IP bloqueada manualmente')
  } catch { /* best-effort */ }
}

/** Desbloquear IP (admin) */
export async function desbloquearIP(ip: string): Promise<void> {
  try {
    const client = await getRedisClient()
    if (!client) return
    await Promise.all([
      client.del(BLOCK_KEY(ip)),
      client.del(STRIKE_KEY(ip)),
    ])
    logger.info({ ip }, '✓ IP desbloqueada')
  } catch { /* best-effort */ }
}

/** Registrar strike de rate limit — 3 strikes → bloqueo progresivo */
async function registrarStrike(ip: string, limiter: string, endpoint: string): Promise<void> {
  try {
    const client = await getRedisClient()
    if (!client) return

    // Incrementar strikes con TTL de 1 hora
    const strikes = await client.incr(STRIKE_KEY(ip))
    await client.expire(STRIKE_KEY(ip), 3600)

    // Esquema progresivo de bloqueo:
    //   1-2 strikes: solo log
    //   3-5 strikes: bloqueo 5 min
    //   6-9 strikes: bloqueo 30 min
    //   10+ strikes: bloqueo 24h
    let blockSec = 0; let motivo = ''
    if (strikes >= 10) { blockSec = 86400; motivo = `${strikes} strikes en 1h — bloqueo 24h` }
    else if (strikes >= 6) { blockSec = 1800; motivo = `${strikes} strikes en 1h — bloqueo 30min` }
    else if (strikes >= 3) { blockSec = 300;  motivo = `${strikes} strikes en 1h — bloqueo 5min` }

    if (blockSec > 0) {
      await client.set(BLOCK_KEY(ip), motivo, 'EX', blockSec)
      logger.warn({ ip, strikes, blockSec, limiter }, `🔴 IP bloqueada progresivamente: ${motivo}`)
    }

    // Persistir en DB (fire-and-forget)
    const { query } = await import('../config/database')
    query(
      `INSERT INTO ratelimit_log (ip, endpoint, limiter, violations, primer_hit, ultimo_hit, bloqueada_hasta)
       VALUES ($1, $2, $3, $4, NOW(), NOW(),
         CASE WHEN $5 > 0 THEN NOW() + make_interval(secs => $5) ELSE NULL END)
       ON CONFLICT DO NOTHING`,
      [ip, endpoint.slice(0, 200), limiter, strikes, blockSec]
    ).catch(() => {})
  } catch { /* best-effort */ }
}

// ══════════════════════════════════════════════════════════
// HELPER — ejecuta el limiter y responde 429 si excede
// ══════════════════════════════════════════════════════════

export function getClientIP(req: Request): string {
  // Prioridad: Cloudflare > Load Balancer > X-Forwarded-For > req.ip
  // CF-Connecting-IP es más confiable que X-Forwarded-For (no falsificable en CF)
  const cf   = req.headers['cf-connecting-ip']
  if (cf && !Array.isArray(cf)) return cf.trim()

  // X-Real-IP (nginx proxy_pass)
  const realIP = req.headers['x-real-ip']
  if (realIP && !Array.isArray(realIP)) return realIP.trim()

  // X-Forwarded-For: primera IP (cliente original antes de proxies)
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded
    const first = ips.split(',')[0].trim()
    if (first && first !== 'unknown') return first
  }

  // Railway / Render ponen la IP en req.ip cuando trust proxy está seteado
  return req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0'
}

async function consume(
  limiter:  RateLimiterAbstract,
  key:      string,
  req:      Request,
  res:      Response,
  next:     NextFunction,
  errorMsg: string,
  code:     string,
): Promise<void> {
  try {
    const result = await limiter.consume(key)

    // Headers estándar de rate limiting (RFC 6585 / draft-ietf-httpapi-ratelimit-headers)
    res.setHeader('X-RateLimit-Limit',     limiter.points)
    res.setHeader('X-RateLimit-Remaining', result.remainingPoints)
    res.setHeader('X-RateLimit-Reset',     new Date(Date.now() + result.msBeforeNext).toISOString())

    next()
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      const retryAfterSec = Math.ceil(err.msBeforeNext / 1000)

      res.setHeader('X-RateLimit-Limit',     limiter.points)
      res.setHeader('X-RateLimit-Remaining', 0)
      res.setHeader('X-RateLimit-Reset',     new Date(Date.now() + err.msBeforeNext).toISOString())
      res.setHeader('Retry-After',           retryAfterSec)

      const clientIP = getClientIP(req)
      logger.warn({
        key,
        code,
        ip:         clientIP,
        path:       req.path,
        method:     req.method,
        retryAfter: retryAfterSec,
      }, `Rate limit excedido · ${code}`)

      // Registrar strike para bloqueo progresivo (solo endpoints públicos por IP)
      if (key === clientIP) {
        registrarStrike(clientIP, code, req.path).catch(() => {})
      }

      res.status(429).json({
        ok:    false,
        error: {
          code,
          message:    errorMsg,
          retryAfter: retryAfterSec,
        },
      })
    } else {
      // Error interno del limiter — no bloquear al usuario
      logger.error({ err }, 'Rate limiter error interno — request permitido')
      next()
    }
  }
}

// ══════════════════════════════════════════════════════════
// MIDDLEWARES EXPORTADOS — uno por tipo de endpoint
// ══════════════════════════════════════════════════════════

// ── Global: todas las rutas ────────────────────────────────
export function globalRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  const ip = getClientIP(req)

  // Chequear blocklist en global limiter
  isIPBlocked(ip).then(({ blocked, ttlSec }) => {
    if (blocked) {
      res.setHeader('Retry-After', ttlSec)
      res.status(429).json({
        ok: false,
        error: { code: 'IP_BLOCKED', message: 'IP temporalmente bloqueada.', retryAfter: ttlSec },
      })
      return
    }
    consume(limiters!.globalIP, ip, req, res, next,
      'Demasiadas solicitudes desde esta IP. Reintentá en 15 minutos.',
      'RATE_LIMIT_IP'
    )
  }).catch(() => {
    consume(limiters!.globalIP, ip, req, res, next,
      'Demasiadas solicitudes desde esta IP. Reintentá en 15 minutos.',
      'RATE_LIMIT_IP'
    )
  })
}

// ── Auth: POST /auth/login ─────────────────────────────────
export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  // Clave por IP — combate fuerza bruta contra emails conocidos
  const ip = getClientIP(req)
  consume(limiters.authLogin, `${ip}`, req, res, next,
    'Demasiados intentos de inicio de sesión. Cuenta bloqueada temporalmente 15 minutos.',
    'LOGIN_RATE_LIMIT'
  )
}

// ── Auth: POST /auth/register ──────────────────────────────
export function registerRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  const ip = getClientIP(req)
  consume(limiters.authRegister, ip, req, res, next,
    'Límite de registros desde esta IP alcanzado. Reintentá en 1 hora.',
    'REGISTER_RATE_LIMIT'
  )
}

// ── Auth: POST /auth/refresh ───────────────────────────────
export function refreshRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  const ip = getClientIP(req)
  consume(limiters.authRefresh, ip, req, res, next,
    'Demasiadas renovaciones de token. Reintentá en 1 minuto.',
    'REFRESH_RATE_LIMIT'
  )
}

// ── Usuario autenticado — límite por userId ────────────────
export function userRateLimit(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  // Si no hay userId, caer al límite global por IP
  const key = req.user?.sub ?? getClientIP(req)
  consume(limiters.userAPI, key, req, res, next,
    'Demasiadas solicitudes. Tu cuenta está limitada temporalmente.',
    'USER_RATE_LIMIT'
  )
}

// ── Inspector: POST /cit/iniciar ───────────────────────────
export function inspectorCITRateLimit(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  const key = req.user?.sub ?? getClientIP(req)
  consume(limiters.inspectorCIT, key, req, res, next,
    'Límite de CITs por hora alcanzado. El protocolo permite máximo 30 certificaciones por hora.',
    'INSPECTOR_CIT_RATE_LIMIT'
  )
}

// ── Verificador público — con blocklist + progressive ──────
export function verificadorRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  const ip = getClientIP(req)

  // Chequear blocklist antes de consumir puntos del limiter
  isIPBlocked(ip).then(({ blocked, ttlSec, motivo }) => {
    if (blocked) {
      res.setHeader('Retry-After', ttlSec)
      res.setHeader('X-Block-Reason', motivo ?? 'blocked')
      logger.warn({ ip, ttlSec, motivo, path: req.path }, '🚫 IP en blocklist — request rechazado')
      res.status(429).json({
        ok: false,
        error: {
          code:       'IP_BLOCKED',
          message:    'Tu IP está temporalmente bloqueada por exceder los límites de uso.',
          retryAfter: ttlSec,
        },
      })
      return
    }
    consume(limiters!.verificador, ip, req, res, next,
      'Demasiadas verificaciones desde esta IP. Reintentá en 1 minuto.',
      'VERIFICADOR_RATE_LIMIT'
    )
  }).catch(() => {
    consume(limiters!.verificador, ip, req, res, next,
      'Demasiadas verificaciones desde esta IP. Reintentá en 1 minuto.',
      'VERIFICADOR_RATE_LIMIT'
    )
  })
}

// ── Burst: anti-DoS (cualquier endpoint público) ─────────────
export function burstRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  const ip = getClientIP(req)
  consume(limiters.burst, ip, req, res, next,
    'Demasiadas solicitudes en un período muy corto. Esperá unos segundos.',
    'BURST_RATE_LIMIT'
  )
}

// ── Público estricto: POST sin auth (verificar-firma, sello) ──
export function publicStrictRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  const ip = getClientIP(req)
  consume(limiters.publicStrict, ip, req, res, next,
    'Límite de solicitudes públicas alcanzado. Reintentá en 1 minuto.',
    'PUBLIC_RATE_LIMIT'
  )
}

// ── Denuncia — evitar spam ─────────────────────────────────
export function denunciaRateLimit(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  const key = req.user?.sub ?? getClientIP(req)
  consume(limiters.denuncia, key, req, res, next,
    'Límite de denuncias por hora alcanzado. Si es urgente, contactá al 911.',
    'DENUNCIA_RATE_LIMIT'
  )
}

// ── Admin ──────────────────────────────────────────────────
export function adminRateLimit(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!limiters) { next(); return }
  const key = req.user?.sub ?? getClientIP(req)
  consume(limiters.admin, key, req, res, next,
    'Límite de solicitudes admin alcanzado.',
    'ADMIN_RATE_LIMIT'
  )
}

// ══════════════════════════════════════════════════════════
// CONSULTA DE ESTADO — para el endpoint /admin/rate-limits
// ══════════════════════════════════════════════════════════

export async function getRateLimitStatus(identifier: string): Promise<Record<string, unknown>> {
  if (!limiters) return { status: 'no_inicializado' }

  const results: Record<string, unknown> = {}
  const entries = Object.entries(limiters) as [string, RateLimiterAbstract][]

  for (const [name, limiter] of entries) {
    try {
      const res = await Promise.race([
        (limiter as any).get(identifier),
        new Promise<null>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
      ])
      results[name] = res
        ? {
            consumedPoints:   (res as any).consumedPoints,
            remainingPoints:  limiter.points - (res as any).consumedPoints,
            limit:            limiter.points,
            msBeforeReset:    (res as any).msBeforeNext,
          }
        : { consumedPoints: 0, remainingPoints: limiter.points, limit: limiter.points }
    } catch {
      results[name] = { consumedPoints: 0, remainingPoints: limiter.points, limit: limiter.points }
    }
  }

  return results
}

// ── Limpiar limiters (para tests) ─────────────────────────
export async function resetRateLimit(key: string, limitName?: string): Promise<void> {
  if (!limiters) return
  const targets = limitName
    ? [limiters[limitName as keyof typeof limiters]]
    : Object.values(limiters)
  // Fire-and-forget con timeout individual para no bloquear
  await Promise.allSettled(
    (targets as RateLimiterAbstract[]).map(l =>
      Promise.race([
        (l as any).delete(key).catch(() => {}),
        new Promise<void>(r => setTimeout(r, 500)),
      ])
    )
  )
}

/** Listar IPs bloqueadas actualmente */
export async function getBlockedIPs(): Promise<Array<{ ip: string; motivo: string; ttlSec: number }>> {
  try {
    const client = await getRedisClient()
    if (!client) return []
    const keys = await client.keys('rl:block:*')
    if (!keys.length) return []
    const results = await Promise.all(
      keys.map(async (key) => {
        const ip     = key.replace('rl:block:', '')
        const motivo = await client.get(key)
        const ttl    = await client.ttl(key)
        return { ip, motivo: motivo ?? '', ttlSec: Math.max(0, ttl) }
      })
    )
    return results
  } catch { return [] }
}

/** Listar violaciones recientes desde DB */
export async function getViolacionesRecientes(horas = 24) {
  const { query } = await import('../config/database')
  return query(
    `SELECT ip, limiter, violations, primer_hit, ultimo_hit, bloqueada_hasta
     FROM ratelimit_log
     WHERE ultimo_hit > NOW() - INTERVAL '${horas} hours'
     ORDER BY violations DESC LIMIT 50`,
    []
  )
}

export async function closeRateLimiters(): Promise<void> {
  if (redisClient && redisClient.status !== 'end') {
    await redisClient.quit()
    redisClient = null
  }
}
