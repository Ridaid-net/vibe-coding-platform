"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setup2FA = setup2FA;
exports.confirm2FA = confirm2FA;
exports.issuePreauthToken = issuePreauthToken;
exports.consumePreauthToken = consumePreauthToken;
exports.useBackupCode = useBackupCode;
exports.validate2FA = validate2FA;
exports.disable2FA = disable2FA;
exports.get2FAStatus = get2FAStatus;
exports.check2FARequired = check2FARequired;
exports.regenerateBackupCodes = regenerateBackupCodes;
exports.purge2FAData = purge2FAData;
// ─── RODAID · Servicio 2FA (TOTP) para Inspectores ───────
const otplib_1 = require("otplib");
const qrcode_1 = __importDefault(require("qrcode"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const errorHandler_1 = require("../middleware/errorHandler");
const logger_1 = require("../middleware/logger");
const ISSUER = 'RODAID';
const BACKUP_CODE_COUNT = 8;
const PREAUTH_TTL_MIN = 5;
const TOTP_PERIOD = 30;
// ── Setup ──────────────────────────────────────────────────
async function setup2FA(userId, email) {
    const u = await (0, database_1.queryOne)('SELECT totp_habilitado FROM usuarios WHERE id=$1', [userId]);
    if (u?.totp_habilitado)
        throw new errorHandler_1.AppError('El 2FA ya está habilitado. Deshabilitalo primero.', 409, 'TOTP_ALREADY_ENABLED');
    const secret = (0, otplib_1.generateSecret)();
    await (0, database_1.query)('UPDATE usuarios SET totp_secret=$2, totp_habilitado=FALSE, actualizado_en=NOW() WHERE id=$1', [userId, secret]);
    const otpauthUrl = (0, otplib_1.generateURI)({ secret, label: email, issuer: ISSUER });
    const qrCodeDataUrl = await qrcode_1.default.toDataURL(otpauthUrl, { width: 256, margin: 2, color: { dark: '#0F1E35', light: '#FFFFFF' } });
    logger_1.log.auth.info({ userId }, '2FA setup iniciado');
    return { secret, otpauthUrl, qrCodeDataUrl, manualEntry: { secret, account: email, issuer: ISSUER } };
}
// ── Validar código TOTP ────────────────────────────────────
async function validateTOTP(code, secret, userId) {
    const clean = code.replace(/[\s-]/g, '');
    if (!/^\d{6}$/.test(clean))
        throw new errorHandler_1.AppError('El código debe tener 6 dígitos', 400, 'TOTP_FORMAT_INVALID');
    const result = await (0, otplib_1.verify)({ token: clean, secret });
    if (!result.valid)
        throw new errorHandler_1.AppError('Código 2FA incorrecto. Verificá que la hora de tu dispositivo esté sincronizada.', 401, 'TOTP_INVALID');
    // Anti-replay: mismo período → rechazar
    const epoch = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
    const row = await (0, database_1.queryOne)('SELECT totp_ultimo_uso FROM usuarios WHERE id=$1', [userId]);
    if (row?.totp_ultimo_uso) {
        const last = Math.floor(new Date(row.totp_ultimo_uso).getTime() / 1000 / TOTP_PERIOD);
        if (last >= epoch - 1)
            throw new errorHandler_1.AppError('Código ya utilizado. Esperá el siguiente período (30s).', 401, 'TOTP_REPLAY');
    }
    await (0, database_1.query)('UPDATE usuarios SET totp_ultimo_uso=NOW() WHERE id=$1', [userId]);
}
// ── Confirmar y activar ────────────────────────────────────
async function confirm2FA(userId, code) {
    const u = await (0, database_1.queryOne)('SELECT totp_secret, totp_habilitado FROM usuarios WHERE id=$1', [userId]);
    if (!u?.totp_secret)
        throw new errorHandler_1.AppError('Primero iniciá la configuración con POST /auth/2fa/setup', 400, 'TOTP_NOT_SETUP');
    if (u.totp_habilitado)
        throw new errorHandler_1.AppError('El 2FA ya está habilitado', 409, 'TOTP_ALREADY_ENABLED');
    await validateTOTP(code, u.totp_secret, userId);
    await (0, database_1.query)('UPDATE usuarios SET totp_habilitado=TRUE, totp_habilitado_en=NOW(), actualizado_en=NOW() WHERE id=$1', [userId]);
    const backupCodes = await generateBackupCodes(userId);
    logger_1.log.auth.info({ userId }, '2FA activado');
    return { enabled: true, backupCodes, enabledAt: new Date().toISOString() };
}
// ── Pre-auth token ─────────────────────────────────────────
async function issuePreauthToken(userId, ipAddress) {
    const token = crypto_1.default.randomBytes(32).toString('hex');
    const tokenHash = await bcryptjs_1.default.hash(token, 8);
    await (0, database_1.query)('INSERT INTO preauth_tokens (usuario_id, token_hash, expires_at, ip_address) VALUES ($1,$2,NOW()+INTERVAL \'5 minutes\',$3::inet)', [userId, tokenHash, ipAddress ?? null]);
    return token;
}
async function consumePreauthToken(rawToken) {
    const rows = await (0, database_1.query)('SELECT id, usuario_id, token_hash FROM preauth_tokens WHERE expires_at>NOW() AND NOT usado ORDER BY creado_en DESC LIMIT 20');
    for (const row of rows) {
        if (await bcryptjs_1.default.compare(rawToken, row.token_hash)) {
            await (0, database_1.query)('UPDATE preauth_tokens SET usado=TRUE WHERE id=$1', [row.id]);
            return row.usuario_id;
        }
    }
    throw new errorHandler_1.AppError('Token de pre-autenticación inválido o expirado. Iniciá sesión nuevamente.', 401, 'PREAUTH_TOKEN_INVALID');
}
// ── Backup codes ───────────────────────────────────────────
async function generateBackupCodes(userId) {
    await (0, database_1.query)('DELETE FROM totp_backup_codes WHERE usuario_id=$1', [userId]);
    const codes = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
        const raw = crypto_1.default.randomBytes(4).toString('hex').toUpperCase();
        const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
        codes.push(code);
        await (0, database_1.query)('INSERT INTO totp_backup_codes (usuario_id, code_hash) VALUES ($1,$2)', [userId, await bcryptjs_1.default.hash(code.replace('-', ''), 10)]);
    }
    return codes;
}
async function useBackupCode(userId, rawCode) {
    const normalized = rawCode.replace(/[-\s]/g, '').toUpperCase();
    const rows = await (0, database_1.query)('SELECT id, code_hash FROM totp_backup_codes WHERE usuario_id=$1 AND NOT usado ORDER BY creado_en', [userId]);
    for (const row of rows) {
        if (await bcryptjs_1.default.compare(normalized, row.code_hash)) {
            await (0, database_1.query)('UPDATE totp_backup_codes SET usado=TRUE, usado_en=NOW() WHERE id=$1', [row.id]);
            const remaining = rows.length - 1;
            logger_1.log.auth.warn({ userId, remaining }, '2FA: código de respaldo utilizado');
            return;
        }
    }
    throw new errorHandler_1.AppError('Código de respaldo inválido o ya utilizado.', 401, 'BACKUP_CODE_INVALID');
}
// ── Validate (login 2FA) ───────────────────────────────────
async function validate2FA(preauthToken, code, ctx = {}) {
    const userId = await consumePreauthToken(preauthToken);
    // Puede ser TOTP o backup code
    const u = await (0, database_1.queryOne)('SELECT totp_secret, totp_habilitado, email, rol FROM usuarios WHERE id=$1 AND activo=TRUE', [userId]);
    if (!u)
        throw new errorHandler_1.AppError('Usuario no encontrado', 404);
    if (!u.totp_habilitado || !u.totp_secret)
        throw new errorHandler_1.AppError('2FA no está habilitado', 400, 'TOTP_NOT_ENABLED');
    // Intentar como TOTP primero, luego como backup code
    try {
        await validateTOTP(code, u.totp_secret, userId);
    }
    catch (totpErr) {
        // Si el código tiene formato de backup (XXXX-XXXX o XXXXXXXX), intentar como backup
        const isBackupFormat = /^[A-F0-9]{4}-?[A-F0-9]{4}$/i.test(code.trim());
        if (isBackupFormat) {
            await useBackupCode(userId, code);
        }
        else {
            throw totpErr;
        }
    }
    const { buildTokenPair } = await import('./jwt.service');
    const tokens = await buildTokenPair(userId, u.email, u.rol, ctx);
    logger_1.log.auth.info({ userId, rol: u.rol }, '2FA validado — JWT emitido');
    return userId; // el caller construye la respuesta con tokens
}
// ── Disable ────────────────────────────────────────────────
async function disable2FA(userId, code) {
    const u = await (0, database_1.queryOne)('SELECT totp_secret, totp_habilitado FROM usuarios WHERE id=$1', [userId]);
    if (!u?.totp_habilitado || !u.totp_secret)
        throw new errorHandler_1.AppError('El 2FA no está habilitado.', 400, 'TOTP_NOT_ENABLED');
    await validateTOTP(code, u.totp_secret, userId);
    await (0, database_1.query)('UPDATE usuarios SET totp_secret=NULL, totp_habilitado=FALSE, totp_habilitado_en=NULL, actualizado_en=NOW() WHERE id=$1', [userId]);
    await (0, database_1.query)('DELETE FROM totp_backup_codes WHERE usuario_id=$1', [userId]);
    logger_1.log.auth.info({ userId }, '2FA deshabilitado');
}
// ── Status ─────────────────────────────────────────────────
async function get2FAStatus(userId) {
    const row = await (0, database_1.queryOne)('SELECT totp_habilitado, totp_habilitado_en FROM usuarios WHERE id=$1', [userId]);
    const rem = await (0, database_1.queryOne)('SELECT COUNT(*)::text AS count FROM totp_backup_codes WHERE usuario_id=$1 AND NOT usado', [userId]);
    return { enabled: row?.totp_habilitado ?? false, enabledAt: row?.totp_habilitado_en?.toISOString() ?? null, backupCodesRemaining: parseInt(rem?.count ?? '0') };
}
// ── Require 2FA check ──────────────────────────────────────
async function check2FARequired(userId, rol) {
    if (rol !== 'INSPECTOR')
        return { required: false, enabled: false };
    const s = await get2FAStatus(userId);
    return { required: true, enabled: s.enabled };
}
// ── Regenerar backup codes ────────────────────────────────
async function regenerateBackupCodes(userId, code) {
    const u = await (0, database_1.queryOne)('SELECT totp_secret, totp_habilitado FROM usuarios WHERE id=$1', [userId]);
    if (!u?.totp_habilitado || !u.totp_secret)
        throw new errorHandler_1.AppError('El 2FA no está habilitado.', 400, 'TOTP_NOT_ENABLED');
    await validateTOTP(code, u.totp_secret, userId);
    const codes = await generateBackupCodes(userId);
    logger_1.log.auth.info({ userId }, '2FA: backup codes regenerados');
    return codes;
}
// ── Purgar tokens viejos ───────────────────────────────────
async function purge2FAData() {
    const r = await (0, database_1.query)(`WITH d AS (DELETE FROM preauth_tokens WHERE expires_at<NOW() OR (usado AND creado_en<NOW()-INTERVAL '7 days') RETURNING id) SELECT COUNT(*)::text AS count FROM d`);
    return { preauthTokens: parseInt(r[0]?.count ?? '0') };
}
