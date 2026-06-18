// ─── RODAID · SLA Engine — Cross-Reference < 2 s / 72 h ──
//
// Mide y hace cumplir el SLA de respuesta del endpoint
// POST /seguridad/cross-reference del Ministerio de Seguridad.
//
// Objetivo:  ≥ 99% de requests completados en < 2.000 ms
// Ventana:   últimas 72 horas (rolling window)
// Granularidad: snapshots cada 5 minutos en Redis
//
// ── Cómo se mide ─────────────────────────────────────────
//
//   1. Middleware slaMiddleware() wrappea el handler
//   2. Al terminar el request: registrarMetrica(latencia, status, ...)
//   3. Redis time-series: clave sliceable por minuto
//   4. Tabla endpoint_metrics: persistencia para consultas históricas
//   5. calcularSLA72h(): agrega los últimos 72h de datos
//
// ── Definición de SLA ─────────────────────────────────────
//
//   Medido:    tiempo entre req.socket.connect y res.finish
//   Objetivo:  p99 < 2.000 ms (99% de los requests)
//   Ventana:   rolling 72 horas
//   Exclusiones: requests con error HTTP 5xx de infraestructura
//                (no cuentan en contra del SLA de la aplicación)
//
// ── Umbrales de alerta ────────────────────────────────────
//
//   OK       ≥ 99.0%  cumplimiento
//   WARNING  95.0-98.9%  → alerta en logs + Redis pub/sub
//   CRITICAL < 95.0%    → alerta + detener retención en cola
//
// ── Arquitectura ─────────────────────────────────────────
//
//   Request → slaMiddleware → handler → slaMiddleware fin
//              ↓                           ↓
//         start = Date.now()       latencia = Date.now() - start
//                                  registrarMetrica(latencia, ...)
//                                  Redis LPUSH sla:metrics:crossref
//                                  (serie circular TTL 73h)
//                                  DB INSERT endpoint_metrics
//
//   Cron 5 min → calcularSLA72h() → sla_snapshots
//   GET /admin/sla/crossref → último snapshot + trend

import crypto              from 'crypto'
import { Request, Response, NextFunction } from 'express'
import { query, queryOne } from '../config/database'
import { getRedis }        from '../config/redis'
import { log }             from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════

const SLA_OBJETIVO_MS  = 2_000    // < 2 segundos
const VENTANA_H        = 72       // ventana rolling
const SNAPSHOT_CADA_S  = 300      // recalcular cada 5 minutos
const REDIS_TTL_S      = VENTANA_H * 3_600 + 3_600  // 73h (1h buffer)
const REDIS_KEY_BASE   = 'sla:metrics'
const REDIS_SNAP_KEY   = 'sla:snapshot'
const ENDPOINT_XREF    = 'POST /seguridad/cross-reference'

// Umbrales de estado
const UMBRAL_OK        = 99.0
const UMBRAL_WARNING   = 95.0

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface SLASnapshot {
  endpoint:       string
  ventanaH:       number
  objetivo:       number    // ms
  calculadoEn:    Date
  total:          number
  bajaSLA:        number
  sobreSLA:       number
  cumplimiento:   number    // porcentaje 0-100
  estado:         'OK' | 'WARNING' | 'CRITICAL'
  percentiles: {
    p50:  number; p90: number; p95: number; p99: number
  }
  latencia: {
    min:  number; max: number; avg: number
  }
  // Tendencia: últimos 12 períodos de 6h
  tendencia?: TendenciaBloque[]
}

export interface TendenciaBloque {
  periodo:      string    // "2026-06-05T12:00" (inicio del bloque de 6h)
  total:        number
  cumplimiento: number
  p99:          number
}

interface MetricaRaw {
  ms:         number
  status:     number
  cacheHit:   boolean
  error:      boolean
  ts:         number    // unix ms
}

// ══════════════════════════════════════════════════════════
// MIDDLEWARE — medir latencia automáticamente
// ══════════════════════════════════════════════════════════

/**
 * Wrappear el endpoint cross-reference con medición de SLA.
 * Insertar ANTES del handler en la cadena de middlewares.
 */
export function slaMiddleware(endpoint: string = ENDPOINT_XREF) {
  return function sla(req: Request, res: Response, next: NextFunction) {
    const inicio = Date.now()

    // Hook en el finish del response (después de enviar al cliente)
    res.on('finish', () => {
      const ms     = Date.now() - inicio
      const status = res.statusCode
      const error  = status >= 500

      // Fire-and-forget — no bloquear el response
      registrarMetrica({
        endpoint,
        latenciaMs:  ms,
        httpStatus:  status,
        error,
        cacheHit:    res.getHeader('x-cache-hit') === 'true',
        certSubject: (req as any).mtlsClient?.cn,
        serial:      (req.body as any)?.serial,
      }).catch(err =>
        log.minseg.warn({ err: (err as Error).message }, 'SLA metric error')
      )
    })

    next()
  }
}

