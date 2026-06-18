// ─── RODAID · Auth Controller ─────────────────────────────
import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { getEstadoCircuito, featureDisponible, checkHealthMxM } from '../services/mxm.circuit.service'
import { z } from 'zod'
import zxcvbn from 'zxcvbn'
import { query, queryOne } from '../config/database'
import { AppError, asyncHandler } from '../middleware/errorHandler'
import { log } from '../middleware/logger'
import { check2FARequired, issuePreauthToken } from '../services/twofa.service'
import {
  createSession as createSessionRedis, revokeAllUserSessions, getUserSessions, revokeSessionById as revokeUserSession,
  getSessionTTL, getSessionStats,
} from '../services/session.service'
import {
  signAccessToken, verifyAccessToken,
  buildTokenPair, rotateRefreshToken,
  revokeRefreshToken, revokeAllUserTokens,
  revokeAccessToken, getActiveSessions, revokeSession,
  purgeExpiredTokens, SessionContext,
} from '../services/jwt.service'
import {
  sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail,
} from '../services/email.service'
import { mxmService, getMxMAuthUrl, processMxMCallback, getMxMAuditLog } from '../services/mxm.service'
import { AuthRequest, JWTPayload } from '../types'
import {
  requestPasswordReset, resetPassword as doResetPassword,
  changePassword as doChangePassword,
  getResetTokenInfo, getPasswordResetHistory,
} from '../services/password.service'
import { verificarBloqueoCuenta, registrarFalloLogin, resetearContadorLogin, verificarBloqueoIP, logAuthEvento } from '../services/auth.lockout.service'

// ── Constantes ────────────────────────────────────────────

const VERIFICATION_TTL_HOURS = 24
const ACCESS_EXPIRY_SEC = (() => { const s = process.env.JWT_ACCESS_EXPIRES ?? '15m'; const n = parseInt(s); if (s.endsWith('m')) return n*60; if (s.endsWith('h')) return n*3600; if (s.endsWith('d')) return n*86400; return 900 })()
const RESET_TTL_HOURS        = 1
const BCRYPT_ROUNDS          = 12
const MIN_PASSWORD_STRENGTH  = 2   // 0-4 (zxcvbn) — 2=fair

// ── Schemas ───────────────────────────────────────────────

const registerSchema = z.object({
  email:    z.string().email('Email inválido').toLowerCase(),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(128),
  nombre:   z.string().min(2, 'Nombre requerido').max(100).trim(),
  apellido: z.string().min(2, 'Apellido requerido').max(100).trim(),
  telefono: z.string().max(30).optional(),
})

const loginSchema = z.object({
  email:    z.string().email().toLowerCase(),
  password: z.string().min(1),
})

const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
})

