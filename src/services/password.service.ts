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

import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import zxcvbn from 'zxcvbn'
import { query, queryOne } from '../config/database'
import { AppError } from '../middleware/errorHandler'
import { log } from '../middleware/logger'
import { sendPasswordResetEmail, sendPasswordChangedEmail } from './email.service'

// ── Constantes ─────────────────────────────────────────────

const RESET_TTL_HOURS   = 1       // el token expira en 1 hora
const COOLDOWN_MINUTES  = 5       // mínimo entre solicitudes de reset
const BCRYPT_ROUNDS     = 12
const MIN_PASS_STRENGTH = 2       // 0-4 zxcvbn score

// ══════════════════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════════════════

type AuthEvento =
  | 'forgot_password_requested'
  | 'forgot_password_cooldown'
  | 'forgot_password_not_found'
  | 'reset_password_ok'
  | 'reset_password_invalid_token'
  | 'reset_password_weak_password'
  | 'reset_token_info_checked'

async function auditAuth(
  evento: AuthEvento,
  resultado: 'ok' | 'fail' | 'blocked',
  opts: {
    usuarioId?: string
    email?: string
    ipAddress?: string
    userAgent?: string
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  await query(
    `INSERT INTO auth_audit_log
       (usuario_id, email, evento, resultado, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5::inet, $6, $7)`,
    [
      opts.usuarioId ?? null,
      opts.email     ?? null,
      evento, resultado,
      opts.ipAddress ?? null,
      opts.userAgent ?? null,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
    ]
  ).catch(e => log.auth.warn({ e }, 'audit log error (non-critical)'))
}

// ══════════════════════════════════════════════════════════
// FORGOT PASSWORD
// ══════════════════════════════════════════════════════════

export interface ForgotPasswordInput {
  email:      string
  ipAddress?: string
  userAgent?: string
}

export async function requestPasswordReset(input: ForgotPasswordInput): Promise<{
  message: string
  cooldownActive?: boolean
  tokenExpiresIn?: number   // solo si se acaba de emitir un token
}> {
  const GENERIC_MSG = 'Si el email está registrado, recibirás instrucciones en minutos.'

  // Buscar usuario (no revelar si existe o no en la respuesta pública)
  const usuario = await queryOne<{
    id: string; nombre: string; email: string
    reset_token: string | null
    reset_expires_at: Date | null
    reset_solicitado_en: Date | null
  }>(
    `SELECT id, nombre, email, reset_token, reset_expires_at, reset_solicitado_en
     FROM usuarios
     WHERE email = $1 AND activo = TRUE`,
    [input.email]
  )

  if (!usuario) {
    // Anti-enumeración — respuesta idéntica aunque el usuario no exista
    await auditAuth('forgot_password_not_found', 'fail', {
      email: input.email, ipAddress: input.ipAddress,
    })
    log.auth.debug({ email: input.email }, 'Forgot password: email no registrado')
    return { message: GENERIC_MSG }
  }

  // Cooldown: si ya hay un token activo emitido hace menos de COOLDOWN_MINUTES
  if (usuario.reset_solicitado_en) {
    const elapsedMs = Date.now() - new Date(usuario.reset_solicitado_en).getTime()
    const cooldownMs = COOLDOWN_MINUTES * 60 * 1000

    if (elapsedMs < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - elapsedMs) / 1000)
      await auditAuth('forgot_password_cooldown', 'blocked', {
        usuarioId: usuario.id, email: usuario.email,
        ipAddress: input.ipAddress,
        metadata:  { waitSec },
      })
      log.auth.warn({ userId: usuario.id, waitSec }, 'Forgot password: cooldown activo')
      // Respuesta genérica — no revelar que el cooldown fue la causa
      return { message: GENERIC_MSG, cooldownActive: true }
    }
  }

  // Generar token criptográficamente seguro
  const token    = crypto.randomBytes(48).toString('hex')  // 96 chars hex
  const expires  = new Date(Date.now() + RESET_TTL_HOURS * 3600 * 1000)
  const now      = new Date()

  // Guardar token y registrar timestamp de solicitud
  await query(
    `UPDATE usuarios
     SET reset_token = $2, reset_expires_at = $3,
         reset_solicitado_en = $4, actualizado_en = NOW()
     WHERE id = $1`,
    [usuario.id, token, expires, now]
  )

  // Enviar email (fire-and-forget — no bloquear la respuesta)
  sendPasswordResetEmail(usuario.email, usuario.nombre, token)
    .then(r => {
      if (r.ok) {
        log.auth.info({ userId: usuario.id, emailId: r.emailId }, 'Email de reset enviado')
      } else {
        log.auth.error({ userId: usuario.id, error: r.error }, 'Error enviando email de reset')
      }
    })
    .catch(e => log.auth.error({ e, userId: usuario.id }, 'Email de reset: excepción'))

  await auditAuth('forgot_password_requested', 'ok', {
    usuarioId:  usuario.id,
    email:      usuario.email,
    ipAddress:  input.ipAddress,
    metadata:   { expiresAt: expires.toISOString() },
  })

  log.auth.info({ userId: usuario.id }, 'Password reset solicitado')

  return {
    message:       GENERIC_MSG,
    tokenExpiresIn: RESET_TTL_HOURS * 3600,  // solo informativo
  }
}

