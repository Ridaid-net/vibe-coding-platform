"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSession = exports.getSessions = exports.passwordHistory = exports.mxmAuditLog = exports.mxmDesconectar = exports.mxmStatus = exports.mxmCallback = exports.mxmAuthorize = exports.me = exports.logoutAll = exports.logout = exports.refresh = exports.changePassword = exports.resetPassword = exports.resetTokenInfo = exports.forgotPassword = exports.login = exports.resendVerification = exports.verifyEmail = exports.register = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const mxm_circuit_service_1 = require("../services/mxm.circuit.service");
const zod_1 = require("zod");
const zxcvbn_1 = __importDefault(require("zxcvbn"));
const database_1 = require("../config/database");
const errorHandler_1 = require("../middleware/errorHandler");
const logger_1 = require("../middleware/logger");
const twofa_service_1 = require("../services/twofa.service");
const session_service_1 = require("../services/session.service");
const jwt_service_1 = require("../services/jwt.service");
const email_service_1 = require("../services/email.service");
const mxm_service_1 = require("../services/mxm.service");
const password_service_1 = require("../services/password.service");
// ── Constantes ────────────────────────────────────────────
const VERIFICATION_TTL_HOURS = 24;
const ACCESS_EXPIRY_SEC = (() => { const s = process.env.JWT_ACCESS_EXPIRES ?? '15m'; const n = parseInt(s); if (s.endsWith('m'))
    return n * 60; if (s.endsWith('h'))
    return n * 3600; if (s.endsWith('d'))
    return n * 86400; return 900; })();
