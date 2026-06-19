"use strict";
// ─── RODAID · JWT Service — Access + Refresh Tokens ───────
//
// Access token  : JWT HS256 · 15 min · incluye jti para revocación
// Refresh token : opaco hex 128 chars · 7 días · familia para
//                 detección de robo (token reuse detection)
//
// Flujo normal:
//   login  → signAccessToken + issueRefreshToken (nueva familia)
//   use    → verifyAccessToken (valida firma + exp + blacklist)
//   expire → rotateRefreshToken (intercambia viejo por nuevo,
//             misma familia, detecta reúso)
//   logout → revokeRefreshToken / revokeAllUserTokens
//
// Detección de robo:
//   Si se presenta un refresh token ya rotado (de una familia activa),
//   TODA la familia se revoca y se notifica al usuario.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAccessToken = signAccessToken;
exports.verifyAndExtractToken = verifyAndExtractToken;
exports.verifyAccessToken = verifyAccessToken;
exports.revokeAccessToken = revokeAccessToken;
exports.issueRefreshToken = issueRefreshToken;
exports.signRefreshToken = signRefreshToken;
exports.saveRefreshToken = saveRefreshToken;
exports.rotateRefreshToken = rotateRefreshToken;
exports.revokeRefreshToken = revokeRefreshToken;
exports.revokeAllUserTokens = revokeAllUserTokens;
exports.getActiveSessions = getActiveSessions;
exports.revokeSession = revokeSession;
exports.purgeExpiredTokens = purgeExpiredTokens;
exports.buildTokenPair = buildTokenPair;
exports.buildTokenPairInspector = buildTokenPairInspector;
exports.buildTokenPairAliado = buildTokenPairAliado;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
const database_1 = require("../config/database");
const errorHandler_1 = require("../middleware/errorHandler");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
// Parsea "15m" → 900, "7d" → 604800, "1h" → 3600
function parseExpiry(expr) {
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
const ACCESS_EXPIRY_SEC = parseExpiry(env_1.env.JWT_ACCESS_EXPIRES ?? '15m');
const REFRESH_EXPIRY_SEC = parseExpiry(env_1.env.JWT_REFRESH_EXPIRES ?? '7d');
function generateOpaqueToken() {
    // 64 bytes = 128 caracteres hex — imposible de adivinar
    return crypto_1.default.randomBytes(64).toString('hex');
}
function generateJTI() {
    return crypto_1.default.randomUUID();
}
// ══════════════════════════════════════════════════════════
// ACCESS TOKEN — firmar y verificar
// ══════════════════════════════════════════════════════════
function signAccessToken(payload, jti) {
    const tokenJTI = jti ?? generateJTI();
    return jsonwebtoken_1.default.sign({ ...payload, jti: tokenJTI }, env_1.env.JWT_SECRET, {
        expiresIn: env_1.env.JWT_ACCESS_EXPIRES,
        issuer: 'rodaid.com.ar',
        audience: 'rodaid-api',
        algorithm: 'HS256',
    });
}
// Verifica firma, expiración y blacklist
async function verifyAndExtractToken(token) {
    let decoded;
    try {
        decoded = jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET, {
            issuer: 'rodaid.com.ar',
            audience: 'rodaid-api',
            algorithms: ['HS256'],
        });
    }
    catch (err) {
        if (err instanceof jsonwebtoken_1.default.TokenExpiredError) {
            throw new errorHandler_1.AppError('Token expirado', 401, 'TOKEN_EXPIRED');
        }
        throw new errorHandler_1.AppError('Token inválido', 401, 'TOKEN_INVALID');
    }
    if (!decoded.jti)
        throw new errorHandler_1.AppError('Token inválido (sin jti)', 401, 'TOKEN_INVALID');
    // Verificar blacklist (best-effort: si la DB falla, no bloqueamos)
    try {
        const blacklisted = await (0, database_1.queryOne)(`SELECT jti FROM token_blacklist WHERE jti = $1::uuid AND expires_at > NOW()`, [decoded.jti]);
        if (blacklisted) {
            throw new errorHandler_1.AppError('Token revocado', 401, 'TOKEN_REVOKED');
        }
    }
    catch (err) {
        if (err instanceof errorHandler_1.AppError)
            throw err;
        logger_1.log.auth.warn({ err }, 'Blacklist check failed — allowing token');
    }
    return decoded;
}
// Versión síncrona — sin blacklist (para middleware de alta frecuencia)
// Usar verifyAndExtractToken para endpoints sensibles
function verifyAccessToken(token) {
    try {
        return jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET, {
            issuer: 'rodaid.com.ar',
            audience: 'rodaid-api',
            algorithms: ['HS256'],
        });
    }
    catch (err) {
        if (err instanceof jsonwebtoken_1.default.TokenExpiredError) {
            throw new errorHandler_1.AppError('Token expirado', 401, 'TOKEN_EXPIRED');
        }
        throw new errorHandler_1.AppError('Token inválido', 401, 'TOKEN_INVALID');
    }
}
// Revocar un access token individual (agrega a blacklist)
async function revokeAccessToken(jti, userId, expiresAt, reason = 'manual_revocation') {
    await (0, database_1.query)(`INSERT INTO token_blacklist (jti, usuario_id, expires_at, reason)
     VALUES ($1::uuid, $2, $3, $4)
     ON CONFLICT (jti) DO NOTHING`, [jti, userId, expiresAt, reason]);
}
// ══════════════════════════════════════════════════════════
// REFRESH TOKEN — emitir, rotar, revocar
// ══════════════════════════════════════════════════════════
// Emitir un refresh token nuevo (nueva familia)
async function issueRefreshToken(userId, ctx = {}) {
    const token = generateOpaqueToken();
    const familyId = crypto_1.default.randomUUID(); // nueva familia para esta sesión
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_SEC * 1000);
    await (0, database_1.query)(`INSERT INTO refresh_tokens
       (usuario_id, token, family_id, expires_at, ip_address, user_agent, device_info)
     VALUES ($1, $2, $3::uuid, $4, $5::inet, $6, $7)`, [
        userId, token, familyId, expiresAt,
        ctx.ipAddress ?? null,
        ctx.userAgent ?? null,
        ctx.deviceInfo ? JSON.stringify(ctx.deviceInfo) : null,
    ]);
    logger_1.log.auth.debug({
        userId, familyId,
        expiresAt: expiresAt.toISOString(),
        ip: ctx.ipAddress,
    }, 'Refresh token emitido · nueva sesión');
    return token;
}
// Mantener compatibilidad con código existente
async function signRefreshToken(userId) {
    return issueRefreshToken(userId);
}
async function saveRefreshToken(userId, token) {
    // No-op cuando se usa issueRefreshToken — token ya guardado
    // Implementación de compatibilidad para código legado
    const exists = await (0, database_1.queryOne)(`SELECT id FROM refresh_tokens WHERE token = $1`, [token]);
    if (!exists) {
        const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_SEC * 1000);
        await (0, database_1.query)(`INSERT INTO refresh_tokens (usuario_id, token, expires_at)
       VALUES ($1, $2, $3)`, [userId, token, expiresAt]);
    }
}
// Rotar refresh token — el corazón del sistema de seguridad
async function rotateRefreshToken(oldToken, ctx = {}) {
    // Capturar datos de familia para revocación fuera de la TX
    let familyToRevoke = null;
    try {
        const result = await (0, database_1.transaction)(async (client) => {
            // 1. Buscar el token (activo O revocado — necesitamos ver ambos para detectar reúso)
            const found = await client.query(`SELECT id, usuario_id, family_id, expires_at, revoked, revoke_reason
       FROM refresh_tokens
       WHERE token = $1`, [oldToken]);
            if (found.rows.length === 0) {
                throw new errorHandler_1.AppError('Refresh token inválido', 401, 'INVALID_REFRESH');
            }
            const rt = found.rows[0];
            // 2. Detección de reúso — si el token ya fue rotado (revocado por rotación),
            //    TODA LA FAMILIA está comprometida → revocar todas las sesiones
            if (rt.revoked) {
                // Extraer datos necesarios antes de salir de la transacción
                const compromisedFamily = rt.family_id;
                const compromisedUserId = rt.usuario_id;
                // Lanzar aquí revierte la TX — la revocación de familia se hace FUERA
                throw Object.assign(new errorHandler_1.AppError('Sesión comprometida por seguridad. Iniciá sesión nuevamente.', 401, 'TOKEN_REUSE_DETECTED'), { _familyId: compromisedFamily, _userId: compromisedUserId });
            }
            // 3. Verificar que no expiró
            if (new Date(rt.expires_at) < new Date()) {
                throw new errorHandler_1.AppError('Refresh token expirado', 401, 'REFRESH_TOKEN_EXPIRED');
            }
            // 4. Marcar el viejo token como rotado (no borrar — necesario para detección de reúso)
            await client.query(`UPDATE refresh_tokens
       SET revoked = TRUE, revoked_at = NOW(), revoke_reason = 'rotated'
       WHERE id = $1`, [rt.id]);
            // 5. Emitir nuevo token en la MISMA familia (continuidad de sesión)
            const newToken = generateOpaqueToken();
            const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_SEC * 1000);
            await client.query(`INSERT INTO refresh_tokens
         (usuario_id, token, family_id, expires_at, ip_address, user_agent, device_info, last_used_at)
       VALUES ($1, $2, $3::uuid, $4, $5::inet, $6, $7, NOW())`, [
                rt.usuario_id, newToken, rt.family_id, expiresAt,
                ctx.ipAddress ?? null,
                ctx.userAgent ?? null,
                ctx.deviceInfo ? JSON.stringify(ctx.deviceInfo) : null,
            ]);
            logger_1.log.auth.debug({
                userId: rt.usuario_id, familyId: rt.family_id, ip: ctx.ipAddress,
            }, 'Refresh token rotado');
            return { userId: rt.usuario_id, newRefreshToken: newToken };
        });
        return result;
    }
    catch (err) {
        // Si fue TOKEN_REUSE_DETECTED, revocar familia FUERA de la TX (ya committed)
        if (err instanceof errorHandler_1.AppError && err.code === 'TOKEN_REUSE_DETECTED') {
            const anyErr = err;
            if (anyErr._familyId) {
                logger_1.log.auth.warn({
                    userId: anyErr._userId,
                    familyId: anyErr._familyId,
                }, '⚠️  REÚSO DE REFRESH TOKEN DETECTADO — revocando familia completa');
                await (0, database_1.query)(`UPDATE refresh_tokens
           SET revoked = TRUE, revoked_at = NOW(), revoke_reason = 'family_compromise'
           WHERE family_id = $1::uuid AND revoked = FALSE`, [anyErr._familyId]).catch(e => logger_1.log.auth.error({ e }, 'Error revocando familia'));
            }
        }
        throw err;
    }
}
// Revocar UN refresh token (logout de una sesión)
async function revokeRefreshToken(token, reason = 'logout') {
    await (0, database_1.query)(`UPDATE refresh_tokens
     SET revoked = TRUE, revoked_at = NOW(), revoke_reason = $2
     WHERE token = $1 AND revoked = FALSE`, [token, reason]);
}
// Revocar TODOS los refresh tokens del usuario (logout-all / cambio de contraseña)
async function revokeAllUserTokens(userId, reason = 'logout_all') {
    const result = await (0, database_1.query)(`WITH revoked AS (
       UPDATE refresh_tokens
       SET revoked = TRUE, revoked_at = NOW(), revoke_reason = $2
       WHERE usuario_id = $1 AND revoked = FALSE
       RETURNING id
     ) SELECT COUNT(*)::text AS count FROM revoked`, [userId, reason]);
    const count = parseInt(result[0]?.count ?? '0', 10);
    if (count > 0) {
        logger_1.log.auth.info({ userId, count, reason }, 'Sesiones revocadas');
    }
    return count;
}
async function getActiveSessions(userId) {
    const rows = await (0, database_1.query)(`SELECT id, family_id, ip_address::text, user_agent, creado_en, last_used_at, expires_at
     FROM refresh_tokens
     WHERE usuario_id = $1 AND revoked = FALSE AND expires_at > NOW()
     ORDER BY last_used_at DESC`, [userId]);
    return rows.map(r => ({
        id: r.id,
        familyId: r.family_id,
        ipAddress: r.ip_address,
        userAgent: r.user_agent?.slice(0, 60) ?? null,
        createdAt: r.creado_en,
        lastUsedAt: r.last_used_at,
        expiresAt: r.expires_at,
    }));
}
async function revokeSession(sessionId, userId) {
    const result = await (0, database_1.query)(`UPDATE refresh_tokens
     SET revoked = TRUE, revoked_at = NOW(), revoke_reason = 'session_revoked_by_user'
     WHERE id = $1 AND usuario_id = $2 AND revoked = FALSE
     RETURNING id`, [sessionId, userId]);
    return result.length > 0;
}
// ══════════════════════════════════════════════════════════
// MANTENIMIENTO — purgar tokens viejos
// ══════════════════════════════════════════════════════════
async function purgeExpiredTokens() {
    const [rt, bl] = await Promise.all([
        // Purgar refresh tokens revocados hace más de 30 días (conservar para auditoría)
        (0, database_1.query)(`WITH deleted AS (
         DELETE FROM refresh_tokens
         WHERE (expires_at < NOW() - INTERVAL '1 day')
            OR (revoked = TRUE AND revoked_at < NOW() - INTERVAL '30 days')
         RETURNING id
       ) SELECT COUNT(*)::text AS count FROM deleted`),
        // Purgar blacklist de access tokens ya expirados
        (0, database_1.query)(`WITH deleted AS (
         DELETE FROM token_blacklist WHERE expires_at < NOW() RETURNING jti
       ) SELECT COUNT(*)::text AS count FROM deleted`),
    ]);
    const refreshTokens = parseInt(rt[0]?.count ?? '0');
    const blacklistEntries = parseInt(bl[0]?.count ?? '0');
    if (refreshTokens > 0 || blacklistEntries > 0) {
        logger_1.log.auth.info({ refreshTokens, blacklistEntries }, 'Tokens expirados purgados');
    }
    return { refreshTokens, blacklistEntries };
}
// ── Construir par de tokens (helper para controllers) ─────
async function buildTokenPair(userId, email, rol, ctx = {}, extras) {
    const accessToken = signAccessToken({
        sub: userId,
        email,
        rol,
        ...(extras?.inspectorId ? { inspectorId: extras.inspectorId } : {}),
        ...(extras?.tallerAliadoId ? { tallerAliadoId: extras.tallerAliadoId } : {}),
        ...(extras?.tallerNombre ? { tallerNombre: extras.tallerNombre } : {}),
    });
    const refreshToken = await issueRefreshToken(userId, ctx);
    return {
        accessToken,
        refreshToken,
        expiresIn: ACCESS_EXPIRY_SEC,
        tokenType: 'Bearer',
    };
}
/**
 * Construir un par de tokens para un inspector, incluyendo
 * automáticamente el inspectorId y tallerAliadoId en el JWT.
 */
