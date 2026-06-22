"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.twoFARegenerateBackup = exports.twoFADisable = exports.twoFAValidate = exports.twoFAConfirm = exports.twoFASetup = exports.twoFAStatus = void 0;
const zod_1 = require("zod");
const errorHandler_1 = require("../middleware/errorHandler");
const twofa_service_1 = require("../services/twofa.service");
const jwt_service_1 = require("../services/jwt.service");
const database_1 = require("../config/database");
const getIP = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.ip;
// GET /api/v1/auth/2fa/status
exports.twoFAStatus = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    res.json({ ok: true, data: await (0, twofa_service_1.get2FAStatus)(req.user.sub) });
});
// POST /api/v1/auth/2fa/setup
exports.twoFASetup = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const result = await (0, twofa_service_1.setup2FA)(req.user.sub, req.user.email);
    res.json({ ok: true, data: {
            qrCodeDataUrl: result.qrCodeDataUrl,
            manualEntry: result.manualEntry,
            instructions: 'Escaneá el QR con Google Authenticator o Authy. Luego confirmá con POST /auth/2fa/confirm.',
        } });
});
// POST /api/v1/auth/2fa/confirm
exports.twoFAConfirm = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const { code } = zod_1.z.object({ code: zod_1.z.string().regex(/^\d{6}$/, '6 dígitos requeridos') }).parse(req.body);
    const result = await (0, twofa_service_1.confirm2FA)(req.user.sub, code);
    res.json({ ok: true, data: {
            ...result,
            warning: '⚠️ Guardá estos códigos en un lugar seguro. Solo se muestran UNA VEZ.',
        } });
});
// POST /api/v1/auth/2fa/validate — paso 2 del login
exports.twoFAValidate = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { preauthToken, code } = zod_1.z.object({
        preauthToken: zod_1.z.string().length(64, 'Token de pre-autenticación inválido'),
        code: zod_1.z.string().min(4).max(10),
    }).parse(req.body);
    const ctx = { ipAddress: getIP(req), userAgent: req.headers['user-agent'] };
    const userId = await (0, twofa_service_1.validate2FA)(preauthToken, code, ctx);
    const u = await (0, database_1.queryOne)('SELECT email, rol, nombre, apellido FROM usuarios WHERE id=$1', [userId]);
    if (!u)
        throw new errorHandler_1.AppError('Usuario no encontrado', 404);
    const tokens = await (0, jwt_service_1.buildTokenPair)(userId, u.email, u.rol, ctx);
    res.json({ ok: true, data: {
            usuario: { id: userId, email: u.email, nombre: u.nombre, apellido: u.apellido, rol: u.rol },
            ...tokens, twoFactorVerified: true,
        } });
});
// DELETE /api/v1/auth/2fa
exports.twoFADisable = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const { code } = zod_1.z.object({ code: zod_1.z.string().regex(/^\d{6}$/, 'Código TOTP de 6 dígitos requerido') }).parse(req.body);
    await (0, twofa_service_1.disable2FA)(req.user.sub, code);
    res.json({ ok: true, data: { message: '2FA deshabilitado correctamente.' } });
});
// POST /api/v1/auth/2fa/backup/regenerate
exports.twoFARegenerateBackup = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const { code } = zod_1.z.object({ code: zod_1.z.string().regex(/^\d{6}$/) }).parse(req.body);
    const codes = await (0, twofa_service_1.regenerateBackupCodes)(req.user.sub, code);
    res.json({ ok: true, data: { backupCodes: codes, warning: '⚠️ Los códigos anteriores ya no son válidos.' } });
});
