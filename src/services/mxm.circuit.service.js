"use strict";
// ─── RODAID · MxM Circuit Breaker ────────────────────────
// Detecta downtime de MxM y activa el fallback a auth nativo
// RODAID, permitiendo que los usuarios sigan operando.
//
// Patrón: Circuit Breaker (3 estados)
//   CLOSED  → MxM operativo → flujo normal
//   OPEN    → MxM caído → fallback nativo + bloqueo de features MxM
//   HALF    → probando recuperación → 1 request de prueba
//
// Umbrales:
//   FAILURE_THRESHOLD = 3  errores consecutivos → OPEN
//   TIMEOUT_MS        = 5000  tiempo límite por request a MxM
//   RECOVERY_MS       = 60000 esperar 60s antes de probar recuperación
//
// Health check:
//   GET MXM_BASE/.well-known/openid-configuration
//   Latencia < 1000ms → UP
//   Latencia 1000-3000ms → DEGRADED
//   Sin respuesta → DOWN
//
// Fallback features:
//   LOGIN           → auth nativo (email + password)
//   TOKEN_REFRESH   → extender token actual en DB (sin renovar en MxM)
//   NOTIFICACIONES  → solo in-app (sin canal gubernamental)
//   TRAMITES        → encolar para cuando MxM vuelva
//   PAGOS           → deshabilitado (requiere MxM activo)
//   IDENTIDAD       → usar datos cacheados en DB
//
// Modo STUB (sin credenciales):
//   → siempre reporta CLOSED/UP (MxM no se usa)
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEstadoCircuito = getEstadoCircuito;
exports.registrarExito = registrarExito;
exports.registrarFallo = registrarFallo;
exports.checkHealthMxM = checkHealthMxM;
exports.featureDisponible = featureDisponible;
exports.conFallback = conFallback;
exports.extenderTokenExistente = extenderTokenExistente;
exports.getHealthHistory = getHealthHistory;
exports.getUptimeStats = getUptimeStats;
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
const env_1 = require("../config/env");
const FAILURE_THRESHOLD = 3; // errores antes de abrir el circuito
const TIMEOUT_MS = 5_000; // ms para health check
const RECOVERY_MS = 60_000; // ms antes de intentar HALF_OPEN
const CACHE_TTL_SEC = 30; // TTL del estado en Redis
const KEYS = {
    estado: 'mxm:cb:estado', // CLOSED | OPEN | HALF_OPEN
    fallos: 'mxm:cb:fallos', // contador de errores consecutivos
    abierto_en: 'mxm:cb:abierto_en', // timestamp de apertura
    ultimo_check: 'mxm:cb:ultimo_check', // timestamp del último health check
    health: 'mxm:cb:health', // UP | DOWN | DEGRADED | TIMEOUT
    latencia: 'mxm:cb:latencia_ms', // última latencia
};
const MODO_STUB = !env_1.env.MXM_AUTH_URL || env_1.env.MXM_AUTH_URL === 'https://auth.mendoza.gob.ar'
    ? !env_1.env.MXM_CLIENT_ID
    : false;