const RESET_TTL_HOURS = 1;
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_STRENGTH = 2; // 0-4 (zxcvbn) — 2=fair
// ── Schemas ───────────────────────────────────────────────
const registerSchema = zod_1.z.object({
    email: zod_1.z.string().email('Email inválido').toLowerCase(),
    password: zod_1.z.string().min(8, 'Mínimo 8 caracteres').max(128),
    nombre: zod_1.z.string().min(2, 'Nombre requerido').max(100).trim(),
    apellido: zod_1.z.string().min(2, 'Apellido requerido').max(100).trim(),
    telefono: zod_1.z.string().max(30).optional(),
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email().toLowerCase(),
    password: zod_1.z.string().min(1),
});
const forgotPasswordSchema = zod_1.z.object({
    email: zod_1.z.string().email().toLowerCase(),
});
const resetPasswordSchema = zod_1.z.object({
    token: zod_1.z.string().min(32, 'Token inválido'),
    password: zod_1.z.string().min(8, 'Mínimo 8 caracteres').max(128),
});
const changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1),
    newPassword: zod_1.z.string().min(8).max(128),
});
function expiresInSeconds() {
    const s = process.env.JWT_ACCESS_EXPIRES ?? '15m';
    const n = parseInt(s);
    if (s.endsWith('m'))
        return n * 60;
    if (s.endsWith('h'))
        return n * 3600;
    if (s.endsWith('d'))
        return n * 86400;
    return 900;
}
async function buildTokens(userId, email, rol, ctx = {}, opts = {}) {
    // 1. Crear entrada en Redis (y opcionalmente en PG via session.service)
    const session = await (0, session_service_1.createSession)({
        userId, email, rol,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        rememberMe: opts.rememberMe,
    });
    // 2. Emitir refresh token PG con claims de rol (inspector_id, taller_id)
    const jwtSvc = await import('../services/jwt.service');
    let tokens;
    if (rol === 'INSPECTOR') {
        try {
            tokens = await jwtSvc.buildTokenPairInspector(userId, email, ctx);
        }
        catch {
            // Si no tiene perfil de inspector todavía, emitir token genérico
            tokens = await jwtSvc.buildTokenPair(userId, email, 'INSPECTOR', ctx);
        }
    }
    else if (rol === 'ALIADO') {
        try {
            tokens = await jwtSvc.buildTokenPairAliado(userId, email, ctx);
        }
        catch {
            tokens = await jwtSvc.buildTokenPair(userId, email, 'ALIADO', ctx);
        }
    }
    else {
        tokens = await jwtSvc.buildTokenPair(userId, email, rol, ctx);
    }
    return {
        ...tokens,
        sessionId: session.sessionId,
    };
}
function getSessionCtx(req) {
    return {
        ipAddress: req.ip ?? req.headers['x-forwarded-for']?.split(',')[0]?.trim(),
        userAgent: req.headers['user-agent']?.slice(0, 255),
    };
}
function generateToken(bytes = 48) {
    return crypto_1.default.randomBytes(bytes).toString('hex');
}
// Validar fortaleza de contraseña con zxcvbn
function validatePasswordStrength(password, userInputs = []) {
    const result = (0, zxcvbn_1.default)(password, userInputs);
    if (result.score < MIN_PASSWORD_STRENGTH) {
        const feedback = result.feedback.suggestions.join(' ') ||
            'Usá una combinación de letras, números y símbolos.';
        throw new errorHandler_1.AppError(`Contraseña muy débil. ${feedback}`, 422, 'PASSWORD_TOO_WEAK', { score: result.score, maxScore: 4, suggestions: result.feedback.suggestions });
    }
}
// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/register
// ══════════════════════════════════════════════════════════
exports.register = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const data = registerSchema.parse(req.body);
    // 1. Verificar email único
    const existe = await (0, database_1.queryOne)(`SELECT id FROM usuarios WHERE email = $1`, [data.email]);
    if (existe)
        throw new errorHandler_1.AppError('El email ya está registrado', 409, 'EMAIL_TAKEN');
    // 2. Validar fortaleza de contraseña
    validatePasswordStrength(data.password, [data.email, data.nombre, data.apellido]);
    // 3. Hash de contraseña
    const passwordHash = await bcryptjs_1.default.hash(data.password, BCRYPT_ROUNDS);
    // 4. Token de verificación (48 bytes hex = 96 chars)
    const verificationToken = generateToken(48);
    const verificationExpires = new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600 * 1000);
    // 5. Obtener plan libre
    const plan = await (0, database_1.queryOne)(`SELECT id FROM planes WHERE nombre = 'libre'`);
    // 6. Crear usuario (sin verificar)
    const rows = await (0, database_1.query)(`INSERT INTO usuarios
       (email, password_hash, nombre, apellido, telefono, rol, plan_id,
        email_verificado, verificacion_token, verificacion_expires_at)
     VALUES ($1,$2,$3,$4,$5,'CICLISTA',$6,FALSE,$7,$8)
     RETURNING id, email, nombre, apellido, rol`, [data.email, passwordHash, data.nombre, data.apellido,
        data.telefono ?? null, plan?.id ?? null,
        verificationToken, verificationExpires]);
    const usuario = rows[0];
    // 7. Enviar email de verificación (no bloquea la respuesta si falla)
    (0, email_service_1.sendVerificationEmail)(usuario.email, usuario.nombre, verificationToken)
        .catch(err => logger_1.log.auth.error({ err, userId: usuario.id }, 'Error enviando email de verificación'));
    logger_1.log.auth.info({ userId: usuario.id, email: usuario.email }, 'Usuario registrado · pendiente verificación');
    res.status(201).json({
        ok: true,
        data: {
            usuario: {
                id: usuario.id,
                email: usuario.email,
                nombre: usuario.nombre,
                apellido: usuario.apellido,
                rol: usuario.rol,
                emailVerificado: false,
            },
            message: 'Registro exitoso. Revisá tu email para verificar tu cuenta.',
            nextStep: 'verify-email',
        },
    });
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/auth/verify-email?token=xxx
// ══════════════════════════════════════════════════════════
exports.verifyEmail = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { token } = zod_1.z.object({
        token: zod_1.z.string().min(32, 'Token inválido'),
    }).parse(req.query);
    // 1. Buscar usuario por token (no expirado)
    const usuario = await (0, database_1.queryOne)(`SELECT id, nombre, email, email_verificado
     FROM usuarios
     WHERE verificacion_token = $1
       AND verificacion_expires_at > NOW()
       AND activo = TRUE`, [token]);
    if (!usuario) {
        throw new errorHandler_1.AppError('El enlace de verificación es inválido o expiró. Solicitá uno nuevo.', 400, 'INVALID_OR_EXPIRED_TOKEN');
    }
    if (usuario.email_verificado) {
        // Ya estaba verificado — devolver tokens igualmente
        const tokens = await buildTokens(usuario.id, usuario.email, 'CICLISTA', getSessionCtx(req));
        return res.json({
            ok: true,
            data: { message: 'Tu cuenta ya estaba verificada.', ...tokens },
        });
    }
    // 2. Marcar como verificado y limpiar el token
    await (0, database_1.query)(`UPDATE usuarios
     SET email_verificado        = TRUE,
         email_verificado_en     = NOW(),
         verificacion_token      = NULL,
         verificacion_expires_at = NULL,
         actualizado_en          = NOW()
     WHERE id = $1`, [usuario.id]);
    // 3. Emitir tokens JWT para auto-login
    const tokens = await buildTokens(usuario.id, usuario.email, 'CICLISTA', getSessionCtx(req));
    // 4. Email de bienvenida (fire-and-forget)
    (0, email_service_1.sendWelcomeEmail)(usuario.email, usuario.nombre)
        .catch(err => logger_1.log.auth.error({ err }, 'Error enviando email de bienvenida'));
    logger_1.log.auth.info({ userId: usuario.id }, 'Email verificado · cuenta activada');
    res.json({
        ok: true,
        data: {
            message: '¡Cuenta verificada exitosamente! Bienvenido/a a RODAID.',
            emailVerificado: true,
            ...tokens,
        },
    });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/resend-verification
