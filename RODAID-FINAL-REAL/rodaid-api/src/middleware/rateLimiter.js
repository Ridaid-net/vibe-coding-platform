"use strict";
// ─── RODAID · Rate Limiting & Throttling ─────────────────
// Sliding window (RateLimiterRedis) — distribuido, sobrevive reinicios
// Fallback transparente a memoria si Redis no está disponible
// Límites por: IP global · IP por endpoint · usuario autenticado · inspector
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRateLimiters = initRateLimiters;
exports.isIPBlocked = isIPBlocked;
exports.bloquearIP = bloquearIP;
exports.desbloquearIP = desbloquearIP;
exports.getClientIP = getClientIP;
exports.globalRateLimit = globalRateLimit;
exports.loginRateLimit = loginRateLimit;
exports.registerRateLimit = registerRateLimit;
exports.refreshRateLimit = refreshRateLimit;
exports.userRateLimit = userRateLimit;
exports.inspectorCITRateLimit = inspectorCITRateLimit;
exports.verificadorRateLimit = verificadorRateLimit;
exports.burstRateLimit = burstRateLimit;
exports.publicStrictRateLimit = publicStrictRateLimit;
exports.denunciaRateLimit = denunciaRateLimit;
exports.adminRateLimit = adminRateLimit;
exports.getRateLimitStatus = getRateLimitStatus;
exports.resetRateLimit = resetRateLimit;
exports.getBlockedIPs = getBlockedIPs;
exports.getViolacionesRecientes = getViolacionesRecientes;
exports.closeRateLimiters = closeRateLimiters;
const rate_limiter_flexible_1 = require("rate-limiter-flexible");
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("../config/env");
const logger_1 = require("./logger");
// ══════════════════════════════════════════════════════════
// CLIENTE REDIS COMPARTIDO
// ══════════════════════════════════════════════════════════
let redisClient = null;
async function getRedisClient() {
    if (redisClient?.status === 'ready')
        return redisClient;
    try {
        const url = env_1.env.REDIS_URL || 'redis://127.0.0.1:6379';
        redisClient = new ioredis_1.default(url, {
            enableReadyCheck: true,
            maxRetriesPerRequest: 3,
            lazyConnect: true,
        });
        redisClient.on('error', (err) => logger_1.logger.warn({ err: err.message }, 'RateLimiter Redis error — usando fallback en memoria'));
        await redisClient.connect();
        logger_1.logger.info('✓ RateLimiter conectado a Redis');
        return redisClient;
    }
    catch {
        logger_1.logger.warn('RateLimiter: Redis no disponible — usando fallback en memoria');
        return null;
    }
}
function createLimiter(config, client) {
    const base = {
        keyPrefix: config.keyPrefix,
        points: config.points,
        duration: config.duration,
        blockDuration: config.blockDuration ?? 0,
    };
    if (client?.status === 'ready') {
        return new rate_limiter_flexible_1.RateLimiterRedis({ ...base, storeClient: client });
    }
    return new rate_limiter_flexible_1.RateLimiterMemory(base);
}
// ══════════════════════════════════════════════════════════
// LIMITERS — uno por contexto de uso
// ══════════════════════════════════════════════════════════
let limiters = null;
async function initRateLimiters() {
    const client = await getRedisClient();
    limiters = {
        globalIP: createLimiter({ keyPrefix: 'rl:global', points: 200, duration: 900 }, // 200/15min
        client),
        authLogin: createLimiter({ keyPrefix: 'rl:auth:login', points: 5, duration: 900 }, // 5/15min, bloquea 15min
        client),
        authRegister: createLimiter({ keyPrefix: 'rl:auth:register', points: 3, duration: 3600 }, // 3/hora
        client),
        authRefresh: createLimiter({ keyPrefix: 'rl:auth:refresh', points: 10, duration: 60 }, // 10/min
        client),
        userAPI: createLimiter({ keyPrefix: 'rl:user', points: 300, duration: 60 }, // 300/min por userId
        client),
        inspectorCIT: createLimiter({ keyPrefix: 'rl:inspector:cit', points: 30, duration: 3600 }, // 30 CITs/hora
        client),
        verificador: createLimiter({ keyPrefix: 'rl:verificador', points: 100, duration: 60 }, // 100/min — endpoint público
        client),
        denuncia: createLimiter({ keyPrefix: 'rl:denuncia', points: 5, duration: 3600 }, // 5 denuncias/hora
        client),
        admin: createLimiter({ keyPrefix: 'rl:admin', points: 200, duration: 60 }, // 200/min
        client),
        burst: createLimiter({ keyPrefix: 'rl:burst', points: 20, duration: 10,
            blockDuration: 60 }, // bloquea 60s si supera 20 req/10s
        client),
        publicStrict: createLimiter({ keyPrefix: 'rl:public', points: 30, duration: 60 }, // 30/min
        client),
    };
    logger_1.logger.info({
        backend: client?.status === 'ready' ? 'Redis (sliding window)' : 'Memory (fallback)',
        limiters: Object.keys(limiters).length,
    }, '✓ Rate limiters inicializados');
}
// ══════════════════════════════════════════════════════════
// BLOCKLIST DE IPs EN REDIS
// Clave: rl:block:{ip}  — valor: motivo  — TTL: segundos de bloqueo
// ══════════════════════════════════════════════════════════
const BLOCK_KEY = (ip) => `rl:block:${ip}`;
const STRIKE_KEY = (ip) => `rl:strikes:${ip}`;
/** Verificar si una IP está en la blocklist */
async function isIPBlocked(ip) {
    try {
        const client = await getRedisClient();
        if (!client)
            return { blocked: false, ttlSec: 0 };
        const [motivo, ttl] = await Promise.all([
            client.get(BLOCK_KEY(ip)),
            client.ttl(BLOCK_KEY(ip)),
        ]);
        return motivo
            ? { blocked: true, ttlSec: Math.max(0, ttl), motivo }
            : { blocked: false, ttlSec: 0 };
    }
    catch {
        return { blocked: false, ttlSec: 0 };
    }
}
/** Bloquear una IP manualmente (admin) */
async function bloquearIP(ip, motivo, duracionSec = 86400 // 24h por defecto
) {
    try {
        const client = await getRedisClient();
        if (!client)
            return;
        await client.set(BLOCK_KEY(ip), motivo, 'EX', duracionSec);
        logger_1.logger.warn({ ip, motivo, duracionSec }, '🚫 IP bloqueada manualmente');
    }
    catch { /* best-effort */ }
}
/** Desbloquear IP (admin) */
async function desbloquearIP(ip) {
    try {
        const client = await getRedisClient();
        if (!client)
            return;
        await Promise.all([
            client.del(BLOCK_KEY(ip)),
            client.del(STRIKE_KEY(ip)),
        ]);
        logger_1.logger.info({ ip }, '✓ IP desbloqueada');
    }
    catch { /* best-effort */ }
}
/** Registrar strike de rate limit — 3 strikes → bloqueo progresivo */
async function registrarStrike(ip, limiter, endpoint) {
    try {
        const client = await getRedisClient();
        if (!client)
            return;
        // Incrementar strikes con TTL de 1 hora
        const strikes = await client.incr(STRIKE_KEY(ip));
        await client.expire(STRIKE_KEY(ip), 3600);
        // Esquema progresivo de bloqueo:
        //   1-2 strikes: solo log
        //   3-5 strikes: bloqueo 5 min
        //   6-9 strikes: bloqueo 30 min
        //   10+ strikes: bloqueo 24h
        let blockSec = 0;
        let motivo = '';
        if (strikes >= 10) {
            blockSec = 86400;
            motivo = `${strikes} strikes en 1h — bloqueo 24h`;
        }
        else if (strikes >= 6) {
            blockSec = 1800;
            motivo = `${strikes} strikes en 1h — bloqueo 30min`;
        }
        else if (strikes >= 3) {
            blockSec = 300;
            motivo = `${strikes} strikes en 1h — bloqueo 5min`;
        }
        if (blockSec > 0) {
            await client.set(BLOCK_KEY(ip), motivo, 'EX', blockSec);
            logger_1.logger.warn({ ip, strikes, blockSec, limiter }, `🔴 IP bloqueada progresivamente: ${motivo}`);
        }
        // Persistir en DB (fire-and-forget)
        const { query } = await import('../config/database');
        query(`INSERT INTO ratelimit_log (ip, endpoint, limiter, violations, primer_hit, ultimo_hit, bloqueada_hasta)
       VALUES ($1, $2, $3, $4, NOW(), NOW(),
         CASE WHEN $5 > 0 THEN NOW() + make_interval(secs => $5) ELSE NULL END)
       ON CONFLICT DO NOTHING`, [ip, endpoint.slice(0, 200), limiter, strikes, blockSec]).catch(() => { });
    }
    catch { /* best-effort */ }
}
// ══════════════════════════════════════════════════════════
// HELPER — ejecuta el limiter y responde 429 si excede
// ══════════════════════════════════════════════════════════
function getClientIP(req) {
    // Prioridad: Cloudflare > Load Balancer > X-Forwarded-For > req.ip
    // CF-Connecting-IP es más confiable que X-Forwarded-For (no falsificable en CF)
    const cf = req.headers['cf-connecting-ip'];
    if (cf && !Array.isArray(cf))
        return cf.trim();
    // X-Real-IP (nginx proxy_pass)
    const realIP = req.headers['x-real-ip'];
    if (realIP && !Array.isArray(realIP))
        return realIP.trim();
    // X-Forwarded-For: primera IP (cliente original antes de proxies)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        const first = ips.split(',')[0].trim();
        if (first && first !== 'unknown')
            return first;
    }
    // Railway / Render ponen la IP en req.ip cuando trust proxy está seteado
    return req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0';
}
async function consume(limiter, key, req, res, next, errorMsg, code) {
    try {
        const result = await limiter.consume(key);
        // Headers estándar de rate limiting (RFC 6585 / draft-ietf-httpapi-ratelimit-headers)
        res.setHeader('X-RateLimit-Limit', limiter.points);
        res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
        res.setHeader('X-RateLimit-Reset', new Date(Date.now() + result.msBeforeNext).toISOString());
        next();
    }
    catch (err) {
        if (err instanceof rate_limiter_flexible_1.RateLimiterRes) {
            const retryAfterSec = Math.ceil(err.msBeforeNext / 1000);
            res.setHeader('X-RateLimit-Limit', limiter.points);
            res.setHeader('X-RateLimit-Remaining', 0);
            res.setHeader('X-RateLimit-Reset', new Date(Date.now() + err.msBeforeNext).toISOString());
            res.setHeader('Retry-After', retryAfterSec);
            const clientIP = getClientIP(req);
            logger_1.logger.warn({
                key,
                code,
                ip: clientIP,
                path: req.path,
                method: req.method,
                retryAfter: retryAfterSec,
            }, `Rate limit excedido · ${code}`);
            // Registrar strike para bloqueo progresivo (solo endpoints públicos por IP)
            if (key === clientIP) {
                registrarStrike(clientIP, code, req.path).catch(() => { });
            }
            res.status(429).json({
                ok: false,
                error: {
                    code,
                    message: errorMsg,
                    retryAfter: retryAfterSec,
                },
            });
        }
        else {
            // Error interno del limiter — no bloquear al usuario
            logger_1.logger.error({ err }, 'Rate limiter error interno — request permitido');
            next();
        }
    }
}
// ══════════════════════════════════════════════════════════
// MIDDLEWARES EXPORTADOS — uno por tipo de endpoint
// ══════════════════════════════════════════════════════════
// ── Global: todas las rutas ────────────────────────────────
function globalRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    const ip = getClientIP(req);
    // Chequear blocklist en global limiter
    isIPBlocked(ip).then(({ blocked, ttlSec }) => {
        if (blocked) {
            res.setHeader('Retry-After', ttlSec);
            res.status(429).json({
                ok: false,
                error: { code: 'IP_BLOCKED', message: 'IP temporalmente bloqueada.', retryAfter: ttlSec },
            });
            return;
        }
        consume(limiters.globalIP, ip, req, res, next, 'Demasiadas solicitudes desde esta IP. Reintentá en 15 minutos.', 'RATE_LIMIT_IP');
    }).catch(() => {
        consume(limiters.globalIP, ip, req, res, next, 'Demasiadas solicitudes desde esta IP. Reintentá en 15 minutos.', 'RATE_LIMIT_IP');
    });
}
// ── Auth: POST /auth/login ─────────────────────────────────
function loginRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    // Clave por IP — combate fuerza bruta contra emails conocidos
    const ip = getClientIP(req);
    consume(limiters.authLogin, `${ip}`, req, res, next, 'Demasiados intentos de inicio de sesión. Cuenta bloqueada temporalmente 15 minutos.', 'LOGIN_RATE_LIMIT');
}
// ── Auth: POST /auth/register ──────────────────────────────
function registerRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    const ip = getClientIP(req);
    consume(limiters.authRegister, ip, req, res, next, 'Límite de registros desde esta IP alcanzado. Reintentá en 1 hora.', 'REGISTER_RATE_LIMIT');
}
// ── Auth: POST /auth/refresh ───────────────────────────────
function refreshRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    const ip = getClientIP(req);
    consume(limiters.authRefresh, ip, req, res, next, 'Demasiadas renovaciones de token. Reintentá en 1 minuto.', 'REFRESH_RATE_LIMIT');
}
// ── Usuario autenticado — límite por userId ────────────────
function userRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    // Si no hay userId, caer al límite global por IP
    const key = req.user?.sub ?? getClientIP(req);
    consume(limiters.userAPI, key, req, res, next, 'Demasiadas solicitudes. Tu cuenta está limitada temporalmente.', 'USER_RATE_LIMIT');
}
// ── Inspector: POST /cit/iniciar ───────────────────────────
function inspectorCITRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    const key = req.user?.sub ?? getClientIP(req);
    consume(limiters.inspectorCIT, key, req, res, next, 'Límite de CITs por hora alcanzado. El protocolo permite máximo 30 certificaciones por hora.', 'INSPECTOR_CIT_RATE_LIMIT');
}
// ── Verificador público — con blocklist + progressive ──────
function verificadorRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    const ip = getClientIP(req);
    // Chequear blocklist antes de consumir puntos del limiter
    isIPBlocked(ip).then(({ blocked, ttlSec, motivo }) => {
        if (blocked) {
            res.setHeader('Retry-After', ttlSec);
            res.setHeader('X-Block-Reason', motivo ?? 'blocked');
            logger_1.logger.warn({ ip, ttlSec, motivo, path: req.path }, '🚫 IP en blocklist — request rechazado');
            res.status(429).json({
                ok: false,
                error: {
                    code: 'IP_BLOCKED',
                    message: 'Tu IP está temporalmente bloqueada por exceder los límites de uso.',
                    retryAfter: ttlSec,
                },
            });
            return;
        }
        consume(limiters.verificador, ip, req, res, next, 'Demasiadas verificaciones desde esta IP. Reintentá en 1 minuto.', 'VERIFICADOR_RATE_LIMIT');
    }).catch(() => {
        consume(limiters.verificador, ip, req, res, next, 'Demasiadas verificaciones desde esta IP. Reintentá en 1 minuto.', 'VERIFICADOR_RATE_LIMIT');
    });
}
// ── Burst: anti-DoS (cualquier endpoint público) ─────────────
function burstRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    const ip = getClientIP(req);
    consume(limiters.burst, ip, req, res, next, 'Demasiadas solicitudes en un período muy corto. Esperá unos segundos.', 'BURST_RATE_LIMIT');
}
// ── Público estricto: POST sin auth (verificar-firma, sello) ──
function publicStrictRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    const ip = getClientIP(req);
    consume(limiters.publicStrict, ip, req, res, next, 'Límite de solicitudes públicas alcanzado. Reintentá en 1 minuto.', 'PUBLIC_RATE_LIMIT');
}
// ── Denuncia — evitar spam ─────────────────────────────────
function denunciaRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    const key = req.user?.sub ?? getClientIP(req);
    consume(limiters.denuncia, key, req, res, next, 'Límite de denuncias por hora alcanzado. Si es urgente, contactá al 911.', 'DENUNCIA_RATE_LIMIT');
}
// ── Admin ──────────────────────────────────────────────────
function adminRateLimit(req, res, next) {
    if (!limiters) {
        next();
        return;
    }
    const key = req.user?.sub ?? getClientIP(req);
    consume(limiters.admin, key, req, res, next, 'Límite de solicitudes admin alcanzado.', 'ADMIN_RATE_LIMIT');
}
// ══════════════════════════════════════════════════════════
// CONSULTA DE ESTADO — para el endpoint /admin/rate-limits
// ══════════════════════════════════════════════════════════
async function getRateLimitStatus(identifier) {
    if (!limiters)
        return { status: 'no_inicializado' };
    const results = {};
    const entries = Object.entries(limiters);
    for (const [name, limiter] of entries) {
        try {
            const res = await Promise.race([
                limiter.get(identifier),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
            ]);
            results[name] = res
                ? {
                    consumedPoints: res.consumedPoints,
                    remainingPoints: limiter.points - res.consumedPoints,
                    limit: limiter.points,
                    msBeforeReset: res.msBeforeNext,
                }
                : { consumedPoints: 0, remainingPoints: limiter.points, limit: limiter.points };
        }
        catch {
            results[name] = { consumedPoints: 0, remainingPoints: limiter.points, limit: limiter.points };
        }
    }
    return results;
}
// ── Limpiar limiters (para tests) ─────────────────────────
async function resetRateLimit(key, limitName) {
    if (!limiters)
        return;
    const targets = limitName
        ? [limiters[limitName]]
        : Object.values(limiters);
    // Fire-and-forget con timeout individual para no bloquear
    await Promise.allSettled(targets.map(l => Promise.race([
        l.delete(key).catch(() => { }),
        new Promise(r => setTimeout(r, 500)),
    ])));
}
/** Listar IPs bloqueadas actualmente */
async function getBlockedIPs() {
    try {
        const client = await getRedisClient();
        if (!client)
            return [];
        const keys = await client.keys('rl:block:*');
        if (!keys.length)
            return [];
        const results = await Promise.all(keys.map(async (key) => {
            const ip = key.replace('rl:block:', '');
            const motivo = await client.get(key);
            const ttl = await client.ttl(key);
            return { ip, motivo: motivo ?? '', ttlSec: Math.max(0, ttl) };
        }));
        return results;
    }
    catch {
        return [];
    }
}
/** Listar violaciones recientes desde DB */
async function getViolacionesRecientes(horas = 24) {
    const { query } = await import('../config/database');
    return query(`SELECT ip, limiter, violations, primer_hit, ultimo_hit, bloqueada_hasta
     FROM ratelimit_log
     WHERE ultimo_hit > NOW() - INTERVAL '${horas} hours'
     ORDER BY violations DESC LIMIT 50`, []);
}
async function closeRateLimiters() {
    if (redisClient && redisClient.status !== 'end') {
        await redisClient.quit();
        redisClient = null;
    }
}