const resetPasswordSchema = z.object({
  token:    z.string().min(32, 'Token inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(128),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8).max(128),
})

// ── Helpers ───────────────────────────────────────────────

interface UsuarioRow {
  id: string; email: string; password_hash: string | null; nombre: string
  apellido: string; rol: string; activo: boolean
  email_verificado: boolean; email_verificado_en: Date | null
}

function expiresInSeconds() {
  const s = process.env.JWT_ACCESS_EXPIRES ?? '15m'
  const n = parseInt(s)
  if (s.endsWith('m')) return n * 60
  if (s.endsWith('h')) return n * 3600
  if (s.endsWith('d')) return n * 86400
  return 900
}

async function buildTokens(
  userId: string, email: string, rol: string,
  ctx: SessionContext = {},
  opts: { rememberMe?: boolean } = {}
) {
  // 1. Crear entrada en Redis (y opcionalmente en PG via session.service)
  const session = await createSessionRedis({
    userId, email, rol,
    ipAddress:  ctx.ipAddress,
    userAgent:  ctx.userAgent,
    rememberMe: opts.rememberMe,
  })

  // 2. Emitir refresh token PG con claims de rol (inspector_id, taller_id)
  const jwtSvc = await import('../services/jwt.service')
  let tokens: Awaited<ReturnType<typeof jwtSvc.buildTokenPair>>

  if (rol === 'INSPECTOR') {
    try {
      tokens = await jwtSvc.buildTokenPairInspector(userId, email, ctx)
    } catch {
      // Si no tiene perfil de inspector todavía, emitir token genérico
      tokens = await jwtSvc.buildTokenPair(userId, email, 'INSPECTOR', ctx)
    }
  } else if (rol === 'ALIADO') {
    try {
      tokens = await jwtSvc.buildTokenPairAliado(userId, email, ctx)
    } catch {
      tokens = await jwtSvc.buildTokenPair(userId, email, 'ALIADO', ctx)
    }
  } else {
    tokens = await jwtSvc.buildTokenPair(userId, email, rol as JWTPayload['rol'], ctx)
  }

  return {
    ...tokens,
    sessionId: session.sessionId,
  }
}

function getSessionCtx(req: Request): SessionContext {
  return {
    ipAddress:  req.ip ?? (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim(),
    userAgent:  (req.headers['user-agent'] as string)?.slice(0, 255),
  }
}

function generateToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('hex')
}

// Validar fortaleza de contraseña con zxcvbn
function validatePasswordStrength(password: string, userInputs: string[] = []): void {
  const result = zxcvbn(password, userInputs)
  if (result.score < MIN_PASSWORD_STRENGTH) {
    const feedback = result.feedback.suggestions.join(' ') ||
      'Usá una combinación de letras, números y símbolos.'
    throw new AppError(
      `Contraseña muy débil. ${feedback}`,
      422, 'PASSWORD_TOO_WEAK',
      { score: result.score, maxScore: 4, suggestions: result.feedback.suggestions }
    )
  }
}

// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/register
// ══════════════════════════════════════════════════════════
export const register = asyncHandler(async (req: Request, res: Response) => {
  const data = registerSchema.parse(req.body)

  // 1. Verificar email único
  const existe = await queryOne<{ id: string }>(
    `SELECT id FROM usuarios WHERE email = $1`, [data.email]
  )
  if (existe) throw new AppError('El email ya está registrado', 409, 'EMAIL_TAKEN')

  // 2. Validar fortaleza de contraseña
  validatePasswordStrength(data.password, [data.email, data.nombre, data.apellido])

  // 3. Hash de contraseña
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS)

  // 4. Token de verificación (48 bytes hex = 96 chars)
  const verificationToken   = generateToken(48)
  const verificationExpires = new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600 * 1000)

  // 5. Obtener plan libre
  const plan = await queryOne<{ id: string }>(`SELECT id FROM planes WHERE nombre = 'libre'`)

  // 6. Crear usuario (sin verificar)
  const rows = await query<{ id: string; email: string; nombre: string; apellido: string; rol: string }>(
    `INSERT INTO usuarios
       (email, password_hash, nombre, apellido, telefono, rol, plan_id,
        email_verificado, verificacion_token, verificacion_expires_at)
     VALUES ($1,$2,$3,$4,$5,'CICLISTA',$6,FALSE,$7,$8)
     RETURNING id, email, nombre, apellido, rol`,
    [data.email, passwordHash, data.nombre, data.apellido,
     data.telefono ?? null, plan?.id ?? null,
     verificationToken, verificationExpires]
  )
  const usuario = rows[0]

  // 7. Enviar email de verificación (no bloquea la respuesta si falla)
  sendVerificationEmail(usuario.email, usuario.nombre, verificationToken)
    .catch(err => log.auth.error({ err, userId: usuario.id }, 'Error enviando email de verificación'))

  log.auth.info({ userId: usuario.id, email: usuario.email }, 'Usuario registrado · pendiente verificación')

  res.status(201).json({
    ok: true,
    data: {
      usuario: {
        id:               usuario.id,
        email:            usuario.email,
        nombre:           usuario.nombre,
        apellido:         usuario.apellido,
        rol:              usuario.rol,
        emailVerificado:  false,
      },
      message:    'Registro exitoso. Revisá tu email para verificar tu cuenta.',
      nextStep:   'verify-email',
    },
  })
})

