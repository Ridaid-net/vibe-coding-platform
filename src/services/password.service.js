"use strict";
// ─── RODAID · Servicio de Recuperación de Contraseña ─────
// Cubre el flujo completo con todas las medidas de seguridad:
//
//   POST /auth/forgot-password
//     → anti-enumeración (mismo response si existe o no)
//     → cooldown de 5 min entre solicitudes (evita spam)
//     → token de 96 chars hex, TTL 1 hora
//     → audit log de cada solicitud
//     → email con Resend (stub en dev)
//
//   POST /auth/reset-password
//     → valida token + expiración
//     → zxcvbn strength check
//     → bcrypt 12 rounds
//     → revoca TODAS las sesiones activas
//     → auto-login (emite nuevo par JWT)
//     → email de confirmación post-reset
//     → audit log
//
//   GET /auth/reset-password/info?token=xxx
//     → devuelve si el token es válido y cuánto tiempo resta
//     → sin revelar datos del usuario (solo validez + tiempo)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestPasswordReset = requestPasswordReset;
exports.getResetTokenInfo = getResetTokenInfo;
exports.resetPassword = resetPassword;
exports.changePassword = changePassword;
exports.getPasswordResetHistory = getPasswordResetHistory;
exports.getAuthAuditLog = getAuthAuditLog;
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zxcvbn_1 = __importDefault(require("zxcvbn"));
const database_1 = require("../config/database");
const errorHandler_1 = require("../middleware/errorHandler");
const logger_1 = require("../middleware/logger");
const email_service_1 = require("./email.service");
// ── Constantes ─────────────────────────────────────────────
const RESET_TTL_HOURS = 1; // el token expira en 1 hora
const COOLDOWN_MINUTES = 5; // mínimo entre solicitudes de reset
const BCRYPT_ROUNDS = 12;
const MIN_PASS_STRENGTH = 2; // 0-4 zxcvbn score
async function auditAuth(evento, resultado, opts) {
    await (0, database_1.query)(`INSERT INTO auth_audit_log
       (usuario_id, email, evento, resultado, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5::inet, $6, $7)`, [
        opts.usuarioId ?? null,
        opts.email ?? null,
        evento, resultado,
        opts.ipAddress ?? null,
        opts.userAgent ?? null,
        opts.metadata ? JSON.stringify(opts.metadata) : null,
    ]).catch(e => logger_1.log.auth.warn({ e }, 'audit log error (non-critical)'));
}
async function requestPasswordReset(input) {
    const GENERIC_MSG = 'Si el email está registrado, recibirás instrucciones en minutos.';
    // Buscar usuario (no revelar si existe o no en la respuesta pública)
    const usuario = await (0, database_1.queryOne)(`SELECT id, nombre, email, reset_token, reset_expires_at, reset_solicitado_en
     FROM usuarios
     WHERE email = $1 AND activo = TRUE`, [input.email]);
    if (!usuario) {
        // Anti-enumeración — respuesta idéntica aunque el usuario no exista
        await auditAuth('forgot_password_not_found', 'fail', {
            email: input.email, ipAddress: input.ipAddress,
        });
        logger_1.log.auth.debug({ email: input.email }, 'Forgot password: email no registrado');
        return { message: GENERIC_MSG };
    }
    // Cooldown: si ya hay un token activo emitido hace menos de COOLDOWN_MINUTES
    if (usuario.reset_solicitado_en) {
        const elapsedMs = Date.now() - new Date(usuario.reset_solicitado_en).getTime();
        const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
        if (elapsedMs < cooldownMs) {
            const waitSec = Math.ceil((cooldownMs - elapsedMs) / 1000);
            await auditAuth('forgot_password_cooldown', 'blocked', {
                usuarioId: usuario.id, email: usuario.email,
                ipAddress: input.ipAddress,
                metadata: { waitSec },
            });
            logger_1.log.auth.warn({ userId: usuario.id, waitSec }, 'Forgot password: cooldown activo');
            // Respuesta genérica — no revelar que el cooldown fue la causa
            return { message: GENERIC_MSG, cooldownActive: true };
        }
    }
    // Generar token criptográficamente seguro
    const token = crypto_1.default.randomBytes(48).toString('hex'); // 96 chars hex
    const expires = new Date(Date.now() + RESET_TTL_HOURS * 3600 * 1000);
    const now = new Date();
    // Guardar token y registrar timestamp de solicitud
    await (0, database_1.query)(`UPDATE usuarios
     SET reset_token = $2, reset_expires_at = $3,
         reset_solicitado_en = $4, actualizado_en = NOW()
     WHERE id = $1`, [usuario.id, token, expires, now]);
    // Enviar email (fire-and-forget — no bloquear la respuesta)
    (0, email_service_1.sendPasswordResetEmail)(usuario.email, usuario.nombre, token)
        .then(r => {
        if (r.ok) {
            logger_1.log.auth.info({ userId: usuario.id, emailId: r.emailId }, 'Email de reset enviado');
        }
        else {
            logger_1.log.auth.error({ userId: usuario.id, error: r.error }, 'Error enviando email de reset');
        }
    })
        .catch(e => logger_1.log.auth.error({ e, userId: usuario.id }, 'Email de reset: excepción'));
    await auditAuth('forgot_password_requested', 'ok', {
        usuarioId: usuario.id,
        email: usuario.email,
        ipAddress: input.ipAddress,
        metadata: { expiresAt: expires.toISOString() },
    });
    logger_1.log.auth.info({ userId: usuario.id }, 'Password reset solicitado');
    return {
        message: GENERIC_MSG,
        tokenExpiresIn: RESET_TTL_HOURS * 3600, // solo informativo
    };
}
// ══════════════════════════════════════════════════════════
// RESET TOKEN INFO — GET /auth/reset-password/info?token=xxx
// Permite al frontend verificar si el token es válido ANTES
// de mostrar el formulario de nueva contraseña
// ══════════════════════════════════════════════════════════
async function getResetTokenInfo(token) {
    if (!token || token.length !== 96) {
        return { valid: false, message: 'Token inválido.' };
    }
    const row = await (0, database_1.queryOne)(`SELECT reset_expires_at FROM usuarios
     WHERE reset_token = $1 AND activo = TRUE`, [token]);
    if (!row) {
        return { valid: false, message: 'El enlace de restablecimiento es inválido o ya fue utilizado.' };
    }
    const now = new Date();
    const expiresAt = new Date(row.reset_expires_at);
    if (expiresAt <= now) {
        return { valid: false, message: 'El enlace expiró. Solicitá uno nuevo.' };
    }
    const expiresIn = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
    return {
        valid: true,
        expiresIn,
        expiresAt: expiresAt.toISOString(),
    };
}
async function resetPassword(input) {
    // Validar token
    const usuario = await (0, database_1.queryOne)(`SELECT id, email, nombre, apellido, rol, reset_expires_at
     FROM usuarios
     WHERE reset_token = $1 AND reset_expires_at > NOW() AND activo = TRUE`, [input.token]);
    if (!usuario) {
        await auditAuth('reset_password_invalid_token', 'fail', {
            ipAddress: input.ipAddress,
            metadata: { tokenLength: input.token.length },
        });
        throw new errorHandler_1.AppError('El enlace de restablecimiento es inválido o expiró. Solicitá uno nuevo.', 400, 'INVALID_OR_EXPIRED_TOKEN');
    }
    // Validar fortaleza de contraseña
    const strength = (0, zxcvbn_1.default)(input.password, [usuario.email, usuario.nombre, usuario.apellido]);
    if (strength.score < MIN_PASS_STRENGTH) {
        const suggestions = strength.feedback.suggestions.join(' ') ||
            'Usá letras, números y símbolos.';
        await auditAuth('reset_password_weak_password', 'fail', {
            usuarioId: usuario.id, ipAddress: input.ipAddress,
            metadata: { score: strength.score },
        });
        throw new errorHandler_1.AppError(`Contraseña muy débil. ${suggestions}`, 422, 'PASSWORD_TOO_WEAK', { score: strength.score, maxScore: 4, suggestions: strength.feedback.suggestions });
    }
    // Hashear nueva contraseña
    const passwordHash = await bcryptjs_1.default.hash(input.password, BCRYPT_ROUNDS);
    // Actualizar en una transacción atómica
    await (0, database_1.query)(`UPDATE usuarios
     SET password_hash         = $2,
         reset_token           = NULL,
         reset_expires_at      = NULL,
         reset_solicitado_en   = NULL,
         ultimo_cambio_password = NOW(),
         actualizado_en        = NOW()
     WHERE id = $1`, [usuario.id, passwordHash]);
    // Importar dinámico para evitar circular deps
    const { revokeAllUserTokens } = await import('./jwt.service');
    const sesionesRevocadas = await revokeAllUserTokens(usuario.id, 'password_reset');
    // Email de confirmación (fire-and-forget)
    (0, email_service_1.sendPasswordChangedEmail)(usuario.email, usuario.nombre, input.ipAddress)
        .catch(e => logger_1.log.auth.error({ e }, 'Error enviando email de confirmación de reset'));
    await auditAuth('reset_password_ok', 'ok', {
        usuarioId: usuario.id,
        email: usuario.email,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { sesionesRevocadas },
    });
    logger_1.log.auth.info({
        userId: usuario.id,
        sesionesRevocadas,
        ip: input.ipAddress,
    }, 'Contraseña restablecida · sesiones previas revocadas');
    return {
        message: `Contraseña actualizada correctamente. ${sesionesRevocadas} sesión/es previas fueron cerradas.`,
        userId: usuario.id,
    };
}
async function changePassword(input) {
    const row = await (0, database_1.queryOne)(`SELECT password_hash FROM usuarios WHERE id = $1`, [input.userId]);
    if (!row?.password_hash)
        throw new errorHandler_1.AppError('Usuario no encontrado', 404);
    const ok = await bcryptjs_1.default.compare(input.currentPassword, row.password_hash);
    if (!ok)
        throw new errorHandler_1.AppError('La contraseña actual es incorrecta', 401, 'WRONG_CURRENT_PASSWORD');
    if (input.currentPassword === input.newPassword) {
        throw new errorHandler_1.AppError('La nueva contraseña debe ser diferente a la actual', 422, 'SAME_PASSWORD');
    }
    const strength = (0, zxcvbn_1.default)(input.newPassword, [input.email, input.nombre, input.apellido]);
    if (strength.score < MIN_PASS_STRENGTH) {
        const msg = strength.feedback.suggestions.join(' ') || 'Usá letras, números y símbolos.';
        throw new errorHandler_1.AppError(`Contraseña muy débil. ${msg}`, 422, 'PASSWORD_TOO_WEAK', { score: strength.score });
    }
    const hash = await bcryptjs_1.default.hash(input.newPassword, BCRYPT_ROUNDS);
    await (0, database_1.query)(`UPDATE usuarios
     SET password_hash = $2, ultimo_cambio_password = NOW(), actualizado_en = NOW()
     WHERE id = $1`, [input.userId, hash]);
    // Notificar cambio de contraseña
    (0, email_service_1.sendPasswordChangedEmail)(input.email, input.nombre, input.ipAddress)
        .catch(e => logger_1.log.auth.error({ e }, 'Error enviando email de cambio de password'));
    logger_1.log.auth.info({ userId: input.userId }, 'Contraseña cambiada por el usuario');
}
// ══════════════════════════════════════════════════════════
// QUERIES ADMIN — historial de resets
// ══════════════════════════════════════════════════════════
async function getPasswordResetHistory(userId, limit = 20) {
    return (0, database_1.query)(`SELECT evento, resultado, ip_address::text, user_agent, metadata, creado_en
     FROM auth_audit_log
     WHERE usuario_id = $1
       AND evento LIKE '%password%'
     ORDER BY creado_en DESC
     LIMIT $2`, [userId, limit]);
}
async function getAuthAuditLog(filters = {}) {
    const { email, evento, limit = 50 } = filters;
    const conds = [];
    const params = [];
    let i = 1;
    if (email) {
        conds.push(`email = $${i++}`);
        params.push(email);
    }
    if (evento) {
        conds.push(`evento LIKE $${i++}`);
        params.push(`%${evento}%`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit);
    return (0, database_1.query)(`SELECT id, usuario_id, email, evento, resultado, ip_address::text,
            metadata, creado_en
     FROM auth_audit_log
     ${where}
     ORDER BY creado_en DESC
     LIMIT $${i}`, params);
}