async function buildTokenPairInspector(userId, email, ctx = {}) {
    const { query: dbQuery, queryOne: dbQueryOne } = await import('./jwt.service').then(() => import('../config/database'));
    // Leer perfil del inspector para incluir en el token
    const insp = await dbQueryOne(`SELECT i.id, i.taller_aliado_id, ta.nombre AS taller_nombre,
            i.activo, (i.activo AND ta.habilitado AND ta.activo) AS habilitado
     FROM inspectores i JOIN talleres_aliados ta ON ta.id=i.taller_aliado_id
     WHERE i.usuario_id=$1`, [userId]);
    if (!insp)
        throw Object.assign(new Error('Sin perfil de inspector'), { code: 'NO_INSPECTOR_PROFILE', status: 403 });
    if (!insp.activo)
        throw Object.assign(new Error('Inspector inactivo'), { code: 'INSPECTOR_INACTIVE', status: 403 });
    return buildTokenPair(userId, email, 'INSPECTOR', ctx, {
        inspectorId: insp.id,
        tallerAliadoId: insp.taller_aliado_id,
        tallerNombre: insp.taller_nombre,
    });
}
/**
 * Construir token para ALIADO, incluyendo el taller que gestiona.
 */
async function buildTokenPairAliado(userId, email, ctx = {}) {
    const { queryOne: dbQueryOne } = await import('../config/database');
    const taller = await dbQueryOne(`SELECT id, nombre, habilitado, activo FROM talleres_aliados
     WHERE propietario_id=$1 AND activo=TRUE LIMIT 1`, [userId]);
    if (!taller)
        throw Object.assign(new Error('Sin taller aliado vinculado'), { code: 'NO_TALLER_ALIADO', status: 403 });
    return buildTokenPair(userId, email, 'ALIADO', ctx, {
        tallerAliadoId: taller.id,
        tallerNombre: taller.nombre,
    });
}