// ══════════════════════════════════════════════════════════
// GET /api/v1/auth/verify-email?token=xxx
// ══════════════════════════════════════════════════════════
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = z.object({
    token: z.string().min(32, 'Token inválido'),
  }).parse(req.query)

  // 1. Buscar usuario por token (no expirado)
  const usuario = await queryOne<{ id: string; nombre: string; email: string; email_verificado: boolean }>(
    `SELECT id, nombre, email, email_verificado
     FROM usuarios
     WHERE verificacion_token = $1
       AND verificacion_expires_at > NOW()
       AND activo = TRUE`,
    [token]
  )

  if (!usuario) {
    throw new AppError(
      'El enlace de verificación es inválido o expiró. Solicitá uno nuevo.',
      400, 'INVALID_OR_EXPIRED_TOKEN'
    )
  }

  if (usuario.email_verificado) {
    // Ya estaba verificado — devolver tokens igualmente
    const tokens = await buildTokens(usuario.id, usuario.email, 'CICLISTA', getSessionCtx(req))
    return res.json({
      ok: true,
      data: { message: 'Tu cuenta ya estaba verificada.', ...tokens },
    })
  }

  // 2. Marcar como verificado y limpiar el token
  await query(
    `UPDATE usuarios
     SET email_verificado        = TRUE,
         email_verificado_en     = NOW(),
         verificacion_token      = NULL,
         verificacion_expires_at = NULL,
         actualizado_en          = NOW()
     WHERE id = $1`,
    [usuario.id]
  )

  // 3. Emitir tokens JWT para auto-login
  const tokens = await buildTokens(usuario.id, usuario.email, 'CICLISTA', getSessionCtx(req))

  // 4. Email de bienvenida (fire-and-forget)
  sendWelcomeEmail(usuario.email, usuario.nombre)
    .catch(err => log.auth.error({ err }, 'Error enviando email de bienvenida'))

  log.auth.info({ userId: usuario.id }, 'Email verificado · cuenta activada')

  res.json({
    ok: true,
    data: {
      message:        '¡Cuenta verificada exitosamente! Bienvenido/a a RODAID.',
      emailVerificado: true,
      ...tokens,
    },
  })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/resend-verification
// ══════════════════════════════════════════════════════════
export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  const { email } = z.object({ email: z.string().email().toLowerCase() }).parse(req.body)

  const usuario = await queryOne<{ id: string; nombre: string; email_verificado: boolean }>(
    `SELECT id, nombre, email_verificado
     FROM usuarios WHERE email = $1 AND activo = TRUE`,
    [email]
  )

  // Responder siempre con éxito (evitar enumeración de emails)
  if (!usuario || usuario.email_verificado) {
    return res.json({
      ok: true,
      data: { message: 'Si el email existe y no está verificado, recibirás un nuevo enlace en minutos.' },
    })
  }

  const token   = generateToken(48)
  const expires = new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600 * 1000)

  await query(
    `UPDATE usuarios
     SET verificacion_token = $2, verificacion_expires_at = $3, actualizado_en = NOW()
     WHERE id = $1`,
    [usuario.id, token, expires]
  )

  await sendVerificationEmail(email, usuario.nombre, token)

  log.auth.info({ userId: usuario.id }, 'Email de verificación reenviado')

  res.json({
    ok: true,
    data: { message: 'Nuevo enlace de verificación enviado. Revisá tu bandeja de entrada.' },
  })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/login