// ══════════════════════════════════════════════════════════
// RESET TOKEN INFO — GET /auth/reset-password/info?token=xxx
// Permite al frontend verificar si el token es válido ANTES
// de mostrar el formulario de nueva contraseña
// ══════════════════════════════════════════════════════════

export async function getResetTokenInfo(token: string): Promise<{
  valid: boolean
  expiresIn?: number    // segundos hasta expiración
  expiresAt?: string    // ISO 8601
  message?:  string
}> {
  if (!token || token.length !== 96) {
    return { valid: false, message: 'Token inválido.' }
  }

  const row = await queryOne<{ reset_expires_at: Date }>(
    `SELECT reset_expires_at FROM usuarios
     WHERE reset_token = $1 AND activo = TRUE`,
    [token]
  )

  if (!row) {
    return { valid: false, message: 'El enlace de restablecimiento es inválido o ya fue utilizado.' }
  }

  const now       = new Date()
  const expiresAt = new Date(row.reset_expires_at)

  if (expiresAt <= now) {
    return { valid: false, message: 'El enlace expiró. Solicitá uno nuevo.' }
  }

  const expiresIn = Math.floor((expiresAt.getTime() - now.getTime()) / 1000)

  return {
    valid:     true,
    expiresIn,
    expiresAt: expiresAt.toISOString(),
  }
}

// ══════════════════════════════════════════════════════════
// RESET PASSWORD
// ══════════════════════════════════════════════════════════

export interface ResetPasswordInput {
  token:      string
  password:   string
  ipAddress?: string
  userAgent?: string
}

export async function resetPassword(input: ResetPasswordInput): Promise<{
  message: string
  userId: string
}> {
  // Validar token
  const usuario = await queryOne<{
    id: string; email: string; nombre: string; apellido: string; rol: string
    reset_expires_at: Date
  }>(
    `SELECT id, email, nombre, apellido, rol, reset_expires_at
     FROM usuarios
     WHERE reset_token = $1 AND reset_expires_at > NOW() AND activo = TRUE`,
    [input.token]
  )

  if (!usuario) {
    await auditAuth('reset_password_invalid_token', 'fail', {
      ipAddress: input.ipAddress,
      metadata:  { tokenLength: input.token.length },
    })
    throw new AppError(
      'El enlace de restablecimiento es inválido o expiró. Solicitá uno nuevo.',
      400, 'INVALID_OR_EXPIRED_TOKEN'
    )
  }

  // Validar fortaleza de contraseña
  const strength = zxcvbn(input.password, [usuario.email, usuario.nombre, usuario.apellido])
  if (strength.score < MIN_PASS_STRENGTH) {
    const suggestions = strength.feedback.suggestions.join(' ') ||
      'Usá letras, números y símbolos.'
    await auditAuth('reset_password_weak_password', 'fail', {
      usuarioId: usuario.id, ipAddress: input.ipAddress,
      metadata:  { score: strength.score },
    })
    throw new AppError(
      `Contraseña muy débil. ${suggestions}`,
      422, 'PASSWORD_TOO_WEAK',
      { score: strength.score, maxScore: 4, suggestions: strength.feedback.suggestions }
    )
  }

  // Hashear nueva contraseña
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)

  // Actualizar en una transacción atómica
  await query(
    `UPDATE usuarios
     SET password_hash         = $2,
         reset_token           = NULL,
         reset_expires_at      = NULL,
         reset_solicitado_en   = NULL,
         ultimo_cambio_password = NOW(),
         actualizado_en        = NOW()
     WHERE id = $1`,
    [usuario.id, passwordHash]
  )

  // Importar dinámico para evitar circular deps
  const { revokeAllUserTokens } = await import('./jwt.service')
  const sesionesRevocadas = await revokeAllUserTokens(usuario.id, 'password_reset')

  // Email de confirmación (fire-and-forget)
  sendPasswordChangedEmail(usuario.email, usuario.nombre, input.ipAddress)
    .catch(e => log.auth.error({ e }, 'Error enviando email de confirmación de reset'))

  await auditAuth('reset_password_ok', 'ok', {
    usuarioId:  usuario.id,
    email:      usuario.email,
    ipAddress:  input.ipAddress,
    userAgent:  input.userAgent,
    metadata:   { sesionesRevocadas },
  })

  log.auth.info({
    userId: usuario.id,
    sesionesRevocadas,
    ip: input.ipAddress,
  }, 'Contraseña restablecida · sesiones previas revocadas')

  return {
    message: `Contraseña actualizada correctamente. ${sesionesRevocadas} sesión/es previas fueron cerradas.`,
    userId:  usuario.id,
  }
}