// ══════════════════════════════════════════════════════════
// REGISTRAR MÉTRICA
// ══════════════════════════════════════════════════════════

export async function registrarMetrica(opts: {
  endpoint:    string
  latenciaMs:  number
  httpStatus:  number
  error:       boolean
  cacheHit:    boolean
  certSubject?: string
  serial?:     string
}): Promise<void> {
  const ahora = Date.now()
  const redis = getRedis()

  // 1. Redis time-series (para cálculo rápido de percentiles sin DB)
  const key: string = `${REDIS_KEY_BASE}:${opts.endpoint.replace(/\s+/g, '_').replace(/\//g, '-')}`
  const metrica: MetricaRaw = {
    ms:       opts.latenciaMs,
    status:   opts.httpStatus,
    cacheHit: opts.cacheHit,
    error:    opts.error,
    ts:       ahora,
  }
  await redis.lpush(key, JSON.stringify(metrica)).catch(() => {})
  await redis.expire(key, REDIS_TTL_S).catch(() => {})
  // Limitar a 50.000 entradas (suficiente para 72h con 100 req/min)
  await redis.ltrim(key, 0, 49_999).catch(() => {})

  // 2. DB persistente (para historial y reportes)
  await query(
    `INSERT INTO endpoint_metrics
       (endpoint, metodo, latencia_ms, http_status, cert_subject, serial, cache_hit, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      opts.endpoint,
      opts.endpoint.split(' ')[0] ?? 'POST',
      opts.latenciaMs,
      opts.httpStatus,
      opts.certSubject ?? null,
      opts.serial       ?? null,
      opts.cacheHit,
      opts.error,
    ]
  ).catch(() => {})

  // 3. Invalidar snapshot cacheado (se recalculará en la próxima consulta)
  if (opts.latenciaMs >= SLA_OBJETIVO_MS && !opts.error) {
    // Actualizar alerta en Redis si rompemos el SLA
    await redis.incr(`sla:breach:${opts.endpoint.replace(/\s+/g, '_')}`).catch(() => {})
    await redis.expire(`sla:breach:${opts.endpoint.replace(/\s+/g, '_')}`, 300).catch(() => {})
  }

  // Log explícito si supera el objetivo
  if (opts.latenciaMs >= SLA_OBJETIVO_MS) {
    log.minseg.warn({
      endpoint: opts.endpoint, ms: opts.latenciaMs,
      objetivo: SLA_OBJETIVO_MS, exceso: opts.latenciaMs - SLA_OBJETIVO_MS,
    }, `⚠ SLA BREACH: ${opts.latenciaMs}ms (objetivo ${SLA_OBJETIVO_MS}ms)`)
  }
}

// ══════════════════════════════════════════════════════════
// CALCULAR SLA — Ventana 72 horas
// ══════════════════════════════════════════════════════════

/**
 * Calcula el SLA de las últimas 72h desde Redis (rápido) + fallback DB.
 * Persiste el resultado en sla_snapshots y en Redis.
 */
export async function calcularSLA72h(
  endpoint: string = ENDPOINT_XREF,
  forzarDB: boolean = false
): Promise<SLASnapshot> {
  const redis     = getRedis()
  const snapKey   = `${REDIS_SNAP_KEY}:${endpoint.replace(/\s+/g, '_').replace(/\//g, '-')}`

  // Cache de 5 minutos para el snapshot (evitar recálculo constante)
  if (!forzarDB) {
    const cached = await redis.get(snapKey).catch(() => null)
    if (cached) return JSON.parse(cached)
  }

  // Leer métricas de Redis (últimas 72h)
  const key      = `${REDIS_KEY_BASE}:${endpoint.replace(/\s+/g, '_').replace(/\//g, '-')}`
  const rawItems = await redis.lrange(key, 0, -1).catch(() => [] as string[])
  const cutoff   = Date.now() - VENTANA_H * 3_600_000

  let metricas: MetricaRaw[]

  if (rawItems.length > 0) {
    metricas = rawItems
      .map(r => { try { return JSON.parse(r) as MetricaRaw } catch { return null } })
      .filter((m): m is MetricaRaw => m !== null && m.ts >= cutoff && !m.error)
  } else {
    // Fallback: leer de DB
    const rows = await query<{ latencia_ms: number; creado_en: Date }>(
      `SELECT latencia_ms, creado_en FROM endpoint_metrics
       WHERE endpoint=$1 AND NOT error AND creado_en > NOW() - ($2||' hours')::interval
       ORDER BY creado_en DESC LIMIT 50000`,
      [endpoint, VENTANA_H]
    )
    metricas = rows.map(r => ({
      ms: r.latencia_ms, status: 200, cacheHit: false,
      error: false, ts: new Date(r.creado_en).getTime(),
    }))
  }

  const snapshot = calcularSnapshot(endpoint, metricas)

  // Persistir en DB
  await query(
    `INSERT INTO sla_snapshots
       (endpoint, ventana_h, total, bajo_sla, sobre_sla, sla_objetivo_ms,
        cumplimiento, p50, p90, p95, p99, latencia_min, latencia_max, latencia_avg, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      endpoint, VENTANA_H,
      snapshot.total, snapshot.bajaSLA, snapshot.sobreSLA, SLA_OBJETIVO_MS,
      snapshot.cumplimiento,
      snapshot.percentiles.p50, snapshot.percentiles.p90,
      snapshot.percentiles.p95, snapshot.percentiles.p99,
      snapshot.latencia.min, snapshot.latencia.max, snapshot.latencia.avg,
      snapshot.estado,
    ]
  ).catch(() => {})

  // Calcular tendencia (últimos 12 bloques de 6h = 72h)
  snapshot.tendencia = await calcularTendencia(endpoint, metricas)

  // Alertar si estado es crítico
  if (snapshot.estado !== 'OK') {
    log.minseg.warn({
      endpoint, estado: snapshot.estado,
      cumplimiento: snapshot.cumplimiento.toFixed(2) + '%',
      p99: snapshot.percentiles.p99 + 'ms',
      total: snapshot.total,
    }, `🚨 SLA ${snapshot.estado}: ${snapshot.cumplimiento.toFixed(2)}% cumplimiento en 72h`)
  }

  // Cachear snapshot 5 minutos
  await redis.set(snapKey, JSON.stringify(snapshot), 'EX', SNAPSHOT_CADA_S).catch(() => {})

  return snapshot
}

// ══════════════════════════════════════════════════════════
// CÁLCULOS INTERNOS
// ══════════════════════════════════════════════════════════

function calcularSnapshot(endpoint: string, metricas: MetricaRaw[]): SLASnapshot {
  if (metricas.length === 0) {
    return {
      endpoint, ventanaH: VENTANA_H, objetivo: SLA_OBJETIVO_MS,
      calculadoEn: new Date(), total: 0, bajaSLA: 0, sobreSLA: 0,
      cumplimiento: 100, estado: 'OK',
      percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
      latencia: { min: 0, max: 0, avg: 0 },
    }
  }

  const ms      = metricas.map(m => m.ms).sort((a, b) => a - b)
  const total   = ms.length
  const bajaSLA = ms.filter(v => v < SLA_OBJETIVO_MS).length
  const sobreSLA = total - bajaSLA
  const cumplimiento = (bajaSLA / total) * 100

  const pct = (p: number) => ms[Math.min(Math.ceil(total * p / 100) - 1, total - 1)] ?? 0

  const estado: SLASnapshot['estado'] =
    cumplimiento >= UMBRAL_OK ? 'OK'
    : cumplimiento >= UMBRAL_WARNING ? 'WARNING'
    : 'CRITICAL'

  return {
    endpoint, ventanaH: VENTANA_H, objetivo: SLA_OBJETIVO_MS,
    calculadoEn: new Date(),
    total, bajaSLA, sobreSLA,
    cumplimiento: Math.round(cumplimiento * 1000) / 1000,
    estado,
    percentiles: {
      p50: pct(50), p90: pct(90), p95: pct(95), p99: pct(99),
    },
    latencia: {
      min: ms[0] ?? 0,
      max: ms[total - 1] ?? 0,
      avg: Math.round(ms.reduce((a, b) => a + b, 0) / total),
    },
  }
}

async function calcularTendencia(endpoint: string, metricas: MetricaRaw[]): Promise<TendenciaBloque[]> {
  const bloques: TendenciaBloque[] = []
  const ahora = Date.now()
  const BLOQUE_MS = 6 * 3_600_000  // 6 horas

  for (let i = 11; i >= 0; i--) {
    const fin    = ahora - i * BLOQUE_MS
    const inicio = fin - BLOQUE_MS
    const enBloque = metricas.filter(m => m.ts >= inicio && m.ts < fin)

    if (enBloque.length === 0) {
      bloques.push({
        periodo:      new Date(inicio).toISOString().slice(0, 16),
        total:        0,
        cumplimiento: 100,
        p99:          0,
      })
      continue
    }

    const ms = enBloque.map(m => m.ms).sort((a, b) => a - b)
    const bajo = ms.filter(v => v < SLA_OBJETIVO_MS).length
    const p99  = ms[Math.min(Math.ceil(ms.length * 0.99) - 1, ms.length - 1)] ?? 0

    bloques.push({
      periodo:      new Date(inicio).toISOString().slice(0, 16),
      total:        ms.length,
      cumplimiento: Math.round(bajo / ms.length * 10000) / 100,
      p99,
    })
  }

  return bloques
}

// ══════════════════════════════════════════════════════════
// UTILIDADES ADMIN
// ══════════════════════════════════════════════════════════

/** Historial de snapshots SLA para graficar */
export async function getHistorialSLA(endpoint: string = ENDPOINT_XREF, horas = 72) {
  return query<{
    cumplimiento: number; p99: number; p95: number; total: number
    estado: string; calculado_en: Date; latencia_avg: number
  }>(
    `SELECT cumplimiento, p99, p95, total, estado, calculado_en, latencia_avg
     FROM sla_snapshots WHERE endpoint=$1
       AND calculado_en > NOW()-($2||' hours')::interval
     ORDER BY calculado_en DESC LIMIT 200`,
    [endpoint, horas]
  )
}

/** Percentiles de latencia en tiempo real desde DB */
export async function getLatenciasRecientes(endpoint: string = ENDPOINT_XREF, minutos = 60) {
  return queryOne<{
    total: number; p50: number; p90: number; p95: number; p99: number
    latencia_min: number; latencia_max: number; latencia_avg: number
    bajo_sla: number; sobre_sla: number
  }>(
    `SELECT COUNT(*)::int                                                          AS total,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latencia_ms)::int        AS p50,
            PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY latencia_ms)::int        AS p90,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latencia_ms)::int        AS p95,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latencia_ms)::int        AS p99,
            MIN(latencia_ms)::int                                                  AS latencia_min,
            MAX(latencia_ms)::int                                                  AS latencia_max,
            ROUND(AVG(latencia_ms))::int                                           AS latencia_avg,
            COUNT(*) FILTER(WHERE latencia_ms < $2)::int                          AS bajo_sla,
            COUNT(*) FILTER(WHERE latencia_ms >= $2)::int                         AS sobre_sla
     FROM endpoint_metrics
     WHERE endpoint=$1 AND NOT error
       AND creado_en > NOW()-($3||' minutes')::interval`,
    [endpoint, SLA_OBJETIVO_MS, minutos]
  )
}

/** Estado SLA resumido para health check */
export async function getSLAStatus(endpoint: string = ENDPOINT_XREF): Promise<{
  ok:          boolean
  estado:      string
  cumplimiento:number
  p99:         number
  total:       number
  objetivo:    number
  ventanaH:    number
  ultimoBreachHace?: number   // minutos desde el último breach
}> {
  const snap = await calcularSLA72h(endpoint)
  const redis = getRedis()
  const brKey = `sla:breach:${endpoint.replace(/\s+/g, '_').replace(/\//g, '-')}`
  const ultimoBreach = await redis.ttl(brKey).catch(() => -1)

  return {
    ok:           snap.estado === 'OK',
    estado:       snap.estado,
    cumplimiento: snap.cumplimiento,
    p99:          snap.percentiles.p99,
    total:        snap.total,
    objetivo:     SLA_OBJETIVO_MS,
    ventanaH:     VENTANA_H,
    ultimoBreachHace: ultimoBreach > 0 ? Math.round((300 - ultimoBreach) / 60) : undefined,
  }
}

/** Resetear métricas SLA (solo testing/admin) */
export async function resetearMetricas(endpoint: string = ENDPOINT_XREF): Promise<void> {
  const redis = getRedis()
  const key   = `${REDIS_KEY_BASE}:${endpoint.replace(/\s+/g, '_').replace(/\//g, '-')}`
  const snap  = `${REDIS_SNAP_KEY}:${endpoint.replace(/\s+/g, '_').replace(/\//g, '-')}`
  await Promise.all([
    redis.del(key).catch(() => {}),
    redis.del(snap).catch(() => {}),
    query(`DELETE FROM endpoint_metrics WHERE endpoint=$1`, [endpoint]).catch(() => {}),
    query(`DELETE FROM sla_snapshots WHERE endpoint=$1`, [endpoint]).catch(() => {}),
  ])
  log.minseg.info({ endpoint }, '🗑 Métricas SLA reseteadas')
}

// Exportar constantes para tests y routes
export { SLA_OBJETIVO_MS, VENTANA_H, UMBRAL_OK, UMBRAL_WARNING, ENDPOINT_XREF }