// ══════════════════════════════════════════════════════════
export const login = asyncHandler(async (req: Request, res: Response) => {
  const data = loginSchema.parse(req.body)

  const usuario = await queryOne<UsuarioRow>(
    `SELECT id, email, password_hash, nombre, apellido, rol, activo, email_verificado, email_verificado_en
     FROM usuarios WHERE email = $1`,
    [data.email]
  )

  if (!usuario?.password_hash) {
    // Registrar intento fallido aunque el email no exista (evita user enumeration)
    await logAuthEvento({ evento:'LOGIN_EMAIL_INEXISTENTE', ip:getSessionCtx(req).ipAddress??'0.0.0.0', userAgent:req.headers['user-agent']??'', ok:false }).catch(()=>{})
    throw new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS')
  }
  if (!usuario.activo) {
    throw new AppError('Cuenta desactivada. Contactá a soporte@rodaid.com.ar', 403, 'ACCOUNT_DISABLED')
  }

  // ── LOCKOUT: verificar bloqueo ANTES de comparar contraseña ──────
  const ipAddr = getSessionCtx(req).ipAddress ?? '0.0.0.0'

  // Verificar bloqueo a nivel IP
  const ipBloqueada = await verificarBloqueoIP(ipAddr)
  if (ipBloqueada) {
    throw new AppError('Demasiados intentos desde tu IP. Intentá en 6 horas.', 429, 'IP_BLOCKED')
  }

  // Verificar bloqueo de cuenta
  const bloqueo = await verificarBloqueoCuenta(data.email)
  if (bloqueo.bloqueado) {
    const mins = Math.ceil(bloqueo.segundosRestantes / 60)
    throw new AppError(
      `Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intentá en ${mins} minuto${mins!==1?'s':''}.`,
      423, 'ACCOUNT_LOCKED'
    )
  }

  const ok = await bcrypt.compare(data.password, usuario.password_hash)
  if (!ok) {
    // Registrar fallo y potencialmente bloquear
    await registrarFalloLogin({ email:data.email, ip:ipAddr, userAgent:req.headers['user-agent']??'' })
    throw new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS')
  }

  // Verificar si el usuario tiene 2FA activo
  const twoFA = await check2FARequired(usuario.id, usuario.rol)

  if (twoFA.enabled) {
    // Emitir temp token — el cliente debe hacer POST /auth/2fa/verify
    const tempToken = await issuePreauthToken(usuario.id, getSessionCtx(req).ipAddress)
    log.auth.info({ userId: usuario.id, rol: usuario.rol }, 'Login OK — 2FA requerido')
    return res.json({
      ok: true,
      data: {
        requires2FA: true,
        tempToken,
        expiresIn: 300,   // 5 minutos
        message:   'Ingresá el código de tu app autenticadora para completar el inicio de sesión.',
      },
    })
  }

  // ── LOCKOUT: resetear contador tras login exitoso ────────
  await resetearContadorLogin(usuario.id, ipAddr)

  // ── Audit log login exitoso ───────────────────────────────
  logAuthEvento({ usuarioId:usuario.id, evento:'LOGIN_EXITOSO', ip:ipAddr, userAgent:req.headers['user-agent']??'', datos:{rol:usuario.rol} }).catch(()=>{})

  const tokens = await buildTokens(usuario.id, usuario.email, usuario.rol, getSessionCtx(req))

  log.auth.info({ userId: usuario.id, emailVerificado: usuario.email_verificado, ip: getSessionCtx(req).ipAddress }, 'Login exitoso')

  res.json({
    ok: true,
    data: {
      usuario: {
        id:              usuario.id, email: usuario.email,
        nombre:          usuario.nombre, apellido: usuario.apellido,
        rol:             usuario.rol, emailVerificado: usuario.email_verificado,
      },
      ...tokens,
      ...(usuario.email_verificado ? {} : {
        warning: 'Email sin verificar. Algunas funciones pueden estar limitadas.',
        nextStep: 'verify-email',
      }),
    },
  })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/forgot-password
// ══════════════════════════════════════════════════════════
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = forgotPasswordSchema.parse(req.body)
  const result = await requestPasswordReset({
    email,
    ipAddress: getSessionCtx(req).ipAddress,
    userAgent: getSessionCtx(req).userAgent,
  })
  res.json({ ok: true, data: result })
})

