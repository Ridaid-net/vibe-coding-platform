// ─── RODAID · Health Checks & Monitoring ─────────────────
// Endpoints:
//   GET /health           — resumen rápido (UptimeRobot, load balancers)
//   GET /health/live      — liveness: el proceso respira (K8s/ECS)
//   GET /health/ready     — readiness: listo para recibir tráfico
//   GET /health/deep      — diagnóstico completo de todos los subsistemas [Admin]
//   GET /health/metrics   — métricas de proceso para dashboards [Admin]

import { pool } from '../config/database'
import { env } from '../config/env'
import { log } from '../middleware/logger'
import os from 'os'

// ── Tipos ─────────────────────────────────────────────────

export type CheckStatus = 'ok' | 'degraded' | 'down'

export interface CheckResult {
  status:   CheckStatus
  latencyMs?: number
  detail?:  string | Record<string, unknown>
  error?:   string
}

export interface HealthReport {
  status:    CheckStatus    // worst-case compuesto de todos los checks
  version:   string
  uptime:    number         // segundos desde inicio del proceso
  timestamp: string
  checks:    Record<string, CheckResult>
}

// ── Helpers ───────────────────────────────────────────────

function statusFromChecks(checks: Record<string, CheckResult>): CheckStatus {
  const values = Object.values(checks).map(c => c.status)
  if (values.includes('down'))     return 'down'
  if (values.includes('degraded')) return 'degraded'
  return 'ok'
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t = Date.now()
  const result = await fn()
  return { result, ms: Date.now() - t }
}

// ══════════════════════════════════════════════════════════
// CHECKS INDIVIDUALES
// ══════════════════════════════════════════════════════════

// ── PostgreSQL ────────────────────────────────────────────
async function checkPostgres(): Promise<CheckResult> {
  try {
    const { ms } = await timed(async () => {
      const client = await pool.connect()
      try {
        await client.query('SELECT 1')
      } finally {
        client.release()
      }
    })

    // Obtener estadísticas del pool
    const poolStats = {
      total:   (pool as any).totalCount   ?? 0,
      idle:    (pool as any).idleCount    ?? 0,
      waiting: (pool as any).waitingCount ?? 0,
    }

    const status: CheckStatus =
      ms > 2000              ? 'degraded' :
      poolStats.waiting > 5  ? 'degraded' : 'ok'

    return { status, latencyMs: ms, detail: poolStats }
  } catch (err) {
    return { status: 'down', error: (err as Error).message }
  }
}

// ── Redis ─────────────────────────────────────────────────
async function checkRedis(): Promise<CheckResult> {
  try {
    const Redis = require('ioredis')
    const client = new Redis(env.REDIS_URL, {
      lazyConnect:          true,
      maxRetriesPerRequest: 1,
      connectTimeout:       3000,
    })
    await client.connect()

    const { ms } = await timed(async () => client.ping())
    const info    = await client.info('memory').catch(() => '')
    const memMatch = info.match(/used_memory_human:(\S+)/)
    const mem      = memMatch ? memMatch[1] : 'n/d'

    await client.quit().catch(() => {})

    return {
      status: ms > 1000 ? 'degraded' : 'ok',
      latencyMs: ms,
      detail: { usedMemory: mem },
    }
  } catch (err) {
    return { status: 'down', error: (err as Error).message }
  }
}

// ── Bull Queues ───────────────────────────────────────────
async function checkQueues(): Promise<CheckResult> {
  try {
    const { getQueueStats } = await import('./queue.service')
    const { ms, result } = await timed(() => getQueueStats())

    if ((result as any)?.status === 'no_iniciada') {
      return { status: 'degraded', latencyMs: ms, detail: { status: 'no_iniciada' } }
    }

    const queues  = (result as any)?.queues ?? []
    const failed  = queues.reduce((acc: number, q: any) => acc + (q.failed ?? 0), 0)
    const waiting = queues.reduce((acc: number, q: any) => acc + (q.waiting ?? 0), 0)
    const delayed = queues.reduce((acc: number, q: any) => acc + (q.delayed ?? 0), 0)

    const status: CheckStatus = failed > 10 ? 'degraded' : 'ok'

    return {
      status, latencyMs: ms,
      detail: { totalFailed: failed, totalWaiting: waiting, totalDelayed: delayed, queues },
    }
  } catch (err) {
    return { status: 'degraded', error: (err as Error).message }
  }
}