// ══════════════════════════════════════════════════════════
exports.resendVerification = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { email } = zod_1.z.object({ email: zod_1.z.string().email().toLowerCase() }).parse(req.body);
    const usuario = await (0, database_1.queryOne)(`SELECT id, nombre, email_verificado
     FROM usuarios WHERE email = $1 AND activo = TRUE`, [email]);
    // Responder siempre con éxito (evitar enumeración de emails)
    if (!usuario || usuario.email_verificado) {
        return res.json({
            ok: true,
            data: { message: 'Si el email existe y no está verificado, recibirás un nuevo enlace en minutos.' },
        });
    }
    const token = generateToken(48);
    const expires = new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600 * 1000);
    await (0, database_1.query)(`UPDATE usuarios
     SET verificacion_token = $2, verificacion_expires_at = $3, actualizado_en = NOW()
     WHERE id = $1`, [usuario.id, token, expires]);
    await (0, email_service_1.sendVerificationEmail)(email, usuario.nombre, token);
    logger_1.log.auth.info({ userId: usuario.id }, 'Email de verificación reenviado');
    res.json({
        ok: true,
        data: { message: 'Nuevo enlace de verificación enviado. Revisá tu bandeja de entrada.' },
    });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/login
// ══════════════════════════════════════════════════════════
exports.login = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const data = loginSchema.parse(req.body);
    const usuario = await (0, database_1.queryOne)(`SELECT id, email, password_hash, nombre, apellido, rol, activo, email_verificado, email_verificado_en
     FROM usuarios WHERE email = $1`, [data.email]);
    if (!usuario?.password_hash) {
        throw new errorHandler_1.AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS');
    }
    if (!usuario.activo) {
        throw new errorHandler_1.AppError('Cuenta desactivada. Contactá a soporte@rodaid.com.ar', 403, 'ACCOUNT_DISABLED');
    }
    const ok = await bcryptjs_1.default.compare(data.password, usuario.password_hash);
    if (!ok)
        throw new errorHandler_1.AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS');
    // Verificar si el usuario tiene 2FA activo
    const twoFA = await (0, twofa_service_1.check2FARequired)(usuario.id, usuario.rol);
    if (twoFA.enabled) {
        // Emitir temp token — el cliente debe hacer POST /auth/2fa/verify
        const tempToken = await (0, twofa_service_1.issuePreauthToken)(usuario.id, getSessionCtx(req).ipAddress);
        logger_1.log.auth.info({ userId: usuario.id, rol: usuario.rol }, 'Login OK — 2FA requerido');
        return res.json({
            ok: true,
            data: {
                requires2FA: true,
                tempToken,
                expiresIn: 300, // 5 minutos
                message: 'Ingresá el código de tu app autenticadora para completar el inicio de sesión.',
            },
        });
    }
    const tokens = await buildTokens(usuario.id, usuario.email, usuario.rol, getSessionCtx(req));
    logger_1.log.auth.info({ userId: usuario.id, emailVerificado: usuario.email_verificado, ip: getSessionCtx(req).ipAddress }, 'Login exitoso');
    res.json({
        ok: true,
        data: {
            usuario: {
                id: usuario.id, email: usuario.email,
                nombre: usuario.nombre, apellido: usuario.apellido,
                rol: usuario.rol, emailVerificado: usuario.email_verificado,
            },
            ...tokens,
            ...(usuario.email_verificado ? {} : {
                warning: 'Email sin verificar. Algunas funciones pueden estar limitadas.',
                nextStep: 'verify-email',
            }),
        },
    });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/forgot-password