// GET /api/v1/auth/reset-password/info?token=xxx — verificar validez del token
export const resetTokenInfo = asyncHandler(async (req: Request, res: Response) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(req.query)
  const info = await getResetTokenInfo(token)
  res.json({ ok: true, data: info })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/reset-password
// ══════════════════════════════════════════════════════════
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = resetPasswordSchema.parse(req.body)
  const ctx = getSessionCtx(req)

  const { message, userId } = await doResetPassword({
    token, password,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  })

  // Obtener usuario para construir los tokens
  const usuario = await queryOne<{ email: string; rol: string; nombre: string; apellido: string }>(
    'SELECT email, rol, nombre, apellido FROM usuarios WHERE id=$1', [userId]
  )
  if (!usuario) throw new AppError('Usuario no encontrado', 404)

  const tokens = await buildTokens(userId, usuario.email, usuario.rol, ctx)

  res.json({
    ok: true,
    data: {
      message,
      usuario: { id: userId, email: usuario.email, nombre: usuario.nombre, apellido: usuario.apellido, rol: usuario.rol },
      ...tokens,
    },
  })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/change-password  [Autenticado]
// ══════════════════════════════════════════════════════════
export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body)

  const usuario = await queryOne<{ nombre: string; apellido: string; email: string }>(
    'SELECT nombre, apellido, email FROM usuarios WHERE id=$1', [req.user.sub]
  )
  if (!usuario) throw new AppError('Usuario no encontrado', 404)

  await doChangePassword({
    userId:          req.user.sub,
    email:           usuario.email,
    nombre:          usuario.nombre,
    apellido:        usuario.apellido,
    currentPassword,
    newPassword,
    ipAddress:       getSessionCtx(req).ipAddress,
  })

  res.json({ ok: true, data: { message: 'Contraseña actualizada correctamente.' } })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/refresh
// ══════════════════════════════════════════════════════════
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body)
  const { userId, newRefreshToken } = await rotateRefreshToken(refreshToken, getSessionCtx(req))

  const usuario = await queryOne<{ email: string; rol: string }>(
    `SELECT email, rol FROM usuarios WHERE id = $1 AND activo = TRUE`, [userId]
  )
  if (!usuario) throw new AppError('Usuario no encontrado', 404)

  const accessToken = signAccessToken({
    sub: userId, email: usuario.email,
    rol: usuario.rol as 'CICLISTA' | 'INSPECTOR' | 'ALIADO' | 'ADMIN',
  })

  res.json({ ok: true, data: { accessToken, refreshToken: newRefreshToken, expiresIn: ACCESS_EXPIRY_SEC, tokenType: 'Bearer' } })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/logout
// ══════════════════════════════════════════════════════════
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = z.object({ refreshToken: z.string().optional() }).parse(req.body)
  if (refreshToken) await revokeRefreshToken(refreshToken)
  res.json({ ok: true, data: { message: 'Sesión cerrada correctamente' } })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/logout-all
// ══════════════════════════════════════════════════════════
export const logoutAll = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const count = await revokeAllUserTokens(req.user.sub)
  res.json({ ok: true, data: { message: `${count} sesión/es cerrada/s` } })
})