// ── Base de Datos — tablas críticas ───────────────────────
async function checkDBTables(): Promise<CheckResult> {
  const REQUIRED = ['usuarios','cits','bicicletas','publicaciones','validacion_queue','denuncias_robo']
  try {
    const { ms, result } = await timed(async () => {
      const res = await pool.query(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename = ANY($1)`,
        [REQUIRED]
      )
      return res.rows.map((r: any) => r.tablename)
    })

    const missing = REQUIRED.filter(t => !result.includes(t))
    return {
      status:    missing.length > 0 ? 'down' : 'ok',
      latencyMs: ms,
      detail: { tablesOk: result.length, missing: missing.length > 0 ? missing : undefined },
    }
  } catch (err) {
    return { status: 'down', error: (err as Error).message }
  }
}

// ── CITs — estadísticas de negocio ───────────────────────
async function checkCITStats(): Promise<CheckResult> {
  try {
    const { ms, result } = await timed(async () => {
      const res = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE estado = 'PENDIENTE') AS pendientes,
           COUNT(*) FILTER (WHERE estado = 'ACTIVO')    AS activos,
           COUNT(*) FILTER (WHERE estado = 'BLOQUEADO') AS bloqueados,
           COUNT(*) FILTER (WHERE estado = 'RECHAZADO') AS rechazados,
           COUNT(*) FILTER (WHERE fecha_vencimiento < NOW() AND estado = 'ACTIVO') AS por_vencer
         FROM cits`
      )
      return res.rows[0]
    })

    const stats = {
      pendientes: parseInt(result.pendientes),
      activos:    parseInt(result.activos),
      bloqueados: parseInt(result.bloqueados),
      rechazados: parseInt(result.rechazados),
      porVencer:  parseInt(result.por_vencer),
    }

    return { status: 'ok', latencyMs: ms, detail: stats }
  } catch (err) {
    return { status: 'degraded', error: (err as Error).message }
  }
}

// ── Disco ─────────────────────────────────────────────────
function checkDisk(): CheckResult {
  try {
    // En Linux, usar /proc/mounts no es trivial; estimamos con os.freemem
    const freeMemMB  = Math.round(os.freemem() / 1024 / 1024)
    const totalMemMB = Math.round(os.totalmem() / 1024 / 1024)
    const usagePct   = Math.round(((totalMemMB - freeMemMB) / totalMemMB) * 100)

    return {
      status:    usagePct > 90 ? 'degraded' : 'ok',
      detail: {
        freeMemMB,
        totalMemMB,
        usagePct: usagePct + '%',
      },
    }
  } catch (err) {
    return { status: 'degraded', error: (err as Error).message }
  }
}

// ══════════════════════════════════════════════════════════
// REPORTES COMPUESTOS
// ══════════════════════════════════════════════════════════

const startTime = Date.now()

// ── /health — resumen rápido para UptimeRobot ─────────────
// Solo verifica PostgreSQL (el check más importante)
// Responde en < 200ms para no timeout en monitores externos
export async function quickHealthCheck(): Promise<{
  ok: boolean; status: CheckStatus; version: string; uptime: number; timestamp: string
  postgres?: CheckResult
}> {
  const pg = await Promise.race([
    checkPostgres(),
    new Promise<CheckResult>(resolve =>
      setTimeout(() => resolve({ status: 'degraded', error: 'timeout 2s' }), 2000)
    ),
  ])

  const status = pg.status
  const ok     = status !== 'down'

  return {
    ok, status,
    version:   process.env.npm_package_version ?? '0.1.0',
    uptime:    Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    postgres:  pg,
  }
}

// ── /health/live — liveness (K8s / ECS) ──────────────────
// El proceso está vivo. Falla solo si el proceso está bloqueado.
export function livenessCheck(): { ok: boolean; uptime: number; pid: number; timestamp: string } {
  return {
    ok:        true,
    uptime:    Math.floor((Date.now() - startTime) / 1000),
    pid:       process.pid,
    timestamp: new Date().toISOString(),
  }
}

