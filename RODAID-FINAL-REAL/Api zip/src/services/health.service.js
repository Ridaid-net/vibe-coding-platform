"use strict";
// ─── RODAID · Health Checks & Monitoring ─────────────────
// Endpoints:
//   GET /health           — resumen rápido (UptimeRobot, load balancers)
//   GET /health/live      — liveness: el proceso respira (K8s/ECS)
//   GET /health/ready     — readiness: listo para recibir tráfico
//   GET /health/deep      — diagnóstico completo de todos los subsistemas [Admin]
//   GET /health/metrics   — métricas de proceso para dashboards [Admin]
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.quickHealthCheck = quickHealthCheck;
exports.livenessCheck = livenessCheck;
exports.readinessCheck = readinessCheck;
exports.deepHealthCheck = deepHealthCheck;
exports.processMetrics = processMetrics;
const database_1 = require("../config/database");
const env_1 = require("../config/env");
const logger_1 = require("../middleware/logger");
const os_1 = __importDefault(require("os"));
// ── Helpers ───────────────────────────────────────────────
function statusFromChecks(checks) {
    const values = Object.values(checks).map(c => c.status);
    if (values.includes('down'))
        return 'down';
    if (values.includes('degraded'))
        return 'degraded';
    return 'ok';
}
async function timed(fn) {
    const t = Date.now();
    const result = await fn();
    return { result, ms: Date.now() - t };
}
// ══════════════════════════════════════════════════════════
// CHECKS INDIVIDUALES
// ══════════════════════════════════════════════════════════
// ── PostgreSQL ────────────────────────────────────────────
async function checkPostgres() {
    try {
        const { ms } = await timed(async () => {
            const client = await database_1.pool.connect();
            try {
                await client.query('SELECT 1');
            }
            finally {
                client.release();
            }
        });
        // Obtener estadísticas del pool
        const poolStats = {
            total: database_1.pool.totalCount ?? 0,
            idle: database_1.pool.idleCount ?? 0,
            waiting: database_1.pool.waitingCount ?? 0,
        };
        const status = ms > 2000 ? 'degraded' :
            poolStats.waiting > 5 ? 'degraded' : 'ok';
        return { status, latencyMs: ms, detail: poolStats };
    }
    catch (err) {
        return { status: 'down', error: err.message };
    }
}
// ── Redis ─────────────────────────────────────────────────
async function checkRedis() {
    try {
        const Redis = require('ioredis');
        const client = new Redis(env_1.env.REDIS_URL, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 3000,
        });
        await client.connect();
        const { ms } = await timed(async () => client.ping());
        const info = await client.info('memory').catch(() => '');
        const memMatch = info.match(/used_memory_human:(\S+)/);
        const mem = memMatch ? memMatch[1] : 'n/d';
        await client.quit().catch(() => { });
        return {
            status: ms > 1000 ? 'degraded' : 'ok',
            latencyMs: ms,
            detail: { usedMemory: mem },
        };
    }
    catch (err) {
        return { status: 'down', error: err.message };
    }
}
// ── Bull Queues ───────────────────────────────────────────
async function checkQueues() {
    try {
        const { getQueueStats } = await import('./queue.service');
        const { ms, result } = await timed(() => getQueueStats());
        if (result?.status === 'no_iniciada') {
            return { status: 'degraded', latencyMs: ms, detail: { status: 'no_iniciada' } };
        }
        const queues = result?.queues ?? [];
        const failed = queues.reduce((acc, q) => acc + (q.failed ?? 0), 0);
        const waiting = queues.reduce((acc, q) => acc + (q.waiting ?? 0), 0);
        const delayed = queues.reduce((acc, q) => acc + (q.delayed ?? 0), 0);
        const status = failed > 10 ? 'degraded' : 'ok';
        return {
            status, latencyMs: ms,
            detail: { totalFailed: failed, totalWaiting: waiting, totalDelayed: delayed, queues },
        };
    }
    catch (err) {
        return { status: 'degraded', error: err.message };
    }
}
// ── Base de Datos — tablas críticas ───────────────────────
async function checkDBTables() {
    const REQUIRED = ['usuarios', 'cits', 'bicicletas', 'publicaciones', 'validacion_queue', 'denuncias_robo'];
    try {
        const { ms, result } = await timed(async () => {
            const res = await database_1.pool.query(`SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename = ANY($1)`, [REQUIRED]);
            return res.rows.map((r) => r.tablename);
        });
        const missing = REQUIRED.filter(t => !result.includes(t));
        return {
            status: missing.length > 0 ? 'down' : 'ok',
            latencyMs: ms,
            detail: { tablesOk: result.length, missing: missing.length > 0 ? missing : undefined },
        };
    }
    catch (err) {
        return { status: 'down', error: err.message };
    }
}
// ── CITs — estadísticas de negocio ───────────────────────
async function checkCITStats() {
    try {
        const { ms, result } = await timed(async () => {
            const res = await database_1.pool.query(`SELECT
           COUNT(*) FILTER (WHERE estado = 'PENDIENTE') AS pendientes,
           COUNT(*) FILTER (WHERE estado = 'ACTIVO')    AS activos,
           COUNT(*) FILTER (WHERE estado = 'BLOQUEADO') AS bloqueados,
           COUNT(*) FILTER (WHERE estado = 'RECHAZADO') AS rechazados,
           COUNT(*) FILTER (WHERE fecha_vencimiento < NOW() AND estado = 'ACTIVO') AS por_vencer
         FROM cits`);
            return res.rows[0];
        });
        const stats = {
            pendientes: parseInt(result.pendientes),
            activos: parseInt(result.activos),
            bloqueados: parseInt(result.bloqueados),
            rechazados: parseInt(result.rechazados),
            porVencer: parseInt(result.por_vencer),
        };
        return { status: 'ok', latencyMs: ms, detail: stats };
    }
    catch (err) {
        return { status: 'degraded', error: err.message };
    }
}
// ── Disco ─────────────────────────────────────────────────
function checkDisk() {
    try {
        // En Linux, usar /proc/mounts no es trivial; estimamos con os.freemem
        const freeMemMB = Math.round(os_1.default.freemem() / 1024 / 1024);
        const totalMemMB = Math.round(os_1.default.totalmem() / 1024 / 1024);
        const usagePct = Math.round(((totalMemMB - freeMemMB) / totalMemMB) * 100);
        return {
            status: usagePct > 90 ? 'degraded' : 'ok',
            detail: {
                freeMemMB,
                totalMemMB,
                usagePct: usagePct + '%',
            },
        };
    }
    catch (err) {
        return { status: 'degraded', error: err.message };
    }
}
// ══════════════════════════════════════════════════════════
// REPORTES COMPUESTOS
// ══════════════════════════════════════════════════════════
const startTime = Date.now();
// ── /health — resumen rápido para UptimeRobot ─────────────
// Solo verifica PostgreSQL (el check más importante)
// Responde en < 200ms para no timeout en monitores externos
async function quickHealthCheck() {
    const pg = await Promise.race([
        checkPostgres(),
        new Promise(resolve => setTimeout(() => resolve({ status: 'degraded', error: 'timeout 2s' }), 2000)),
    ]);
    const status = pg.status;
    const ok = status !== 'down';
    return {
        ok, status,
        version: process.env.npm_package_version ?? '0.1.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
        postgres: pg,
    };
}
// ── /health/live — liveness (K8s / ECS) ──────────────────
// El proceso está vivo. Falla solo si el proceso está bloqueado.
function livenessCheck() {
    return {
        ok: true,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        pid: process.pid,
        timestamp: new Date().toISOString(),
    };
}
// ── /health/ready — readiness (K8s / ECS / Railway) ───────
// El proceso puede recibir tráfico. Verifica DB + Redis.
async function readinessCheck() {
    const [postgres, redis] = await Promise.all([
        Promise.race([checkPostgres(), new Promise(r => setTimeout(() => r({ status: 'down', error: 'timeout' }), 3000))]),
        Promise.race([checkRedis(), new Promise(r => setTimeout(() => r({ status: 'degraded', error: 'timeout' }), 3000))]),
    ]);
    const checks = { postgres, redis };
    const status = statusFromChecks(checks);
    const ok = status !== 'down';
    if (!ok)
        logger_1.log.db.warn({ postgres, redis }, 'Readiness check FAILED');
    return { ok, status, timestamp: new Date().toISOString(), checks };
}
// ── /health/deep — diagnóstico completo [Admin] ───────────
async function deepHealthCheck() {
    const t = Date.now();
    const [postgres, redis, queues, dbTables, citStats] = await Promise.all([
        checkPostgres(),
        checkRedis(),
        checkQueues(),
        checkDBTables(),
        checkCITStats(),
    ]);
    const checks = {
        postgres, redis, queues, dbTables, citStats,
        process: checkDisk(),
    };
    const status = statusFromChecks(checks);
    const elapsed = Date.now() - t;
    const report = {
        status,
        version: process.env.npm_package_version ?? '0.1.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString(),
        checks,
        environment: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            env: env_1.env.NODE_ENV,
            port: env_1.env.PORT,
            apiVersion: env_1.env.API_VERSION,
            bfaConfigured: !!(env_1.env.BFA_RPC_URL && env_1.env.BFA_WALLET_PRIVATE_KEY),
            mxmConfigured: !!(env_1.env.MXM_CLIENT_ID && env_1.env.MXM_CLIENT_SECRET),
        },
        dependencies: {
            postgresql: 'pg@8.x',
            bull: 'bull@4.x (Redis-backed)',
            pino: 'pino@8.x',
            expresss: 'express@4.x',
            'rate-limiter': 'rate-limiter-flexible@5.x',
        },
        _meta: { deepCheckMs: elapsed },
    };
    logger_1.log.db.info({ status, elapsed }, 'Deep health check completado');
    return report;
}
// ══════════════════════════════════════════════════════════
// MÉTRICAS DE PROCESO — /health/metrics [Admin]
// ══════════════════════════════════════════════════════════
function processMetrics() {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const load = os_1.default.loadavg();
    return {
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        process: {
            pid: process.pid,
            version: process.version,
            memoryMB: {
                rss: Math.round(mem.rss / 1024 / 1024),
                heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
                heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
                external: Math.round(mem.external / 1024 / 1024),
            },
            cpu: {
                userMs: Math.round(cpu.user / 1000),
                systemMs: Math.round(cpu.system / 1000),
            },
        },
        system: {
            platform: process.platform,
            arch: process.arch,
            cpus: os_1.default.cpus().length,
            loadAvg: {
                '1m': load[0].toFixed(2),
                '5m': load[1].toFixed(2),
                '15m': load[2].toFixed(2),
            },
            totalMemMB: Math.round(os_1.default.totalmem() / 1024 / 1024),
            freeMemMB: Math.round(os_1.default.freemem() / 1024 / 1024),
        },
        pool: {
            total: database_1.pool.totalCount ?? 0,
            idle: database_1.pool.idleCount ?? 0,
            waiting: database_1.pool.waitingCount ?? 0,
        },
    };
}
