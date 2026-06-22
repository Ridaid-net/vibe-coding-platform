// ─── RODAID · MxM Token Refresh Service ─────────────────
// Renueva el access token de MxM proactivamente antes de
// que expire, usando el refresh_token almacenado en DB.
//
// Estrategia:
//   · Buffer de 10 minutos: renueva si el token vence en < 10 min
//   · Lock Redis: evita renovaciones concurrentes para el mismo user
//   · Retry: intenta hasta 3 veces con backoff exponencial
//   · Cola proactiva: cron (o admin trigger) renueva todos los
//     tokens que vencen en < 15 minutos
//
// Flujo de getMxMAccessToken (mejorado):
//   1. Leer token de DB
//   2. Vigente y no expira pronto → devolver directamente
//   3. Expira en < BUFFER_MIN → intentar renovar (async si hay tiempo)
//   4. Ya expirado → renovar (bloqueante)
//   5. Sin refresh_token → devolver null (usuario debe re-autenticar)
//
// STUB mode (sin credenciales MxM):
//   → genera tokens de stub rotantes sin llamar al IdP real
//   → útil para testing del flujo sin MxM real

import crypto from 'crypto'
import { query, queryOne }         from '../config/database'
import { getRedis }                from '../config/redis'
import { mxmService }              from './mxm.service'
import { log }                     from '../middleware/logger'
import { env }                     from '../config/env'

// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════

/** Minutos antes del vencimiento para renovar proactivamente */
const BUFFER_MIN    = 10

/** Minutos mínimos que debe durar el nuevo token (si MxM devuelve < esto, es sospechoso) */
const MIN_TTL_MIN   = 5

/** Segundos de lock Redis para evitar renovaciones concurrentes */
const LOCK_TTL_SEC  = 30

/** Intentos de renovación antes de marcar como fallida */
const MAX_REINTENTOS = 3

/** Backoff en ms: intento 1 → 0, intento 2 → 2s, intento 3 → 6s */
const BACKOFF_MS    = [0, 2000, 6000]

const MODO_STUB     = !env.MXM_CLIENT_ID || !env.MXM_CLIENT_SECRET

const lockKey  = (userId: string) => `mxm:refresh_lock:${userId}`
const cacheKey = (userId: string) => `mxm:access_token:${userId}`

// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: getAccessToken con renovación proactiva
// ══════════════════════════════════════════════════════════

export async function getAccessTokenConRenovacion(userId: string): Promise<{
  token:    string | null
  origen:   'cache_redis' | 'db_vigente' | 'renovado' | 'stub' | 'sin_token'
  expiraEn: Date | null
  renovado: boolean
}> {
  // 1. Intentar Redis cache (tokens vigentes cacheados)
  const redis = getRedis()
  const cached = await redis.get(cacheKey(userId))
  if (cached) {
    return { token: cached, origen: 'cache_redis', expiraEn: null, renovado: false }
  }

  // 2. Leer token de DB
  const row = await queryOne<{
    access_token: string; refresh_token: string | null
    expires_at: Date; renovando: boolean
  }>(
    `SELECT access_token, refresh_token, expires_at, renovando
     FROM mxm_tokens WHERE usuario_id=$1`,
    [userId]
  )

  if (!row) return { token: null, origen: 'sin_token', expiraEn: null, renovado: false }

  const expiraEn    = new Date(row.expires_at)
  const ahoraMs     = Date.now()
  const msHastaExp  = expiraEn.getTime() - ahoraMs
  const minHastaExp = msHastaExp / 60_000

  // 3. Token vigente y con margen suficiente → devolver sin renovar
  if (minHastaExp > BUFFER_MIN) {
    // Cachear en Redis con TTL = tiempo hasta (expira - buffer)
    const redisTTL = Math.max(60, Math.floor(msHastaExp / 1000) - BUFFER_MIN * 60)
    await redis.set(cacheKey(userId), row.access_token, 'EX', redisTTL)
    return { token: row.access_token, origen: 'db_vigente', expiraEn, renovado: false }
  }

  // 4. Token expirado o por expirar → necesitamos renovar
  if (!row.refresh_token) {
    log.mxm.warn({ userId: userId.slice(0, 8), minHastaExp: minHastaExp.toFixed(1) },
      'Token MxM por vencer sin refresh_token — usuario debe re-autenticar')
    return { token: minHastaExp > 0 ? row.access_token : null, origen: 'sin_token', expiraEn, renovado: false }
  }

  // 5. Intentar renovar con lock Redis
  const renovado = await renovarConLock(userId, row.refresh_token, minHastaExp)
  if (renovado) {
    const tokNuevo = await redis.get(cacheKey(userId))
    return { token: tokNuevo, origen: 'renovado', expiraEn: null, renovado: true }
  }

  // 6. Lock tomado por otro proceso o renovación fallida → devolver token actual si aún sirve
  return {
    token:    minHastaExp > 0 ? row.access_token : null,
    origen:   'db_vigente',
    expiraEn,
    renovado: false,
  }
}

