"use strict";
// ─── RODAID · SLA Stream — Tiempo Real 72h ────────────────
//
// Implementa dos capas de actualización en tiempo real:
//
//  CAPA 1 — Server-Sent Events (SSE)
//    GET /admin/sla/stream
//    El servidor pushea eventos al cliente cada 15s.
//    Sin polling activo del cliente; una sola conexión HTTP
//    persistente. Compatible con EventSource nativo del browser.
//
//  CAPA 2 — Polling endpoint (fallback)
//    GET /admin/sla/snapshot
//    Para clientes que no soportan SSE o están detrás de
//    proxies que bufferean SSE. Retorna el snapshot actual
//    y el timestamp del próximo cambio esperado.
//
// ══ EVENTOS SSE ══════════════════════════════════════════
//
//  event: sla_snapshot      → estado completo del SLA
//  event: sla_alerta        → cruce de umbral (OK↔WARNING↔CRITICAL)
//  event: metrica_nueva     → métrica individual registrada
//  event: heartbeat         → ping cada 30s para mantener conexión
//
// ══ ESTRUCTURA DEL SNAPSHOT EN TIEMPO REAL ═══════════════
//
//  {
//    ts:          1717704000000,   // unix ms
//    ventana:     "72h",
//    endpoint:    "/seguridad/cross-reference",
//    objetivo:    2000,            // ms
//    total:       618,
//    cumplimiento:96.4,            // %
//    estado:      "OK",
//    deltaDesdeAnterior: +0.3,    // cambio desde snapshot anterior
//    percentiles: { p50, p90, p95, p99 },
//    latencia:    { min, avg, max },
//    tendencia:   [ { periodo, cumplimiento, p99 } × 12 ],
//    proximoRecalculo: 1717704300000  // en 5 min
//  }
Object.defineProperty(exports, "__esModule", { value: true });
exports.sseHandler = sseHandler;
exports.broadcastSLASnapshot = broadcastSLASnapshot;
exports.getSLASnapshotRT = getSLASnapshotRT;
exports.iniciarBroadcastCron = iniciarBroadcastCron;
exports.detenerBroadcastCron = detenerBroadcastCron;
exports.getActiveSSEClients = getActiveSSEClients;
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const sla_service_1 = require("./sla.service");
const logger_1 = require("../middleware/logger");
const clients = new Map();
// ══════════════════════════════════════════════════════════
// CALCULAR SNAPSHOT EN TIEMPO REAL
// ══════════════════════════════════════════════════════════
async function calcularSnapshotRT(endpoint = sla_service_1.ENDPOINT_XREF) {
    const redis = (0, redis_1.getRedis)();
    const cacheKey = `sla:rt:${endpoint}`;
    // Cache de 15 segundos para no golpear la DB en cada SSE push
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
        const parsed = JSON.parse(cached);
        return { ...parsed, fuente: 'cache' };
    }
    // Cálculo real desde DB
    const metricas = await (0, database_1.query)(`SELECT latencia_ms, creado_en::text
     FROM endpoint_metrics
     WHERE endpoint=$1 AND creado_en > NOW() - INTERVAL '72 hours'
     ORDER BY creado_en DESC`, [endpoint]);
    if (metricas.length === 0) {
        return snapshotVacio(endpoint);
    }
    const lats = metricas.map(m => parseFloat(m.latencia_ms));
    const sobreObj = lats.filter(l => l > sla_service_1.SLA_OBJETIVO_MS).length;
    const bajObj = lats.length - sobreObj;
    const cumplimiento = Math.round((bajObj / lats.length) * 1000) / 10;
    // Percentiles
    const sorted = [...lats].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.floor(sorted.length * p / 100)] ?? 0;
    // Tendencia en bloques de 6h (últimas 72h = 12 bloques)
    const tendencia = await calcularTendenciaRT(endpoint);
    // Snapshot anterior para calcular delta
    const anterior = await (0, database_1.queryOne)(`SELECT cumplimiento FROM sla_snapshots WHERE endpoint=$1
     ORDER BY calculado_en DESC LIMIT 1`, [endpoint]);
    const delta = anterior
        ? Math.round((cumplimiento - parseFloat(anterior.cumplimiento)) * 10) / 10
        : null;
    const estado = cumplimiento >= 99 ? 'OK'
        : cumplimiento >= 95 ? 'WARNING'
            : 'CRITICAL';
    const snapshot = {
        ts: Date.now(),
        ventana: '72h',
        endpoint,
        objetivo: sla_service_1.SLA_OBJETIVO_MS,
        total: lats.length,
        cumplimiento,
        deltaDesdeAnterior: delta,
        estado,
        percentiles: {
            p50: Math.round(pct(50)),
            p90: Math.round(pct(90)),
            p95: Math.round(pct(95)),
            p99: Math.round(pct(99)),
        },
        latencia: {
            min: Math.round(Math.min(...lats)),
            avg: Math.round(lats.reduce((a, b) => a + b, 0) / lats.length),
            max: Math.round(Math.max(...lats)),
        },
        tendencia,
        proximoRecalculo: Date.now() + 15_000,
        fuente: 'calculado',
    };
    // Cachear 15 segundos
    await redis.set(cacheKey, JSON.stringify(snapshot), 'EX', 15).catch(() => { });
    return snapshot;
}
async function calcularTendenciaRT(endpoint) {
    const rows = await (0, database_1.query)(`SELECT
       date_trunc('hour', creado_en) + 
         (EXTRACT(HOUR FROM creado_en)::int % 6) * '-1 hour'::interval AS bloque,
       COUNT(*)::int AS requests,
       ROUND(
         COUNT(*) FILTER(WHERE latencia_ms <= $2)::numeric / COUNT(*) * 100, 1
       )::numeric AS cumplimiento,
       PERCENTILE_CONT(0.99) WITHIN GROUP(ORDER BY latencia_ms::numeric)::int AS p99
     FROM endpoint_metrics
     WHERE endpoint=$1 AND creado_en > NOW() - INTERVAL '72 hours'
     GROUP BY bloque
     ORDER BY bloque DESC
     LIMIT 12`, [endpoint, sla_service_1.SLA_OBJETIVO_MS]);
    return rows.map(r => ({
        periodo: r.bloque?.toString().slice(0, 16).replace('T', ' ') ?? '—',
        cumplimiento: parseFloat(r.cumplimiento),
        p99: parseInt(r.p99),
        requests: r.requests,
    })).reverse();
}
function snapshotVacio(endpoint) {
    return {
        ts: Date.now(), ventana: '72h', endpoint,
        objetivo: sla_service_1.SLA_OBJETIVO_MS, total: 0,
        cumplimiento: 100, deltaDesdeAnterior: null,
        estado: 'OK',
        percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
        latencia: { min: 0, avg: 0, max: 0 },
        tendencia: [], proximoRecalculo: Date.now() + 15_000,
        fuente: 'calculado',
    };
}
// ══════════════════════════════════════════════════════════
// SSE — HANDLER DE CONEXIÓN
// ══════════════════════════════════════════════════════════
function sseHandler(res, endpoint = sla_service_1.ENDPOINT_XREF) {
    const clientId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Headers SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar',
        'X-Accel-Buffering': 'no', // deshabilitar buffering en nginx
    });
    // Registrar cliente
    clients.set(clientId, { id: clientId, res, endpoint, creadoEn: Date.now() });
    logger_1.log.escrow.info({ clientId, endpoint, totalClients: clients.size }, '→ SSE cliente conectado');
    // Enviar snapshot inicial inmediatamente
    calcularSnapshotRT(endpoint).then(snap => {
        sendEvent(res, 'sla_snapshot', snap);
    }).catch(() => { });
    // Heartbeat cada 30s para mantener la conexión viva
    const heartbeatInterval = setInterval(() => {
        if (res.writableEnded) {
            clearInterval(heartbeatInterval);
            clients.delete(clientId);
            return;
        }
        sendEvent(res, 'heartbeat', { ts: Date.now(), clients: clients.size });
    }, 30_000);
    // Limpiar al desconectar
    res.on('close', () => {
        clearInterval(heartbeatInterval);
        clients.delete(clientId);
        logger_1.log.escrow.info({ clientId, totalClients: clients.size }, '← SSE cliente desconectado');
    });
    return clientId;
}
function sendEvent(res, event, data) {
    if (res.writableEnded)
        return;
    try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n`);
        res.write(`id: ${Date.now()}\n`);
        res.write('\n');
    }
    catch { /* cliente desconectado */ }
}
// ══════════════════════════════════════════════════════════
// BROADCAST — Enviar snapshot a TODOS los clientes SSE
// ══════════════════════════════════════════════════════════
let anteriorEstado = null;
async function broadcastSLASnapshot() {
    if (clients.size === 0)
        return;
    const snap = await calcularSnapshotRT().catch(() => null);
    if (!snap)
        return;
    // Detectar cambio de estado → evento especial de alerta
    if (anteriorEstado && anteriorEstado !== snap.estado) {
        const alerta = {
            ts: snap.ts,
            estadoPrev: anteriorEstado,
            estadoNuevo: snap.estado,
            cumplimiento: snap.cumplimiento,
            mensaje: `SLA ${anteriorEstado} → ${snap.estado} (${snap.cumplimiento}%)`,
        };
        for (const client of clients.values()) {
            sendEvent(client.res, 'sla_alerta', alerta);
        }
        logger_1.log.escrow.warn({ alerta }, '⚠ SLA estado cambió');
    }
    anteriorEstado = snap.estado;
    // Broadcast snapshot a todos
    for (const client of clients.values()) {
        sendEvent(client.res, 'sla_snapshot', snap);
    }
}
// ══════════════════════════════════════════════════════════
// POLLING — snapshot instantáneo (para fallback)
// ══════════════════════════════════════════════════════════
async function getSLASnapshotRT(endpoint = sla_service_1.ENDPOINT_XREF) {
    const snap = await calcularSnapshotRT(endpoint);
    return {
        ...snap,
        pollingInterval: snap.estado === 'CRITICAL' ? 5_000 : 15_000,
        activeSSEClients: clients.size,
    };
}
// ══════════════════════════════════════════════════════════
// CRON — Recalcular y broadcast cada 15s
// ══════════════════════════════════════════════════════════
let broadcastTimer = null;
function iniciarBroadcastCron(intervalMs = 15_000) {
    if (broadcastTimer)
        return; // ya iniciado
    broadcastTimer = setInterval(async () => {
        await broadcastSLASnapshot().catch(() => { });
    }, intervalMs);
    logger_1.log.escrow.info({ intervalMs }, '✅ SLA broadcast cron iniciado');
}
function detenerBroadcastCron() {
    if (broadcastTimer) {
        clearInterval(broadcastTimer);
        broadcastTimer = null;
    }
}
function getActiveSSEClients() { return clients.size; }