// ── /health/ready — readiness (K8s / ECS / Railway) ───────
// El proceso puede recibir tráfico. Verifica DB + Redis.
export async function readinessCheck(): Promise<{
  ok: boolean; status: CheckStatus; timestamp: string; checks: Record<string, CheckResult>
}> {
  const [postgres, redis] = await Promise.all([
    Promise.race([checkPostgres(), new Promise<CheckResult>(r => setTimeout(() => r({ status: 'down', error: 'timeout' }), 3000))]),
    Promise.race([checkRedis(),    new Promise<CheckResult>(r => setTimeout(() => r({ status: 'degraded', error: 'timeout' }), 3000))]),
  ])

  const checks  = { postgres, redis }
  const status  = statusFromChecks(checks)
  const ok      = status !== 'down'

  if (!ok) log.db.warn({ postgres, redis }, 'Readiness check FAILED')

  return { ok, status, timestamp: new Date().toISOString(), checks }
}

// ── /health/deep — diagnóstico completo [Admin] ───────────
export async function deepHealthCheck(): Promise<HealthReport & {
  environment: Record<string, unknown>
  dependencies: Record<string, string>
}> {
  const t = Date.now()

  const [postgres, redis, queues, dbTables, citStats] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkQueues(),
    checkDBTables(),
    checkCITStats(),
  ])

  const checks: Record<string, CheckResult> = {
    postgres, redis, queues, dbTables, citStats,
    process: checkDisk(),
  }

  const status  = statusFromChecks(checks)
  const elapsed = Date.now() - t

  const report = {
    status,
    version:   process.env.npm_package_version ?? '0.1.0',
    uptime:    Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    checks,
    environment: {
      nodeVersion: process.version,
      platform:    process.platform,
      arch:        process.arch,
      env:         env.NODE_ENV,
      port:        env.PORT,
      apiVersion:  env.API_VERSION,
      bfaConfigured: !!(env.BFA_RPC_URL && env.BFA_WALLET_PRIVATE_KEY),
      mxmConfigured: !!(env.MXM_CLIENT_ID  && env.MXM_CLIENT_SECRET),
    },
    dependencies: {
      postgresql:      'pg@8.x',
      bull:            'bull@4.x (Redis-backed)',
      pino:            'pino@8.x',
      expresss:        'express@4.x',
      'rate-limiter':  'rate-limiter-flexible@5.x',
    },
    _meta: { deepCheckMs: elapsed },
  }

  log.db.info({ status, elapsed }, 'Deep health check completado')
  return report as any
}

// ══════════════════════════════════════════════════════════
// MÉTRICAS DE PROCESO — /health/metrics [Admin]
// ══════════════════════════════════════════════════════════

export function processMetrics() {
  const mem  = process.memoryUsage()
  const cpu  = process.cpuUsage()
  const load = os.loadavg()

  return {
    timestamp: new Date().toISOString(),
    uptime:    Math.floor((Date.now() - startTime) / 1000),
    process: {
      pid:         process.pid,
      version:     process.version,
      memoryMB: {
        rss:        Math.round(mem.rss        / 1024 / 1024),
        heapUsed:   Math.round(mem.heapUsed   / 1024 / 1024),
        heapTotal:  Math.round(mem.heapTotal  / 1024 / 1024),
        external:   Math.round(mem.external   / 1024 / 1024),
      },
      cpu: {
        userMs:   Math.round(cpu.user   / 1000),
        systemMs: Math.round(cpu.system / 1000),
      },
    },
    system: {
      platform:   process.platform,
      arch:       process.arch,
      cpus:       os.cpus().length,
      loadAvg: {
        '1m':  load[0].toFixed(2),
        '5m':  load[1].toFixed(2),
        '15m': load[2].toFixed(2),
      },
      totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMB:  Math.round(os.freemem()  / 1024 / 1024),
    },
    pool: {
      total:   (pool as any).totalCount   ?? 0,
      idle:    (pool as any).idleCount    ?? 0,
      waiting: (pool as any).waitingCount ?? 0,
    },
  }
}