// ══════════════════════════════════════════════════════════
// LEER ESTADO DEL CIRCUITO
// ══════════════════════════════════════════════════════════
async function getEstadoCircuito() {
    if (MODO_STUB) {
        return { estado: 'CLOSED', health: 'STUB', fallos: 0, puedeIntentar: true };
    }
    const redis = (0, redis_1.getRedis)();
    const [estado, fallosStr, abiertoEnStr, healthStr, latStr] = await Promise.all([
        redis.get(KEYS.estado),
        redis.get(KEYS.fallos),
        redis.get(KEYS.abierto_en),
        redis.get(KEYS.health),
        redis.get(KEYS.latencia),
    ]);
    const circuitState = estado ?? 'CLOSED';
    const fallos = parseInt(fallosStr ?? '0');
    const health = healthStr ?? 'UP';
    const latenciaMs = latStr ? parseInt(latStr) : undefined;
    const ahora = Date.now();
    const abiertoEn = abiertoEnStr ? parseInt(abiertoEnStr) : null;
    // Si está OPEN y pasó el tiempo de recovery → pasar a HALF_OPEN
    if (circuitState === 'OPEN' && abiertoEn && (ahora - abiertoEn) > RECOVERY_MS) {
        await redis.set(KEYS.estado, 'HALF_OPEN');
        logger_1.log.mxm.info({ abiertoHaceSec: Math.round((ahora - abiertoEn) / 1000) }, '🔄 MxM circuit → HALF_OPEN (probando recuperación)');
        return { estado: 'HALF_OPEN', health, fallos, latenciaMs, puedeIntentar: true };
    }
    const puedeIntentar = circuitState !== 'OPEN';
    const abiertoDesdeSec = abiertoEn ? Math.round((ahora - abiertoEn) / 1000) : undefined;
    return { estado: circuitState, health, fallos, latenciaMs, abiertoDesdeSec, puedeIntentar };
}
// ══════════════════════════════════════════════════════════
// REGISTRAR ÉXITO / FALLO
// ══════════════════════════════════════════════════════════
async function registrarExito() {
    if (MODO_STUB)
        return;
    const redis = (0, redis_1.getRedis)();
    const [estadoActual] = await Promise.all([redis.get(KEYS.estado)]);
    await redis.set(KEYS.fallos, '0');
    await redis.set(KEYS.health, 'UP');
    if (estadoActual !== 'CLOSED') {
        await redis.set(KEYS.estado, 'CLOSED');
        await redis.del(KEYS.abierto_en);
        logger_1.log.mxm.info({}, '✅ MxM circuit → CLOSED (recuperado)');
        await (0, database_1.query)(`INSERT INTO mxm_health_log (estado, error_msg) VALUES ('UP', 'Circuito cerrado — recuperación')`, []).catch(() => { });
    }
}
async function registrarFallo(errorMsg, endpoint) {
    if (MODO_STUB)
        return;
    const redis = (0, redis_1.getRedis)();
    const fallos = await redis.incr(KEYS.fallos);
    await redis.set(KEYS.health, 'DOWN');
    logger_1.log.mxm.warn({ fallos, errorMsg, endpoint }, `⚠ MxM fallo #${fallos}`);
    if (fallos >= FAILURE_THRESHOLD) {
        const estadoActual = await redis.get(KEYS.estado);
        if (estadoActual !== 'OPEN') {
            await redis.set(KEYS.estado, 'OPEN');
            await redis.set(KEYS.abierto_en, Date.now().toString());
            logger_1.log.mxm.error({ fallos, endpoint }, `🔴 MxM circuit → OPEN (${fallos} fallos consecutivos)`);
            await (0, database_1.query)(`INSERT INTO mxm_health_log (estado, endpoint, error_msg) VALUES ('DOWN',$1,$2)`, [endpoint ?? null, `Circuito abierto: ${errorMsg.slice(0, 300)}`]).catch(() => { });
        }
    }
}
// ══════════════════════════════════════════════════════════
// HEALTH CHECK ACTIVO
// ══════════════════════════════════════════════════════════
async function checkHealthMxM() {
    if (MODO_STUB)
        return { status: 'STUB', latenciaMs: 0, detalle: 'Modo STUB — sin MxM real' };
    const baseUrl = env_1.env.MXM_AUTH_URL ?? 'https://auth.mendoza.gob.ar';
    const checkUrl = `${baseUrl}/.well-known/openid-configuration`;
    const t0 = Date.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const res = await fetch(checkUrl, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json', 'User-Agent': 'RODAID-HealthCheck/1.0' },
        });
        clearTimeout(timeout);
        const latenciaMs = Date.now() - t0;
        const redis = (0, redis_1.getRedis)();
        await redis.set(KEYS.latencia, latenciaMs.toString());
        await redis.set(KEYS.ultimo_check, Date.now().toString());
        if (!res.ok) {
            await registrarFallo(`HTTP ${res.status}`, 'openid-config');
            const status = 'DOWN';
            await redis.set(KEYS.health, status);
            await (0, database_1.query)(`INSERT INTO mxm_health_log (estado, latencia_ms, endpoint, error_msg) VALUES ($1,$2,$3,$4)`, [status, latenciaMs, checkUrl, `HTTP ${res.status}`]).catch(() => { });
            return { status, latenciaMs, detalle: `HTTP ${res.status}` };
        }
        const status = latenciaMs > 3000 ? 'DEGRADED'
            : latenciaMs > 1000 ? 'DEGRADED'
                : 'UP';
        await redis.set(KEYS.health, status);
        if (status === 'UP')
            await registrarExito();
        else
            logger_1.log.mxm.warn({ latenciaMs, status }, 'MxM DEGRADED — respuesta lenta');
        await (0, database_1.query)(`INSERT INTO mxm_health_log (estado, latencia_ms, endpoint) VALUES ($1,$2,$3)`, [status, latenciaMs, checkUrl]).catch(() => { });
        return { status, latenciaMs };
    }
    catch (err) {
        const latenciaMs = Date.now() - t0;
        const isTimeout = err.name === 'AbortError';
        const status = isTimeout ? 'TIMEOUT' : 'DOWN';
        const msg = isTimeout ? `Timeout (>${TIMEOUT_MS}ms)` : err.message;
        await registrarFallo(msg, checkUrl);
        const redis = (0, redis_1.getRedis)();
        await redis.set(KEYS.health, status);
        await redis.set(KEYS.latencia, latenciaMs.toString());
        await (0, database_1.query)(`INSERT INTO mxm_health_log (estado, latencia_ms, endpoint, error_msg) VALUES ($1,$2,$3,$4)`, [status, latenciaMs, checkUrl, msg.slice(0, 300)]).catch(() => { });
        return { status, latenciaMs, detalle: msg };
    }
}
// ══════════════════════════════════════════════════════════
// VERIFICAR DISPONIBILIDAD POR FEATURE
// ══════════════════════════════════════════════════════════
/** Indica si una feature MxM está disponible ahora */
async function featureDisponible(feature) {
    if (MODO_STUB)
        return { disponible: true };
    const { estado, health } = await getEstadoCircuito();
    // Circuito OPEN → la mayoría de features caen al fallback
    if (estado === 'OPEN' || health === 'DOWN' || health === 'TIMEOUT') {
        const fallbacks = {
            LOGIN: 'auth nativo RODAID (email + password)',
            TOKEN_REFRESH: 'extensión de token existente en DB',
            NOTIFICACIONES: 'solo notificaciones in-app',
            IDENTIDAD: 'datos cacheados en DB (pueden estar desactualizados)',
            TRAMITES: 'encolar para procesar cuando MxM vuelva',
            PAGOS: null, // sin fallback — requiere MxM
            WEBHOOK: 'procesar cuando MxM vuelva',
        };
        const fallback = fallbacks[feature];
        return {
            disponible: false,
            motivo: `MxM no disponible (circuito ${estado}, health: ${health})`,
            fallback: fallback ?? undefined,
        };
    }
    // DEGRADED: features críticas siguen, features opcionales degradan
    if (health === 'DEGRADED') {
        const degradadas = ['NOTIFICACIONES', 'TRAMITES'];
        if (degradadas.includes(feature)) {
            return { disponible: false, motivo: 'MxM degradado — evitando latencia alta', fallback: 'fallback activado' };
        }
    }
    return { disponible: true };
}
// ══════════════════════════════════════════════════════════
// WRAPPER: ejecutar con fallback automático
// ══════════════════════════════════════════════════════════
async function conFallback(feature, accionMxM, accionFallback, opciones) {
    const { disponible, fallback } = await featureDisponible(feature);
    if (!disponible) {
        if (!accionFallback) {
            throw Object.assign(new Error(`MxM no disponible y sin fallback para ${feature}`), { code: 'MXM_UNAVAILABLE', status: 503 });
        }
        logger_1.log.mxm.warn({ feature, fallback }, `🔀 MxM circuit open → fallback: ${fallback}`);
        const resultado = await accionFallback();
        return { resultado, usóFallback: true, origen: 'fallback' };
    }
    // Intentar con MxM
    try {
        const resultado = await accionMxM();
        await registrarExito();
        return { resultado, usóFallback: false, origen: 'mxm' };
    }
    catch (err) {
        const msg = err.message;
        if (opciones?.registrarFalloEnCircuito !== false) {
            await registrarFallo(msg, feature);
        }
        if (accionFallback) {
            logger_1.log.mxm.warn({ feature, err: msg }, `🔀 MxM falló → activando fallback`);
            const resultado = await accionFallback();
            return { resultado, usóFallback: true, origen: 'fallback' };
        }
        // Sin fallback: envolver el error como MXM_UNAVAILABLE para que los callers tengan un error consistente
        throw Object.assign(new Error(`MxM no disponible para ${feature}: ${msg}`), { code: 'MXM_UNAVAILABLE', status: 503, cause: err });
    }
}
// ══════════════════════════════════════════════════════════
// FALLBACK: EXTENDER TOKEN SIN RENOVAR EN MxM
// ══════════════════════════════════════════════════════════
/** Cuando MxM está caído, extender el token actual por 1 hora más */
async function extenderTokenExistente(userId) {
    const row = await (0, database_1.queryOne)(`SELECT expires_at, access_token FROM mxm_tokens WHERE usuario_id=$1`, [userId]);
    if (!row || !row.access_token)
        return { extendido: false };
    const nuevaExp = new Date(Date.now() + 3600_000); // +1 hora
    await (0, database_1.query)(`UPDATE mxm_tokens SET expires_at=$2, actualizado_en=NOW() WHERE usuario_id=$1`, [userId, nuevaExp]);
    // Limpiar cache Redis para que la próxima llamada lea la extensión
    const redis = (0, redis_1.getRedis)();
    await redis.del(`mxm:access_token:${userId}`);
    logger_1.log.mxm.warn({ userId: userId.slice(0, 8), nuevaExp: nuevaExp.toISOString() }, '⏱ Token MxM extendido (fallback — MxM caído)');
    return { extendido: true, nuevaExpiracion: nuevaExp };
}
// ══════════════════════════════════════════════════════════
// CONSULTAS Y STATS
// ══════════════════════════════════════════════════════════
async function getHealthHistory(limite = 50) {
    return (0, database_1.query)(`SELECT estado, latencia_ms, endpoint, error_msg, registrado_en
     FROM mxm_health_log ORDER BY registrado_en DESC LIMIT $1`, [limite]);
}
async function getUptimeStats(horas = 24) {
    const row = await (0, database_1.queryOne)(`SELECT
       COUNT(*)::text                              AS total,
       COUNT(*) FILTER (WHERE estado='UP')::text  AS up,
       COUNT(*) FILTER (WHERE estado IN ('DOWN','TIMEOUT'))::text AS down,
       COUNT(*) FILTER (WHERE estado='DEGRADED')::text AS deg,
       COALESCE(AVG(latencia_ms),0)::text         AS lat_avg,
       COALESCE(MAX(latencia_ms),0)::text         AS lat_max
     FROM mxm_health_log
     WHERE registrado_en > NOW() - ($1||' hours')::interval`, [horas]);
    const total = parseInt(row?.total ?? '0');
    return {
        totalChecks: total,
        upPct: total > 0 ? Math.round(parseInt(row?.up ?? '0') / total * 100) : 100,
        downPct: total > 0 ? Math.round(parseInt(row?.down ?? '0') / total * 100) : 0,
        degradedPct: total > 0 ? Math.round(parseInt(row?.deg ?? '0') / total * 100) : 0,
        latenciaPromMs: Math.round(parseFloat(row?.lat_avg ?? '0')),
        latenciaMaxMs: parseInt(row?.lat_max ?? '0'),
    };
}
