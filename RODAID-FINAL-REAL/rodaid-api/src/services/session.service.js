"use strict";
// ─── RODAID · Sesiones Redis ──────────────────────────────
// Redis (primario) + PostgreSQL (fallback/persistencia)
//
// Keys Redis:
//   rodaid:session:{sessionId}       → Hash con datos
//   rodaid:user-sessions:{userId}    → ZSet score=expiresAt
//
// TTL por rol:
//   CICLISTA/ALIADO/ADMIN  → SESSION_TTL_DEFAULT   (7d)
//   INSPECTOR              → SESSION_TTL_INSPECTOR  (12h)
//   rememberMe             → SESSION_TTL_EXTENDED   (30d, rolling)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTL = void 0;
exports.getSessionTTL = getSessionTTL;
exports.getRedisClient = getRedisClient;
exports.closeRedisSession = closeRedisSession;
exports.createSession = createSession;
exports.getSession = getSession;
exports.getSessionByToken = getSessionByToken;
exports.touchSession = touchSession;
exports.getUserSessions = getUserSessions;
exports.revokeSessionById = revokeSessionById;
exports.revokeAllUserSessions = revokeAllUserSessions;
exports.getSessionStats = getSessionStats;
exports.purgeExpiredSessions = purgeExpiredSessions;
exports.rotateSession = rotateSession;
const ioredis_1 = __importDefault(require("ioredis"));
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
// ── Keys ──────────────────────────────────────────────────
const KEY_SESSION = (id) => `rodaid:session:${id}`;
const KEY_USER_INDEX = (uid) => `rodaid:user-sessions:${uid}`;
// ── TTL parsing ───────────────────────────────────────────
function parseSeconds(expr) {
    const n = parseInt(expr);
    if (expr.endsWith('s'))
        return n;
    if (expr.endsWith('m'))
        return n * 60;
    if (expr.endsWith('h'))
        return n * 3600;
    if (expr.endsWith('d'))
        return n * 86_400;
    return n;
}
exports.TTL = {
    default: parseSeconds(env_1.env.SESSION_TTL_DEFAULT ?? '7d'),
    extended: parseSeconds(env_1.env.SESSION_TTL_EXTENDED ?? '30d'),
    inspector: parseSeconds(env_1.env.SESSION_TTL_INSPECTOR ?? '12h'),
    activityUpdate: parseSeconds(env_1.env.SESSION_ACTIVITY_UPDATE ?? '5m'),
};
const MAX_SESSIONS = env_1.env.SESSION_MAX_PER_USER ?? 10;
function getSessionTTL(rol, rememberMe = false) {
    if (rememberMe)
        return exports.TTL.extended;
    if (rol === 'INSPECTOR')
        return exports.TTL.inspector;
    return exports.TTL.default;
}
// ── Cliente Redis ─────────────────────────────────────────
let _redis = null;
async function getRedisClient() {
    if (_redis?.status === 'ready')
        return _redis;
    try {
        _redis = new ioredis_1.default(env_1.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
            lazyConnect: true, maxRetriesPerRequest: 2,
            connectTimeout: 3000, commandTimeout: 2000,
        });
        _redis.on('error', (e) => logger_1.log.auth.warn({ err: e.message }, 'Session Redis error'));
        _redis.on('close', () => { });
        await _redis.connect();
        logger_1.log.auth.info('✓ Session Redis conectado');
        return _redis;
    }
    catch {
        logger_1.log.auth.warn('Session Redis no disponible — fallback PG');
        return null;
    }
}
async function closeRedisSession() {
    if (_redis && _redis.status !== 'end') {
        await _redis.quit().catch(() => { });
        _redis = null;
    }
}
// ── Deserializar hash de Redis ────────────────────────────
function parseSession(sid, raw) {
    return {
        sessionId: sid,
        userId: raw.userId,
        rol: raw.rol,
        email: raw.email,
        ipAddress: raw.ipAddress || null,
        userAgent: raw.userAgent?.slice(0, 80) || null,
        createdAt: parseInt(raw.createdAt),
        lastActivity: parseInt(raw.lastActivity),
        expiresAt: parseInt(raw.expiresAt),
        rememberMe: raw.rememberMe === '1',
        familyId: raw.familyId ?? '',
    };
}
// ══════════════════════════════════════════════════════════
// CREAR SESIÓN
// ══════════════════════════════════════════════════════════
async function createSession(input) {
    const sessionId = crypto_1.default.randomUUID();
    const now = Date.now();
    const ttlSec = getSessionTTL(input.rol, input.rememberMe ?? false);
    const expiresAt = now + ttlSec * 1000;
    const familyId = input.familyId ?? crypto_1.default.randomUUID();
    const session = {
        sessionId, familyId,
        userId: input.userId,
        rol: input.rol,
        email: input.email,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.slice(0, 200) ?? null,
        createdAt: now,
        lastActivity: now,
        expiresAt,
        rememberMe: input.rememberMe ?? false,
    };
    const redis = await getRedisClient();
    if (redis) {
        const pipe = redis.pipeline();
        pipe.hset(KEY_SESSION(sessionId), {
            userId: session.userId,
            rol: session.rol,
            email: session.email,
            ipAddress: session.ipAddress ?? '',
            userAgent: session.userAgent ?? '',
            createdAt: now.toString(),
            lastActivity: now.toString(),
            expiresAt: expiresAt.toString(),
            rememberMe: session.rememberMe ? '1' : '0',
            familyId,
        });
        pipe.expireat(KEY_SESSION(sessionId), Math.floor(expiresAt / 1000));
        pipe.zadd(KEY_USER_INDEX(session.userId), expiresAt, sessionId);
        pipe.expireat(KEY_USER_INDEX(session.userId), Math.floor(expiresAt / 1000) + 86_400);
        await pipe.exec();
        await enforceSessionLimit(redis, session.userId, MAX_SESSIONS);
    }
    logger_1.log.auth.debug({
        sessionId, userId: input.userId, rol: input.rol,
        ttlSec, rememberMe: input.rememberMe ?? false,
        backend: redis ? 'Redis+PG' : 'PG-only',
    }, 'Sesión creada');
    return session;
}
// ══════════════════════════════════════════════════════════
// OBTENER SESIÓN (Redis → fallback PG)
// ══════════════════════════════════════════════════════════
async function getSession(sessionId) {
    const redis = await getRedisClient();
    if (redis) {
        try {
            const raw = await redis.hgetall(KEY_SESSION(sessionId));
            if (raw?.userId)
                return parseSession(sessionId, raw);
        }
        catch (e) {
            logger_1.log.auth.warn({ e, sessionId }, 'Redis getSession fallback');
        }
    }
    // Fallback PG
    const row = await (0, database_1.queryOne)(`SELECT rt.usuario_id, rt.family_id, rt.ip_address::text,
            rt.user_agent, rt.creado_en, rt.last_used_at, rt.expires_at
     FROM refresh_tokens rt
     WHERE rt.id=$1 AND rt.revoked=FALSE AND rt.expires_at>NOW()`, [sessionId]);
    if (!row)
        return null;
    const u = await (0, database_1.queryOne)('SELECT rol,email FROM usuarios WHERE id=$1', [row.usuario_id]);
    return {
        sessionId, familyId: row.family_id,
        userId: row.usuario_id, rol: u?.rol ?? 'CICLISTA', email: u?.email ?? '',
        ipAddress: row.ip_address, userAgent: row.user_agent?.slice(0, 80) ?? null,
        createdAt: new Date(row.creado_en).getTime(),
        lastActivity: new Date(row.last_used_at).getTime(),
        expiresAt: new Date(row.expires_at).getTime(),
        rememberMe: false,
    };
}
// Obtener sesión por token opaco (JWT family lookup)
async function getSessionByToken(_token) {
    // No implementado en este tier — usar getSession(jti)
    return null;
}
// ══════════════════════════════════════════════════════════
// TOUCH — actualizar lastActivity (debounced)
// ══════════════════════════════════════════════════════════
const _touchTimestamps = new Map();
async function touchSession(sessionId) {
    const now = Date.now();
    const last = _touchTimestamps.get(sessionId) ?? 0;
    if (now - last < exports.TTL.activityUpdate * 1000)
        return; // debounce
    _touchTimestamps.set(sessionId, now);
    const redis = await getRedisClient();
    if (!redis)
        return;
    try {
        const raw = await redis.hgetall(KEY_SESSION(sessionId));
        if (!raw?.userId)
            return;
        const pipe = redis.pipeline();
        pipe.hset(KEY_SESSION(sessionId), 'lastActivity', now.toString());
        // Rolling TTL para rememberMe
        if (raw.rememberMe === '1') {
            const newExpiry = now + exports.TTL.extended * 1000;
            pipe.expireat(KEY_SESSION(sessionId), Math.floor(newExpiry / 1000));
            pipe.hset(KEY_SESSION(sessionId), 'expiresAt', newExpiry.toString());
            pipe.zadd(KEY_USER_INDEX(raw.userId), newExpiry, sessionId);
        }
        await pipe.exec();
    }
    catch (e) {
        logger_1.log.auth.warn({ e, sessionId }, 'touchSession error');
    }
}
// ══════════════════════════════════════════════════════════
// LISTAR SESIONES DEL USUARIO
// ══════════════════════════════════════════════════════════
async function getUserSessions(userId) {
    const redis = await getRedisClient();
    if (redis) {
        try {
            const sids = await redis.zrangebyscore(KEY_USER_INDEX(userId), Date.now(), '+inf');
            const sessions = [];
            for (const sid of sids) {
                const raw = await redis.hgetall(KEY_SESSION(sid));
                if (raw?.userId === userId)
                    sessions.push(parseSession(sid, raw));
            }
            return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
        }
        catch (e) {
            logger_1.log.auth.warn({ e, userId }, 'getUserSessions fallback PG');
        }
    }
    // Fallback PG
    const rows = await (0, database_1.query)(`SELECT id, family_id, ip_address::text, user_agent, creado_en, last_used_at, expires_at
     FROM refresh_tokens
     WHERE usuario_id=$1 AND revoked=FALSE AND expires_at>NOW()
     ORDER BY last_used_at DESC`, [userId]);
    const u = await (0, database_1.queryOne)('SELECT rol,email FROM usuarios WHERE id=$1', [userId]);
    return rows.map(r => ({
        sessionId: r.id, familyId: r.family_id, userId,
        rol: u?.rol ?? 'CICLISTA', email: u?.email ?? '',
        ipAddress: r.ip_address, userAgent: r.user_agent?.slice(0, 80) ?? null,
        createdAt: new Date(r.creado_en).getTime(),
        lastActivity: new Date(r.last_used_at).getTime(),
        expiresAt: new Date(r.expires_at).getTime(),
        rememberMe: false,
    }));
}
// ══════════════════════════════════════════════════════════
// REVOCAR SESIÓN
// ══════════════════════════════════════════════════════════
async function revokeSessionById(sessionId, userId) {
    const redis = await getRedisClient();
    let ownerUserId = null;
    if (redis)
        ownerUserId = await redis.hget(KEY_SESSION(sessionId), 'userId');
    if (!ownerUserId) {
        const row = await (0, database_1.queryOne)('SELECT usuario_id FROM refresh_tokens WHERE id=$1 AND revoked=FALSE', [sessionId]);
        ownerUserId = row?.usuario_id ?? null;
    }
    if (ownerUserId !== userId)
        return false;
    if (redis) {
        await redis.del(KEY_SESSION(sessionId));
        await redis.zrem(KEY_USER_INDEX(userId), sessionId);
    }
    await (0, database_1.query)(`UPDATE refresh_tokens SET revoked=TRUE,revoked_at=NOW(),revoke_reason='session_revoked_by_user'
     WHERE id=$1 AND usuario_id=$2 AND revoked=FALSE`, [sessionId, userId]);
    _touchTimestamps.delete(sessionId);
    return true;
}
async function revokeAllUserSessions(userId, reason = 'logout_all') {
    const redis = await getRedisClient();
    let count = 0;
    if (redis) {
        const sids = await redis.zrange(KEY_USER_INDEX(userId), 0, -1);
        if (sids.length > 0) {
            const pipe = redis.pipeline();
            sids.forEach(sid => pipe.del(KEY_SESSION(sid)));
            pipe.del(KEY_USER_INDEX(userId));
            await pipe.exec();
            count = sids.length;
        }
    }
    const result = await (0, database_1.query)(`WITH rev AS (UPDATE refresh_tokens SET revoked=TRUE,revoked_at=NOW(),revoke_reason=$2
     WHERE usuario_id=$1 AND revoked=FALSE RETURNING id) SELECT COUNT(*)::text AS count FROM rev`, [userId, reason]);
    _touchTimestamps.clear();
    return Math.max(count, parseInt(result[0]?.count ?? '0'));
}
// ══════════════════════════════════════════════════════════
// LÍMITE DE SESIONES — revoca las más antiguas
// ══════════════════════════════════════════════════════════
async function enforceSessionLimit(redis, userId, limit) {
    await redis.zremrangebyscore(KEY_USER_INDEX(userId), '-inf', Date.now() - 1);
    const count = await redis.zcard(KEY_USER_INDEX(userId));
    if (count <= limit)
        return;
    const toRemove = await redis.zrange(KEY_USER_INDEX(userId), 0, count - limit - 1);
    if (!toRemove.length)
        return;
    const pipe = redis.pipeline();
    toRemove.forEach(sid => { pipe.del(KEY_SESSION(sid)); pipe.zrem(KEY_USER_INDEX(userId), sid); });
    await pipe.exec();
    await (0, database_1.query)(`UPDATE refresh_tokens SET revoked=TRUE,revoked_at=NOW(),revoke_reason='session_limit_exceeded'
     WHERE id=ANY($1::uuid[]) AND revoked=FALSE`, [toRemove]).catch(() => { });
    logger_1.log.auth.info({ userId, removed: toRemove.length, limit }, 'Límite de sesiones aplicado');
}
// ══════════════════════════════════════════════════════════
// STATS Y PURGA
// ══════════════════════════════════════════════════════════
async function getSessionStats() {
    const redis = await getRedisClient();
    const { count } = (await (0, database_1.queryOne)('SELECT COUNT(*)::text AS count FROM refresh_tokens WHERE revoked=FALSE AND expires_at>NOW()')) ?? { count: '0' };
    const redisKeys = redis ? await redis.dbsize() : undefined;
    return {
        backend: redis ? 'Redis + PostgreSQL' : 'PostgreSQL only',
        totalActive: parseInt(count),
        ttlConfig: { default: exports.TTL.default, extended: exports.TTL.extended, inspector: exports.TTL.inspector },
        maxPerUser: MAX_SESSIONS,
        redisKeys,
    };
}
async function purgeExpiredSessions() {
    const result = await (0, database_1.query)(`WITH d AS (DELETE FROM refresh_tokens
     WHERE (expires_at<NOW()-INTERVAL '1 day') OR (revoked=TRUE AND revoked_at<NOW()-INTERVAL '30 days')
     RETURNING id) SELECT COUNT(*)::text AS count FROM d`);
    const pgSessions = parseInt(result[0]?.count ?? '0');
    if (pgSessions > 0)
        logger_1.log.auth.info({ pgSessions }, 'Sesiones expiradas purgadas');
    return { pgSessions, redisStale: 0 };
}
async function rotateSession(oldSessionId, userId, ctx) {
    await revokeSessionById(oldSessionId, userId);
    return createSession(ctx);
}