// ══════════════════════════════════════════════════════════
// RENOVAR CON LOCK (evita renovaciones concurrentes)
// ══════════════════════════════════════════════════════════

async function renovarConLock(
  userId:        string,
  refreshToken:  string,
  minHastaExp:   number
): Promise<boolean> {
  const redis = getRedis()
  const lk    = lockKey(userId)

  // Intentar adquirir lock (SET NX EX)
  const lockAcquired = await redis.set(lk, '1', 'EX', LOCK_TTL_SEC, 'NX')
  if (!lockAcquired) {
    log.mxm.debug({ userId: userId.slice(0, 8) }, 'Renovación en curso por otro proceso — esperando')
    // Esperar a que el otro proceso termine (hasta 5s)
    await waitForLockRelease(lk, redis)
    const tokDespues = await redis.get(cacheKey(userId))
    return !!tokDespues
  }

  try {
    const resultado = await renovarConReintentos(userId, refreshToken)
    return resultado
  } finally {
    await redis.del(lk)
  }
}

// Esperar a que se libere un lock (polling ligero)
async function waitForLockRelease(lk: string, redis: any, maxMs = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 300))
    const exists = await redis.exists(lk)
    if (!exists) return
  }
}

// ══════════════════════════════════════════════════════════
// RENOVACIÓN CON RETRY
// ══════════════════════════════════════════════════════════

async function renovarConReintentos(userId: string, _refreshToken: string): Promise<boolean> {
  for (let intento = 0; intento < MAX_REINTENTOS; intento++) {
    if (intento > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[intento] ?? 6000))

    try {
      const tokens = await ejecutarRefresh(userId)
      if (!tokens) return false

      // Calcular TTL del nuevo token
      const expMs  = tokens.expires_in ? tokens.expires_in * 1000 : 3600_000
      const expDate = new Date(Date.now() + expMs)

      if (expMs / 60_000 < MIN_TTL_MIN) {
        log.mxm.warn({ userId: userId.slice(0, 8), expMs }, 'Token MxM con TTL sospechosamente corto')
      }

      // Guardar en Redis cache
      const redis = getRedis()
      const redisTTL = Math.max(60, Math.floor(expMs / 1000) - BUFFER_MIN * 60)
      await redis.set(cacheKey(userId), tokens.access_token, 'EX', redisTTL)

      // Registrar en audit log
      await query(
        `INSERT INTO mxm_token_renovaciones
           (usuario_id, resultado, access_expira_en, intentos)
         VALUES ($1,'OK',$2,$3)`,
        [userId, expDate, intento + 1]
      ).catch(() => {})

      log.mxm.info({
        userId: userId.slice(0, 8),
        expiraEn: expDate.toISOString(),
        intentos: intento + 1,
      }, '✓ Access token MxM renovado')

      return true

    } catch (err) {
      const msg = (err as Error).message
      log.mxm.warn({ userId: userId.slice(0, 8), intento, err: msg }, `Renovación fallida (intento ${intento + 1})`)

      if (intento === MAX_REINTENTOS - 1) {
        await query(
          `INSERT INTO mxm_token_renovaciones (usuario_id, resultado, error_msg, intentos) VALUES ($1,'FALLIDO',$2,$3)`,
          [userId, msg.slice(0, 500), intento + 1]
        ).catch(() => {})
        // Marcar el usuario para re-autenticación
        await query(
          `UPDATE usuarios SET mxm_verificado=FALSE WHERE id=$1`, [userId]
        ).catch(() => {})
        log.mxm.error({ userId: userId.slice(0, 8) },
          '🚨 Refresh token MxM agotado — usuario requiere re-autenticación')
      }
    }
  }
  return false
}