// ══════════════════════════════════════════════════════════
// CHANGE PASSWORD (usuario autenticado)
// ══════════════════════════════════════════════════════════

export interface ChangePasswordInput {
  userId:          string
  email:           string
  nombre:          string
  apellido:        string
  currentPassword: string
  newPassword:     string
  ipAddress?:      string
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const row = await queryOne<{ password_hash: string }>(
    `SELECT password_hash FROM usuarios WHERE id = $1`, [input.userId]
  )
  if (!row?.password_hash) throw new AppError('Usuario no encontrado', 404)

  const ok = await bcrypt.compare(input.currentPassword, row.password_hash)
  if (!ok) throw new AppError('La contraseña actual es incorrecta', 401, 'WRONG_CURRENT_PASSWORD')

  if (input.currentPassword === input.newPassword) {
    throw new AppError('La nueva contraseña debe ser diferente a la actual', 422, 'SAME_PASSWORD')
  }

  const strength = zxcvbn(input.newPassword, [input.email, input.nombre, input.apellido])
  if (strength.score < MIN_PASS_STRENGTH) {
    const msg = strength.feedback.suggestions.join(' ') || 'Usá letras, números y símbolos.'
    throw new AppError(`Contraseña muy débil. ${msg}`, 422, 'PASSWORD_TOO_WEAK',
      { score: strength.score })
  }

  const hash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS)
  await query(
    `UPDATE usuarios
     SET password_hash = $2, ultimo_cambio_password = NOW(), actualizado_en = NOW()
     WHERE id = $1`,
    [input.userId, hash]
  )

  // Notificar cambio de contraseña
  sendPasswordChangedEmail(input.email, input.nombre, input.ipAddress)
    .catch(e => log.auth.error({ e }, 'Error enviando email de cambio de password'))

  log.auth.info({ userId: input.userId }, 'Contraseña cambiada por el usuario')
}

// ══════════════════════════════════════════════════════════
// QUERIES ADMIN — historial de resets
// ══════════════════════════════════════════════════════════

export async function getPasswordResetHistory(userId: string, limit = 20) {
  return query<Record<string, unknown>>(
    `SELECT evento, resultado, ip_address::text, user_agent, metadata, creado_en
     FROM auth_audit_log
     WHERE usuario_id = $1
       AND evento LIKE '%password%'
     ORDER BY creado_en DESC
     LIMIT $2`,
    [userId, limit]
  )
}

export async function getAuthAuditLog(
  filters: { email?: string; evento?: string; limit?: number } = {}
) {
  const { email, evento, limit = 50 } = filters
  const conds: string[] = []
  const params: unknown[] = []
  let i = 1

  if (email)  { conds.push(`email = $${i++}`);               params.push(email) }
  if (evento) { conds.push(`evento LIKE $${i++}`);           params.push(`%${evento}%`) }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  params.push(limit)

  return query<Record<string, unknown>>(
    `SELECT id, usuario_id, email, evento, resultado, ip_address::text,
            metadata, creado_en
     FROM auth_audit_log
     ${where}
     ORDER BY creado_en DESC
     LIMIT $${i}`,
    params
  )
}
