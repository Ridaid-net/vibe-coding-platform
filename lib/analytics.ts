// ─── RODAID · Analítica de verificaciones (privacy by design) ─────────────
//
// Historial anónimo de consultas al Verificador Público. Cada verificación se
// registra en Netlify Database (Postgres) SIN almacenar la IP cruda: sólo un
// hash con **salt diario**, que impide reconstruir la IP y correlacionar la
// actividad entre días distintos.
//
// Esta capa también corrige el bug histórico de la *tasa de acierto*: el
// tráfico de bots se detecta por user-agent y se excluye de forma CONSISTENTE
// de todas las métricas humanas (numerador y denominador), de modo que
// `tasaAcierto` nunca puede superar el 100%.
//
// Diseño resiliente: el registro es best-effort. Si la base no está disponible,
// `registrarVerificacion` degrada en silencio y NUNCA rompe el verificador
// público (el logging jamás está en el camino crítico de la respuesta).

import { createHash } from 'node:crypto'
import { getDb } from '@/db'
import { extraerIP } from '@/lib/rateLimiter'

// ── Orígenes de tráfico válidos ────────────────────────────────────────────

export type OrigenTrafico = 'WEB' | 'QR' | 'APP' | 'API'
const ORIGENES: readonly OrigenTrafico[] = ['WEB', 'QR', 'APP', 'API']

/** Normaliza el origen declarado (?origen=) a uno de los valores canónicos. */
export function normalizarOrigen(raw: string | null | undefined): OrigenTrafico {
  const v = String(raw ?? '').trim().toUpperCase()
  return (ORIGENES as readonly string[]).includes(v) ? (v as OrigenTrafico) : 'WEB'
}

// ── Hash de IP con salt diario ─────────────────────────────────────────────
//
// hashIP(ip) = SHA256(`${ip}:${YYYY-MM-DD}:${salt}`).slice(0,16)
//
// · El salt diario (fecha del día) garantiza que el mismo visitante reciba un
//   hash distinto cada día → no se puede correlacionar su actividad histórica.
// · ANALYTICS_IP_SALT es un secreto rotable: con un salt secreto, el hash no se
//   puede revertir por fuerza bruta del espacio de IPs. Conviene definirlo y
//   rotarlo periódicamente en producción.

const SALT_POR_DEFECTO = 'rodaid-analytics-2026'

function saltActual(): string {
  return process.env.ANALYTICS_IP_SALT || SALT_POR_DEFECTO
}

/**
 * Deriva el hash anónimo de una IP para una fecha dada. Devuelve null cuando la
 * IP no es identificable (no se registra un hash falso). La IP cruda nunca sale
 * de esta función.
 */
export function hashIP(ip: string, ahora: number): string | null {
  if (!ip || ip === 'desconocida') return null
  const dia = new Date(ahora).toISOString().slice(0, 10) // 'YYYY-MM-DD'
  return createHash('sha256')
    .update(`${ip}:${dia}:${saltActual()}`)
    .digest('hex')
    .slice(0, 16)
}

// ── Detección de bots por user-agent ───────────────────────────────────────
//
// Tráfico automatizado conocido: crawlers, librerías HTTP y herramientas CLI.
// Un bot se EXCLUYE de las métricas humanas, pero se cuenta en el total bruto
// (transparencia del tráfico real).

const BOT_UA =
  /bot|crawl|spider|curl|wget|python-|go-http|java\/|axios|node-fetch|okhttp|libwww|scrapy|httpclient|headless|postman|googlebot|bingbot|yandex|baidu|slurp/i

/** true si el user-agent corresponde a tráfico automatizado conocido. */
export function esBot(userAgent: string | null | undefined): boolean {
  const ua = String(userAgent ?? '').trim()
  if (!ua) return true // sin user-agent → se trata como bot (cliente no-navegador).
  return BOT_UA.test(ua)
}

// ── Registro de una verificación (anónimo, best-effort) ────────────────────

export interface DatosVerificacion {
  serial: string
  estado: string
  encontrado: boolean
  origen: OrigenTrafico
  duracionMs: number
}

/**
 * Registra una consulta del verificador de forma anónima. Deriva el hash de IP
 * y la marca de bot a partir de la petición; la IP cruda nunca se persiste.
 *
 * Fail-open: cualquier error (base no disponible, etc.) se traga y se loguea;
 * el verificador público no debe verse afectado por la analítica.
 */
export async function registrarVerificacion(
  req: Request,
  datos: DatosVerificacion
): Promise<void> {
  try {
    const ahora = Date.now()
    const ipHash = hashIP(extraerIP(req), ahora)
    const bot = esBot(req.headers.get('user-agent'))

    const db = getDb()
    await db.sql`
      INSERT INTO verificaciones_log
        (serial, estado, encontrado, origen, ip_hash, es_bot, duracion_ms)
      VALUES
        (${datos.serial}, ${datos.estado}, ${datos.encontrado}, ${datos.origen},
         ${ipHash}, ${bot}, ${datos.duracionMs})
    `
  } catch (err) {
    console.error('[analytics] registro best-effort falló (ignorado)', err)
  }
}