// ══════════════════════════════════════════════════════════
// EJECUTAR EL REFRESH (real o STUB)
// ══════════════════════════════════════════════════════════

async function ejecutarRefresh(userId: string): Promise<{ access_token: string; expires_in: number } | null> {
  if (MODO_STUB) {
    // STUB: genera token rotante sin llamar al IdP
    const stubToken = `stub_access_${crypto.randomBytes(16).toString('hex')}`
    const expiresIn = 3600  // 1 hora

    await query(
      `UPDATE mxm_tokens SET
         access_token   = $2,
         expires_at     = NOW() + INTERVAL '1 hour',
         actualizado_en = NOW()
       WHERE usuario_id = $1`,
      [userId, stubToken]
    )
    log.mxm.warn({ userId: userId.slice(0, 8) }, '⚠ STUB: token MxM renovado sintéticamente')
    return { access_token: stubToken, expires_in: expiresIn }
  }

  // REAL: usar mxmService.refreshToken()
  const tokens = await mxmService.refreshToken(userId)
  if (!tokens) return null
  return { access_token: tokens.access_token, expires_in: tokens.expires_in ?? 3600 }
}

// ══════════════════════════════════════════════════════════
// COLA PROACTIVA: renovar todos los que vencen pronto
// (llamar desde cron o admin trigger cada 5 minutos)
// ══════════════════════════════════════════════════════════

export async function renovarTokensProximos(opts?: {
  bufferMinutos?: number
}): Promise<{ procesados: number; renovados: number; fallidos: number; omitidos: number }> {
  const buffer = opts?.bufferMinutos ?? BUFFER_MIN + 5  // 15 min de margen

  // Usuarios con token que vence en < buffer minutos y tienen refresh_token
  const usuarios = await query<{ usuario_id: string; expires_at: Date; minutos_restantes: string }>(
    `SELECT usuario_id, expires_at,
            EXTRACT(EPOCH FROM (expires_at - NOW()))/60 AS minutos_restantes
     FROM mxm_tokens
     WHERE refresh_token IS NOT NULL
       AND expires_at < NOW() + ($1 || ' minutes')::interval
       AND renovando = FALSE
     ORDER BY expires_at`,
    [buffer]
  )

  if (usuarios.length === 0) return { procesados: 0, renovados: 0, fallidos: 0, omitidos: 0 }

  log.mxm.info({ count: usuarios.length, buffer }, `🔄 Iniciando renovación proactiva de ${usuarios.length} tokens MxM`)

  let renovados = 0; let fallidos = 0; let omitidos = 0

  for (const u of usuarios) {
    // Marcar como "renovando" para evitar dobles procesados
    const marcado = await query(
      `UPDATE mxm_tokens SET renovando=TRUE WHERE usuario_id=$1 AND NOT renovando RETURNING usuario_id`,
      [u.usuario_id]
    )
    if (marcado.length === 0) { omitidos++; continue }

    try {
      const result = await getAccessTokenConRenovacion(u.usuario_id)
      if (result.renovado) renovados++
      else if (result.token) omitidos++   // ya fue renovado por otro proceso
      else fallidos++
    } catch (err) {
      log.mxm.error({ userId: u.usuario_id.slice(0, 8), err: (err as Error).message }, 'Error renovando token')
      fallidos++
    } finally {
      await query(`UPDATE mxm_tokens SET renovando=FALSE WHERE usuario_id=$1`, [u.usuario_id]).catch(() => {})
    }
  }

  log.mxm.info({ procesados: usuarios.length, renovados, fallidos, omitidos },
    `✓ Renovación proactiva: ${renovados} renovados, ${fallidos} fallidos, ${omitidos} omitidos`)

  return { procesados: usuarios.length, renovados, fallidos, omitidos }
}