// ══════════════════════════════════════════════════════════
// GET /api/v1/auth/me
// ══════════════════════════════════════════════════════════
export const me = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)

  const usuario = await queryOne<{
    id: string; email: string; nombre: string; apellido: string; rol: string
    dni: string | null; cuil: string | null; telefono: string | null
    mxm_verificado: boolean; mxm_nivel: number; email_verificado: boolean
    email_verificado_en: Date | null; plan_nombre: string | null; creado_en: Date
    ultimo_cambio_password: Date | null
  }>(
    `SELECT u.id, u.email, u.nombre, u.apellido, u.rol, u.dni, u.cuil, u.telefono,
            u.mxm_verificado, u.mxm_nivel, u.email_verificado, u.email_verificado_en,
            u.ultimo_cambio_password, p.nombre AS plan_nombre, u.creado_en
     FROM usuarios u LEFT JOIN planes p ON p.id = u.plan_id
     WHERE u.id = $1 AND u.activo = TRUE`,
    [req.user.sub]
  )
  if (!usuario) throw new AppError('Usuario no encontrado', 404)

  const stats = await queryOne<{ bicicletas: string; cits_activos: string }>(
    `SELECT
       (SELECT COUNT(*) FROM bicicletas WHERE propietario_id=$1)::text AS bicicletas,
       (SELECT COUNT(*) FROM cits WHERE propietario_id=$1 AND estado='ACTIVO')::text AS cits_activos`,
    [req.user.sub]
  )

  res.json({
    ok: true,
    data: {
      ...usuario,
      stats: {
        bicicletas:  parseInt(stats?.bicicletas ?? '0'),
        citsActivos: parseInt(stats?.cits_activos ?? '0'),
      },
    },
  })
})

// ══════════════════════════════════════════════════════════
// GET /api/v1/auth/mxm
// ══════════════════════════════════════════════════════════
export const mxmAuthorize = asyncHandler(async (req: Request, res: Response) => {
  const { redirect_to, forzar_nativo } = z.object({
    redirect_to:   z.string().url().optional(),
    forzar_nativo: z.coerce.boolean().default(false),
  }).parse(req.query)

  // Verificar disponibilidad de MxM antes de redirigir
  const { disponible, motivo } = await featureDisponible('LOGIN')

  if (!disponible || forzar_nativo) {
    // MxM caído → redirigir al frontend con instrucción de usar auth nativo
    const frontendUrl = process.env.RODAID_FRONTEND_URL ?? 'http://localhost:5173'
    const fallbackUrl = `${frontendUrl}/auth/login?mxm=fallback&motivo=${encodeURIComponent(motivo ?? 'MxM no disponible')}`
    log.auth.warn({ motivo, ip: req.ip }, '🔀 MxM no disponible — redirigiendo a auth nativo')
    return res.redirect(302, fallbackUrl)
  }

  const ctx = { ...getSessionCtx(req), redirectTo: redirect_to }
  const result = await mxmService.initOAuth(ctx)

  log.auth.info({
    state: result.state.slice(0, 8) + '...',
    ip:    req.ip,
  }, 'MxM OAuth iniciado — redirigiendo')

  res.redirect(302, result.authUrl)
})

// ══════════════════════════════════════════════════════════
// GET /api/v1/auth/mxm/callback
// ══════════════════════════════════════════════════════════
export const mxmCallback = asyncHandler(async (req: Request, res: Response) => {
  const parsed = z.object({
    code:  z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  }).parse(req.query)

  const baseUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'

  // Manejar errores devueltos por MxM (rechazo del usuario, etc.)
  if (parsed.error || !parsed.code || !parsed.state) {
    const motivo = parsed.error_description ?? parsed.error ?? 'acceso_cancelado'
    log.auth.warn({ error: parsed.error, ip: req.ip }, `MxM OAuth error: ${motivo}`)
    return res.redirect(302, `${baseUrl}/auth/error?motivo=${encodeURIComponent(motivo)}&origen=mxm`)
  }

  const result = await processMxMCallback(parsed.code, parsed.state, getSessionCtx(req))

  log.auth.info({
    userId:    result.usuario.id,
    isNewUser: result.isNewUser,
    nivel:     result.mxmNivel,
    ip:        req.ip,
  }, 'MxM callback OK — JWT emitido')

  // ── Setear cookies JWT (misma lógica que /auth/login) ──────────────
  const isProd = process.env.NODE_ENV === 'production'

  // Access token: HttpOnly, Secure, SameSite=Lax, 1 hora
  res.cookie('access_token', result.accessToken, {
    httpOnly: true,
    secure:   isProd,
    sameSite: 'lax',
    maxAge:   result.expiresIn * 1000,
    path:     '/',
  })

  // Refresh token: HttpOnly, Secure, SameSite=Strict, 30 días
  if (result.refreshToken) {
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'strict',
      maxAge:   30 * 24 * 3600 * 1000,
      path:     '/api/v1/auth/refresh',
    })
  }

  // ── Redirigir al frontend con info del login ────────────────────────
  const destino = result.isNewUser
    ? `${baseUrl}/bienvenido?nivel=${result.mxmNivel}&nuevo=1`
    : `${baseUrl}/dashboard?nivel=${result.mxmNivel}&mxm=1`

  return res.redirect(302, destino)
})