// ══════════════════════════════════════════════════════════
exports.forgotPassword = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    const result = await (0, password_service_1.requestPasswordReset)({
        email,
        ipAddress: getSessionCtx(req).ipAddress,
        userAgent: getSessionCtx(req).userAgent,
    });
    res.json({ ok: true, data: result });
});
// GET /api/v1/auth/reset-password/info?token=xxx — verificar validez del token
exports.resetTokenInfo = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { token } = zod_1.z.object({ token: zod_1.z.string().min(1) }).parse(req.query);
    const info = await (0, password_service_1.getResetTokenInfo)(token);
    res.json({ ok: true, data: info });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/reset-password
// ══════════════════════════════════════════════════════════
exports.resetPassword = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    const ctx = getSessionCtx(req);
    const { message, userId } = await (0, password_service_1.resetPassword)({
        token, password,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    });
    // Obtener usuario para construir los tokens
    const usuario = await (0, database_1.queryOne)('SELECT email, rol, nombre, apellido FROM usuarios WHERE id=$1', [userId]);
    if (!usuario)
        throw new errorHandler_1.AppError('Usuario no encontrado', 404);
    const tokens = await buildTokens(userId, usuario.email, usuario.rol, ctx);
    res.json({
        ok: true,
        data: {
            message,
            usuario: { id: userId, email: usuario.email, nombre: usuario.nombre, apellido: usuario.apellido, rol: usuario.rol },
            ...tokens,
        },
    });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/change-password  [Autenticado]
// ══════════════════════════════════════════════════════════
exports.changePassword = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const usuario = await (0, database_1.queryOne)('SELECT nombre, apellido, email FROM usuarios WHERE id=$1', [req.user.sub]);
    if (!usuario)
        throw new errorHandler_1.AppError('Usuario no encontrado', 404);
    await (0, password_service_1.changePassword)({
        userId: req.user.sub,
        email: usuario.email,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        currentPassword,
        newPassword,
        ipAddress: getSessionCtx(req).ipAddress,
    });
    res.json({ ok: true, data: { message: 'Contraseña actualizada correctamente.' } });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/refresh
// ══════════════════════════════════════════════════════════
exports.refresh = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { refreshToken } = zod_1.z.object({ refreshToken: zod_1.z.string().min(10) }).parse(req.body);
    const { userId, newRefreshToken } = await (0, jwt_service_1.rotateRefreshToken)(refreshToken, getSessionCtx(req));
    const usuario = await (0, database_1.queryOne)(`SELECT email, rol FROM usuarios WHERE id = $1 AND activo = TRUE`, [userId]);
    if (!usuario)
        throw new errorHandler_1.AppError('Usuario no encontrado', 404);
    const accessToken = (0, jwt_service_1.signAccessToken)({
        sub: userId, email: usuario.email,
        rol: usuario.rol,
    });
    res.json({ ok: true, data: { accessToken, refreshToken: newRefreshToken, expiresIn: ACCESS_EXPIRY_SEC, tokenType: 'Bearer' } });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/logout
// ══════════════════════════════════════════════════════════
exports.logout = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { refreshToken } = zod_1.z.object({ refreshToken: zod_1.z.string().optional() }).parse(req.body);
    if (refreshToken)
        await (0, jwt_service_1.revokeRefreshToken)(refreshToken);
    res.json({ ok: true, data: { message: 'Sesión cerrada correctamente' } });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/logout-all