// ══════════════════════════════════════════════════════════
// INVALIDAR TOKEN (logout, desconexión, sospecha)
// ══════════════════════════════════════════════════════════

export async function invalidarToken(userId: string, motivo?: string): Promise<void> {
  const redis = getRedis()
  await Promise.all([
    redis.del(cacheKey(userId)),
    redis.del(lockKey(userId)),
    query(
      `UPDATE mxm_tokens SET
         access_token   = '',
         refresh_token  = NULL,
         expires_at     = NOW() - INTERVAL '1 second',
         actualizado_en = NOW()
       WHERE usuario_id = $1`,
      [userId]
    ),
  ])
  await query(
    `INSERT INTO mxm_token_renovaciones (usuario_id, resultado, error_msg)
     VALUES ($1,'OMITIDO',$2)`,
    [userId, motivo ? `Invalidado: ${motivo}` : 'Invalidado manualmente']
  ).catch(() => {})
  log.mxm.info({ userId: userId.slice(0, 8), motivo }, '🗑 Token MxM invalidado')
}

// ══════════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════════

export async function getEstadoTokens(): Promise<{
  total:       number
  vigentes:    number
  porVencer:   number  // < BUFFER_MIN minutos
  expirados:   number
  sinToken:    number
}> {
  const row = await queryOne<{ total: string; vig: string; prox: string; exp: string; sin: string }>(
    `SELECT
       (SELECT COUNT(*) FROM usuarios WHERE mxm_verificado)::text AS total,
       COUNT(*) FILTER (WHERE expires_at > NOW() + ($1||' minutes')::interval)::text AS vig,
       COUNT(*) FILTER (WHERE expires_at > NOW() AND expires_at <= NOW() + ($1||' minutes')::interval)::text AS prox,
       COUNT(*) FILTER (WHERE expires_at <= NOW())::text AS exp,
       (SELECT COUNT(*) FROM usuarios WHERE mxm_verificado) - COUNT(*)::int AS sin
     FROM mxm_tokens`,
    [BUFFER_MIN]
  )
  return {
    total:     parseInt(row?.total ?? '0'),
    vigentes:  parseInt(row?.vig   ?? '0'),
    porVencer: parseInt(row?.prox  ?? '0'),
    expirados: parseInt(row?.exp   ?? '0'),
    sinToken:  parseInt(row?.sin   ?? '0'),
  }
}

export async function getHistorialRenovaciones(userId: string, limit = 20) {
  return query(
    `SELECT id, resultado, error_msg, access_expira_en, intentos, registrado_en
     FROM mxm_token_renovaciones WHERE usuario_id=$1 ORDER BY registrado_en DESC LIMIT $2`,
    [userId, limit]
  )
}

export async function getEstadisticasRenovaciones(horas = 24): Promise<{
  ok: number; fallido: number; omitido: number; tasaExito: number
}> {
  const row = await queryOne<{ ok: string; fall: string; omit: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE resultado='OK')::text      AS ok,
       COUNT(*) FILTER (WHERE resultado='FALLIDO')::text AS fall,
       COUNT(*) FILTER (WHERE resultado='OMITIDO')::text AS omit
     FROM mxm_token_renovaciones
     WHERE registrado_en > NOW() - ($1||' hours')::interval`,
    [horas]
  )
  const ok   = parseInt(row?.ok   ?? '0')
  const fall = parseInt(row?.fall ?? '0')
  const total = ok + fall
  return { ok, fallido: fall, omitido: parseInt(row?.omit ?? '0'), tasaExito: total > 0 ? Math.round(ok / total * 100) : 100 }
}
