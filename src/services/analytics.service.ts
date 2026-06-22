// ─── RODAID · Analytics Service — Historial Anónimo ──────
// Genera métricas de analítica del verificador público sin
// almacenar datos personales (IPs hasheadas con salt diario).
//
// Privacidad by design:
//   · IPs → SHA-256(ip + fecha_utc + ANALYTICS_IP_SALT)[:16]
//   · Salt cambia diariamente → imposible correlacionar entre días
//   · User-agent almacenado solo para detectar bots (se descarta)
//   · Nunca se almacena la IP cruda
//
// Datos disponibles para analítica:
//   · Total de verificaciones / por día / hora
//   · Seriales más consultados (sin propietario, solo serial)
//   · Tasa de acierto (encontrado/no encontrado)
//   · Performance (ms promedio, p95, p99)
//   · Distribución por origen (API, WEB, APP, QR, SCANNER)
//   · Usuarios únicos estimados (IPs únicas hasheadas)
//   · Detección de bots (excluidos de métricas reales)
//   · Tendencias horarias y semanales

import { query, queryOne } from '../config/database'
import { getRedis }         from '../config/redis'
import { log }              from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface ResumenPeriodo {
  periodo:          string     // '7d' | '30d' | 'hoy'
  desde:            Date
  hasta:            Date
  // Volumen
  totalVerif:       number
  unicosEstimados:  number     // IPs únicas hasheadas (aprox. usuarios únicos)
  sinBots:          number     // total excluyendo bots
  // Resultados
  encontrados:      number
  noEncontrados:    number
  tasaAcierto:      number     // %
  desdeCache:       number
  tasaCache:        number     // %
  // Performance
  msProm:           number
  msP95:            number
  msP99:            number
  // Por origen
  porOrigen:        Record<string, number>
  // Por estado del CIT
  porEstado:        Record<string, number>
  // Top seriales consultados
  topSeriales:      Array<{ serial: string; consultas: number; ultimaConsulta: Date }>
  // Por hora del día (0-23) — promedio de los últimos días
  distribHoraria:   Array<{ hora: number; consultas: number }>
}

export interface TendenciaDiaria {
  fecha:       Date
  total:       number
  encontrados: number
  unicos:      number
  msProm:      number
  cacheRate:   number
}

export interface SerialPopular {
  serial:         string
  numeroCIT?:     string
  estadoCIT?:     string
  consultas:      number
  ultimaConsulta: Date
  tendencia:      'SUBIENDO' | 'BAJANDO' | 'ESTABLE'  // vs semana anterior
}

// ══════════════════════════════════════════════════════════
// CACHÉ DE ANALYTICS (5 min para no saturar DB)
// ══════════════════════════════════════════════════════════

const CACHE_TTL = 300