// ══════════════════════════════════════════════════════════
// GET /api/v1/auth/mxm/status — estado de conexión MxM del usuario
// ══════════════════════════════════════════════════════════
export const mxmStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)

  const { queryOne } = await import('../config/database')
  const data = await queryOne<{
    mxm_verificado: boolean; mxm_nivel: number; mxm_email: string | null; mxm_ultimo_login: Date | null
  }>(
    `SELECT mxm_verificado, mxm_nivel, mxm_email, mxm_ultimo_login FROM usuarios WHERE id=$1`,
    [req.user.sub]
  )

  const tokenData = await queryOne<{ expires_at: Date; cuil: string }>(
    `SELECT expires_at, cuil FROM mxm_tokens WHERE usuario_id=$1`,
    [req.user.sub]
  )

  res.json({ ok: true, data: {
    conectado:     data?.mxm_verificado === true,
    nivel:         data?.mxm_nivel ?? 0,
    email:         data?.mxm_email ?? null,
    ultimoLogin:   data?.mxm_ultimo_login ?? null,
    cuil:          tokenData?.cuil ?? null,
    tokenVigenteHasta: tokenData?.expires_at ?? null,
    niveles: {
      puedeEmitirCIT:         (data?.mxm_nivel ?? 0) >= 2,
      puedeTransferirCIT:     (data?.mxm_nivel ?? 0) >= 2,
      puedeAccederMarketplace:(data?.mxm_nivel ?? 0) >= 1,
    },
  }})
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/auth/mxm/desconectar — desconectar cuenta MxM
// ══════════════════════════════════════════════════════════
export const mxmDesconectar = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)

  const { query } = await import('../config/database')
  await Promise.all([
    query(
      `UPDATE usuarios SET mxm_verificado=FALSE, mxm_sub=NULL, mxm_nivel=0 WHERE id=$1`,
      [req.user.sub]
    ),
    query(`DELETE FROM mxm_tokens WHERE usuario_id=$1`, [req.user.sub]),
  ])

  log.auth.info({ userId: req.user.sub }, 'MxM desconectado')
  res.json({ ok: true, data: { desconectado: true } })
})

// GET /api/v1/auth/mxm/audit — historial de logins MxM del usuario
export const mxmAuditLog = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const logs = await getMxMAuditLog(req.user.sub)
  res.json({ ok: true, data: logs })
})

// GET /api/v1/auth/password/history — historial de resets [autenticado]
export const passwordHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const history = await getPasswordResetHistory(req.user.sub)
  res.json({ ok: true, data: history })
})

// GET /api/v1/auth/sessions
export const getSessions = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const sessions = await getUserSessions(req.user.sub)
  res.json({ ok: true, data: sessions.map(s => ({
    sessionId:    s.sessionId,
    ipAddress:    s.ipAddress,
    userAgent:    s.userAgent?.slice(0, 80),
    createdAt:    new Date(s.createdAt).toISOString(),
    lastActivity: new Date(s.lastActivity).toISOString(),
    expiresAt:    new Date(s.expiresAt).toISOString(),
    rememberMe:   s.rememberMe,
  }))})
})

// DELETE /api/v1/auth/sessions/:id
export const deleteSession = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const ok = await revokeUserSession(req.params.id, req.user.sub)
  res.json({ ok, data: { revoked: ok, message: ok ? 'Sesión cerrada' : 'No encontrada' } })
})