// ── Resumen del período ────────────────────────────────────────────────────

export interface ResumenPeriodo {
  dias: number
  totalVerif: number // todo el tráfico (incluye bots)
  sinBots: number // sólo humanos
  unicosEstimados: number // IPs únicas hasheadas (sin bots)
  encontrados: number // CITs encontrados (sin bots)
  tasaAcierto: number // % — encontrados / sinBots, NUNCA > 100
  msProm: number
  msP95: number
  msP99: number
  porOrigen: Record<string, number>
  porEstado: Record<string, number>
  topSeriales: Array<{ serial: string; consultas: number }>
}

function n(v: unknown): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

const DIAS_VALIDOS = new Set([1, 7, 30])

/** Normaliza el parámetro ?dias= a uno de los períodos soportados (1/7/30). */
export function normalizarDias(raw: string | null | undefined): number {
  const d = Number.parseInt(String(raw ?? ''), 10)
  return DIAS_VALIDOS.has(d) ? d : 7
}

/**
 * Calcula el resumen de analítica de los últimos `dias`.
 *
 * CLAVE — corrección del bug de tasaAcierto: TODAS las métricas humanas
 * (sinBots, encontrados, unicosEstimados, porOrigen, porEstado, topSeriales)
 * aplican el MISMO filtro `NOT es_bot`. Antes, `encontrados` contaba bots y
 * `sinBots` no, lo que producía cocientes > 100% (p. ej. 11/10 = 110%).
 */
export async function resumenPeriodo(
  dias: number,
  topLimit = 10
): Promise<ResumenPeriodo> {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
  const db = getDb()

  const [agg] = await db.sql`
    SELECT
      COUNT(*)::int                                          AS total_verif,
      COUNT(*) FILTER (WHERE NOT es_bot)::int                AS sin_bots,
      COUNT(*) FILTER (WHERE encontrado AND NOT es_bot)::int AS encontrados,
      COUNT(DISTINCT ip_hash) FILTER (WHERE NOT es_bot)::int AS unicos_estimados,
      COALESCE(ROUND(AVG(duracion_ms) FILTER (WHERE NOT es_bot))::int, 0) AS ms_prom,
      COALESCE(
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duracion_ms)
          FILTER (WHERE NOT es_bot), 0)::int                 AS ms_p95,
      COALESCE(
        percentile_cont(0.99) WITHIN GROUP (ORDER BY duracion_ms)
          FILTER (WHERE NOT es_bot), 0)::int                 AS ms_p99
    FROM verificaciones_log
    WHERE creado_en >= ${desde}::timestamptz
  `

  const filasOrigen = await db.sql`
    SELECT origen, COUNT(*)::int AS n
    FROM verificaciones_log
    WHERE creado_en >= ${desde}::timestamptz AND NOT es_bot
    GROUP BY origen
  `

  const filasEstado = await db.sql`
    SELECT estado, COUNT(*)::int AS n
    FROM verificaciones_log
    WHERE creado_en >= ${desde}::timestamptz AND NOT es_bot
    GROUP BY estado
  `

  const filasTop = await db.sql`
    SELECT serial, COUNT(*)::int AS consultas
    FROM verificaciones_log
    WHERE creado_en >= ${desde}::timestamptz AND NOT es_bot
    GROUP BY serial
    ORDER BY consultas DESC, serial ASC
    LIMIT ${topLimit}
  `

  const sinBots = n(agg?.sin_bots)
  const encontrados = n(agg?.encontrados)
  // El cociente sólo puede ser ≤ 100 porque numerador y denominador comparten
  // exactamente el filtro `NOT es_bot`.
  const tasaAcierto = sinBots > 0 ? Math.round((encontrados / sinBots) * 100) : 0

  const porOrigen: Record<string, number> = {}
  for (const f of filasOrigen) porOrigen[String(f.origen)] = n(f.n)

  const porEstado: Record<string, number> = {}
  for (const f of filasEstado) porEstado[String(f.estado)] = n(f.n)

  return {
    dias,
    totalVerif: n(agg?.total_verif),
    sinBots,
    unicosEstimados: n(agg?.unicos_estimados),
    encontrados,
    tasaAcierto,
    msProm: n(agg?.ms_prom),
    msP95: n(agg?.ms_p95),
    msP99: n(agg?.ms_p99),
    porOrigen,
    porEstado,
    topSeriales: filasTop.map((f) => ({
      serial: String(f.serial),
      consultas: n(f.consultas),
    })),
  }
}