async function getCached<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedis()
    const raw   = await redis.get(`analytics:${key}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

async function setCache(key: string, data: unknown): Promise<void> {
  try {
    const redis = getRedis()
    await redis.set(`analytics:${key}`, JSON.stringify(data), 'EX', CACHE_TTL)
  } catch { /* best-effort */ }
}

// ══════════════════════════════════════════════════════════
// RESUMEN DEL PERÍODO
// ══════════════════════════════════════════════════════════

export async function getResumenPeriodo(
  dias: 1 | 7 | 30 = 7
): Promise<ResumenPeriodo> {
  const cacheKey = `resumen:${dias}d`
  const cached = await getCached<ResumenPeriodo>(cacheKey)
  if (cached) return cached

  const desde = new Date(Date.now() - dias * 86400_000)
  const hasta = new Date()

  // ── Métricas globales ─────────────────────────────────────
  const [totales, porOrigen, porEstado, perf] = await Promise.all([
    queryOne<{
      total: string; encontrados: string; no_encontrados: string
      desde_cache: string; bots: string; unicos: string
    }>(
      `SELECT
         COUNT(*)::text                                                     AS total,
         COUNT(*) FILTER (WHERE encontrado AND NOT es_bot)::text          AS encontrados,
         COUNT(*) FILTER (WHERE NOT encontrado AND NOT es_bot)::text      AS no_encontrados,
         COUNT(*) FILTER (WHERE from_cache AND NOT es_bot)::text          AS desde_cache,
         COUNT(*) FILTER (WHERE es_bot)::text                             AS bots,
         COUNT(DISTINCT ip_hash) FILTER (WHERE NOT es_bot)::text         AS unicos
       FROM verificaciones_log
       WHERE creado_en >= $1 AND creado_en < $2`,
      [desde, hasta]
    ),
    query<{ origen: string; count: string }>(
      `SELECT origen, COUNT(*)::text AS count
       FROM verificaciones_log
       WHERE creado_en >= $1 AND NOT es_bot
       GROUP BY origen ORDER BY count DESC`,
      [desde]
    ),
    query<{ estado_cit: string; count: string }>(
      `SELECT COALESCE(estado_cit,'DESCONOCIDO') AS estado_cit, COUNT(*)::text AS count
       FROM verificaciones_log
       WHERE creado_en >= $1 AND encontrado AND NOT es_bot
       GROUP BY estado_cit ORDER BY count DESC`,
      [desde]
    ),
    queryOne<{ ms_prom: string; ms_p95: string; ms_p99: string }>(
      `SELECT
         ROUND(AVG(ms))::text          AS ms_prom,
         ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ms))::text AS ms_p95,
         ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ms))::text AS ms_p99
       FROM verificaciones_log
       WHERE creado_en >= $1 AND NOT es_bot AND ms IS NOT NULL`,
      [desde]
    ),
  ])

  // ── Top seriales ──────────────────────────────────────────
  const topSeriales = await query<{
    serial: string; consultas: string; ultima: Date
    numero_cit?: string; estado?: string
  }>(
    `SELECT v.serial, COUNT(*)::text AS consultas, MAX(v.creado_en) AS ultima,
            c.numero_cit, c.estado::text AS estado
     FROM verificaciones_log v
     LEFT JOIN cits c ON c.id = (
       SELECT c2.id FROM cits c2
       JOIN bicicletas b ON b.id=c2.bicicleta_id
       WHERE b.numero_serie=v.serial AND c2.estado='ACTIVO'
       LIMIT 1
     )
     WHERE v.creado_en >= $1 AND v.serial IS NOT NULL AND NOT v.es_bot
     GROUP BY v.serial, c.numero_cit, c.estado
     ORDER BY consultas DESC
     LIMIT 10`,
    [desde]
  )

  // ── Distribución horaria ──────────────────────────────────
  const distribHoraria = await query<{ hora: string; consultas: string }>(
    `SELECT EXTRACT(HOUR FROM creado_en)::text AS hora,
            ROUND(COUNT(*)::numeric / $2)::text AS consultas
     FROM verificaciones_log
     WHERE creado_en >= $1 AND NOT es_bot
     GROUP BY hora ORDER BY hora`,
    [desde, dias]
  )

  const total       = parseInt(totales?.total ?? '0')
  const encontrados = parseInt(totales?.encontrados ?? '0')
  const bots        = parseInt(totales?.bots ?? '0')
  const desdeCache  = parseInt(totales?.desde_cache ?? '0')
  const sinBots     = total - bots

  const result: ResumenPeriodo = {
    periodo:         `${dias}d`,
    desde,
    hasta,
    totalVerif:      total,
    unicosEstimados: parseInt(totales?.unicos ?? '0'),
    sinBots,
    encontrados,
    noEncontrados:   parseInt(totales?.no_encontrados ?? '0'),
    // Note: encontrados + noEncontrados = sinBots (all non-bot requests)
    tasaAcierto:     sinBots > 0 ? Math.round(encontrados / sinBots * 100) : 0,
    desdeCache,
    tasaCache:       sinBots > 0 ? Math.round(desdeCache / sinBots * 100) : 0,
    msProm:          parseFloat(perf?.ms_prom ?? '0'),
    msP95:           parseFloat(perf?.ms_p95 ?? '0'),
    msP99:           parseFloat(perf?.ms_p99 ?? '0'),
    porOrigen:       Object.fromEntries(porOrigen.map(r => [r.origen, parseInt(r.count)])),
    porEstado:       Object.fromEntries(porEstado.map(r => [r.estado_cit, parseInt(r.count)])),
    topSeriales:     topSeriales.map(r => ({
      serial:         r.serial,
      consultas:      parseInt(r.consultas),
      ultimaConsulta: r.ultima,
    })),
    distribHoraria:  distribHoraria.map(r => ({
      hora:      parseInt(r.hora),
      consultas: parseInt(r.consultas),
    })),
  }

  await setCache(cacheKey, result)
  log.analytics.debug({ periodo: `${dias}d`, total }, '✓ Resumen analytics calculado')
  return result
}

// ══════════════════════════════════════════════════════════
// TENDENCIA DIARIA
// ══════════════════════════════════════════════════════════

export async function getTendenciaDiaria(dias = 30): Promise<TendenciaDiaria[]> {
  const cacheKey = `tendencia:${dias}d`
  const cached = await getCached<TendenciaDiaria[]>(cacheKey)
  if (cached) return cached

  const rows = await query<{
    fecha: Date; total: string; encontrados: string
    unicos: string; ms_prom: string; cache_rate: string
  }>(
    `SELECT
       DATE_TRUNC('day', creado_en) AS fecha,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE encontrado)::text AS encontrados,
       COUNT(DISTINCT ip_hash)::text AS unicos,
       ROUND(AVG(ms))::text AS ms_prom,
       ROUND(AVG(CASE WHEN from_cache THEN 100 ELSE 0 END))::text AS cache_rate
     FROM verificaciones_log
     WHERE creado_en >= NOW() - INTERVAL '${dias} days' AND NOT es_bot
     GROUP BY DATE_TRUNC('day', creado_en)
     ORDER BY fecha`,
    []
  )

  const result = rows.map(r => ({
    fecha:       new Date(r.fecha),
    total:       parseInt(r.total),
    encontrados: parseInt(r.encontrados),
    unicos:      parseInt(r.unicos),
    msProm:      parseFloat(r.ms_prom),
    cacheRate:   parseFloat(r.cache_rate),
  }))

  await setCache(cacheKey, result)
  return result
}

// ══════════════════════════════════════════════════════════
// SERIALES POPULARES CON TENDENCIA
// ══════════════════════════════════════════════════════════

export async function getSerialPopular(limit = 20): Promise<SerialPopular[]> {
  const cacheKey = `seriales:top${limit}`
  const cached = await getCached<SerialPopular[]>(cacheKey)
  if (cached) return cached

  // Consultas esta semana vs semana anterior
  const rows = await query<{
    serial: string; consultas_7d: string; consultas_prev: string
    ultima: Date; numero_cit?: string; estado?: string
  }>(
    `WITH esta_semana AS (
       SELECT serial, COUNT(*) AS n FROM verificaciones_log
       WHERE creado_en >= NOW()-INTERVAL '7 days' AND serial IS NOT NULL AND NOT es_bot
       GROUP BY serial
     ),
     semana_prev AS (
       SELECT serial, COUNT(*) AS n FROM verificaciones_log
       WHERE creado_en >= NOW()-INTERVAL '14 days' AND creado_en < NOW()-INTERVAL '7 days'
             AND serial IS NOT NULL AND NOT es_bot
       GROUP BY serial
     )
     SELECT
       e.serial,
       e.n::text AS consultas_7d,
       COALESCE(p.n,0)::text AS consultas_prev,
       MAX(v.creado_en) AS ultima,
       c.numero_cit,
       c.estado::text AS estado
     FROM esta_semana e
     LEFT JOIN semana_prev p USING(serial)
     LEFT JOIN verificaciones_log v ON v.serial=e.serial AND v.creado_en >= NOW()-INTERVAL '7 days'
     LEFT JOIN cits c ON c.id = (
       SELECT c2.id FROM cits c2 JOIN bicicletas b ON b.id=c2.bicicleta_id
       WHERE b.numero_serie=e.serial ORDER BY c2.creado_en DESC LIMIT 1
     )
     GROUP BY e.serial,e.n,p.n,c.numero_cit,c.estado
     ORDER BY e.n DESC LIMIT $1`,
    [limit]
  )

  const result: SerialPopular[] = rows.map(r => {
    const actual = parseInt(r.consultas_7d)
    const prev   = parseInt(r.consultas_prev)
    const delta  = actual - prev
    const tendencia: SerialPopular['tendencia'] = delta > 2 ? 'SUBIENDO' : delta < -2 ? 'BAJANDO' : 'ESTABLE'
    return {
      serial:         r.serial,
      numeroCIT:      r.numero_cit ?? undefined,
      estadoCIT:      r.estado ?? undefined,
      consultas:      actual,
      ultimaConsulta: new Date(r.ultima),
      tendencia,
    }
  })

  await setCache(cacheKey, result)
  return result
}

// ══════════════════════════════════════════════════════════
// MÉTRICAS EN TIEMPO REAL (últimos 60 min, sin caché)
// ══════════════════════════════════════════════════════════

export async function getMetricasRealtime() {
  const [ultima_hora, ultimo_min] = await Promise.all([
    queryOne<{ total: string; cache_rate: string; ms_prom: string }>(
      `SELECT COUNT(*)::text AS total,
              ROUND(AVG(CASE WHEN from_cache THEN 100 ELSE 0 END))::text AS cache_rate,
              ROUND(AVG(ms))::text AS ms_prom
       FROM verificaciones_log WHERE creado_en > NOW()-INTERVAL '1 hour' AND NOT es_bot`,
      []
    ),
    queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM verificaciones_log WHERE creado_en > NOW()-INTERVAL '1 minute' AND NOT es_bot`,
      []
    ),
  ])

  return {
    ultima_hora: {
      total:    parseInt(ultima_hora?.total ?? '0'),
      cacheRate: parseFloat(ultima_hora?.cache_rate ?? '0'),
      msProm:   parseFloat(ultima_hora?.ms_prom ?? '0'),
    },
    rpm: parseInt(ultimo_min?.total ?? '0'),    // requests per minute
    timestamp: new Date().toISOString(),
  }
}

// ══════════════════════════════════════════════════════════
// INVALIDAR CACHÉ DE ANALYTICS
// ══════════════════════════════════════════════════════════

export async function invalidarCacheAnalytics(): Promise<void> {
  try {
    const redis = getRedis()
    const keys  = await redis.keys('analytics:*')
    if (keys.length > 0) await redis.del(...keys)
    log.analytics.info({ keys: keys.length }, '✓ Caché analytics invalidado')
  } catch { /* best-effort */ }
}