// ══════════════════════════════════════════════════════════
exports.logoutAll = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const count = await (0, jwt_service_1.revokeAllUserTokens)(req.user.sub);
    res.json({ ok: true, data: { message: `${count} sesión/es cerrada/s` } });
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/auth/me
// ══════════════════════════════════════════════════════════
exports.me = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const usuario = await (0, database_1.queryOne)(`SELECT u.id, u.email, u.nombre, u.apellido, u.rol, u.dni, u.cuil, u.telefono,
            u.mxm_verificado, u.mxm_nivel, u.email_verificado, u.email_verificado_en,
            u.ultimo_cambio_password, p.nombre AS plan_nombre, u.creado_en
     FROM usuarios u LEFT JOIN planes p ON p.id = u.plan_id
     WHERE u.id = $1 AND u.activo = TRUE`, [req.user.sub]);
    if (!usuario)
        throw new errorHandler_1.AppError('Usuario no encontrado', 404);
    const stats = await (0, database_1.queryOne)(`SELECT
       (SELECT COUNT(*) FROM bicicletas WHERE propietario_id=$1)::text AS bicicletas,
       (SELECT COUNT(*) FROM cits WHERE propietario_id=$1 AND estado='ACTIVO')::text AS cits_activos`, [req.user.sub]);
    res.json({
        ok: true,
        data: {
            ...usuario,
            stats: {
                bicicletas: parseInt(stats?.bicicletas ?? '0'),
                citsActivos: parseInt(stats?.cits_activos ?? '0'),
            },
        },
    });
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/auth/mxm
// ══════════════════════════════════════════════════════════
exports.mxmAuthorize = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const { redirect_to, forzar_nativo } = zod_1.z.object({
        redirect_to: zod_1.z.string().url().optional(),
        forzar_nativo: zod_1.z.coerce.boolean().default(false),
    }).parse(req.query);
    // Verificar disponibilidad de MxM antes de redirigir
    const { disponible, motivo } = await (0, mxm_circuit_service_1.featureDisponible)('LOGIN');
    if (!disponible || forzar_nativo) {
        // MxM caído → redirigir al frontend con instrucción de usar auth nativo
        const frontendUrl = process.env.RODAID_FRONTEND_URL ?? 'http://localhost:5173';
        const fallbackUrl = `${frontendUrl}/auth/login?mxm=fallback&motivo=${encodeURIComponent(motivo ?? 'MxM no disponible')}`;
        logger_1.log.auth.warn({ motivo, ip: req.ip }, '🔀 MxM no disponible — redirigiendo a auth nativo');
        return res.redirect(302, fallbackUrl);
    }
    const ctx = { ...getSessionCtx(req), redirectTo: redirect_to };
    const result = await mxm_service_1.mxmService.initOAuth(ctx);
    logger_1.log.auth.info({
        state: result.state.slice(0, 8) + '...',
        ip: req.ip,
    }, 'MxM OAuth iniciado — redirigiendo');
    res.redirect(302, result.authUrl);
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/auth/mxm/callback
// ══════════════════════════════════════════════════════════
exports.mxmCallback = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    const parsed = zod_1.z.object({
        code: zod_1.z.string().min(1).optional(),
        state: zod_1.z.string().min(1).optional(),
        error: zod_1.z.string().optional(),
        error_description: zod_1.z.string().optional(),
    }).parse(req.query);
    const baseUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar';
    // Manejar errores devueltos por MxM (rechazo del usuario, etc.)
    if (parsed.error || !parsed.code || !parsed.state) {
        const motivo = parsed.error_description ?? parsed.error ?? 'acceso_cancelado';
        logger_1.log.auth.warn({ error: parsed.error, ip: req.ip }, `MxM OAuth error: ${motivo}`);
        return res.redirect(302, `${baseUrl}/auth/error?motivo=${encodeURIComponent(motivo)}&origen=mxm`);
    }
    const result = await (0, mxm_service_1.processMxMCallback)(parsed.code, parsed.state, getSessionCtx(req));
    logger_1.log.auth.info({
        userId: result.usuario.id,
        isNewUser: result.isNewUser,
        nivel: result.mxmNivel,
        ip: req.ip,
    }, 'MxM callback OK — JWT emitido');
    // ── Setear cookies JWT (misma lógica que /auth/login) ──────────────
    const isProd = process.env.NODE_ENV === 'production';
    // Access token: HttpOnly, Secure, SameSite=Lax, 1 hora
    res.cookie('access_token', result.accessToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: result.expiresIn * 1000,
        path: '/',
    });
    // Refresh token: HttpOnly, Secure, SameSite=Strict, 30 días
    if (result.refreshToken) {
        res.cookie('refresh_token', result.refreshToken, {
            httpOnly: true,
            secure: isProd,
            sameSite: 'strict',
            maxAge: 30 * 24 * 3600 * 1000,
            path: '/api/v1/auth/refresh',
        });
    }
    // ── Redirigir al frontend con info del login ────────────────────────
    const destino = result.isNewUser
        ? `${baseUrl}/bienvenido?nivel=${result.mxmNivel}&nuevo=1`
        : `${baseUrl}/dashboard?nivel=${result.mxmNivel}&mxm=1`;
    return res.redirect(302, destino);
});
// ══════════════════════════════════════════════════════════
// GET /api/v1/auth/mxm/status — estado de conexión MxM del usuario
// ══════════════════════════════════════════════════════════
exports.mxmStatus = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const { queryOne } = await import('../config/database');
    const data = await queryOne(`SELECT mxm_verificado, mxm_nivel, mxm_email, mxm_ultimo_login FROM usuarios WHERE id=$1`, [req.user.sub]);
    const tokenData = await queryOne(`SELECT expires_at, cuil FROM mxm_tokens WHERE usuario_id=$1`, [req.user.sub]);
    res.json({ ok: true, data: {
            conectado: data?.mxm_verificado === true,
            nivel: data?.mxm_nivel ?? 0,
            email: data?.mxm_email ?? null,
            ultimoLogin: data?.mxm_ultimo_login ?? null,
            cuil: tokenData?.cuil ?? null,
            tokenVigenteHasta: tokenData?.expires_at ?? null,
            niveles: {
                puedeEmitirCIT: (data?.mxm_nivel ?? 0) >= 2,
                puedeTransferirCIT: (data?.mxm_nivel ?? 0) >= 2,
                puedeAccederMarketplace: (data?.mxm_nivel ?? 0) >= 1,
            },
        } });
});
// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/mxm/desconectar — desconectar cuenta MxM
// ══════════════════════════════════════════════════════════
exports.mxmDesconectar = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const { query } = await import('../config/database');
    await Promise.all([
        query(`UPDATE usuarios SET mxm_verificado=FALSE, mxm_sub=NULL, mxm_nivel=0 WHERE id=$1`, [req.user.sub]),
        query(`DELETE FROM mxm_tokens WHERE usuario_id=$1`, [req.user.sub]),
    ]);
    logger_1.log.auth.info({ userId: req.user.sub }, 'MxM desconectado');
    res.json({ ok: true, data: { desconectado: true } });
});
// GET /api/v1/auth/mxm/audit — historial de logins MxM del usuario
exports.mxmAuditLog = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const logs = await (0, mxm_service_1.getMxMAuditLog)(req.user.sub);
    res.json({ ok: true, data: logs });
});
// GET /api/v1/auth/password/history — historial de resets [autenticado]
exports.passwordHistory = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const history = await (0, password_service_1.getPasswordResetHistory)(req.user.sub);
    res.json({ ok: true, data: history });
});
// GET /api/v1/auth/sessions
exports.getSessions = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const sessions = await (0, session_service_1.getUserSessions)(req.user.sub);
    res.json({ ok: true, data: sessions.map(s => ({
            sessionId: s.sessionId,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent?.slice(0, 80),
            createdAt: new Date(s.createdAt).toISOString(),
            lastActivity: new Date(s.lastActivity).toISOString(),
            expiresAt: new Date(s.expiresAt).toISOString(),
            rememberMe: s.rememberMe,
        })) });
});
// DELETE /api/v1/auth/sessions/:id
exports.deleteSession = (0, errorHandler_1.asyncHandler)(async (req, res) => {
    if (!req.user)
        throw new errorHandler_1.AppError('No autenticado', 401);
    const ok = await (0, session_service_1.revokeSessionById)(req.params.id, req.user.sub);
    res.json({ ok, data: { revoked: ok, message: ok ? 'Sesión cerrada' : 'No encontrada' } });
});
