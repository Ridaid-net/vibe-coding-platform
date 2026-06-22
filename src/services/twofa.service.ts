// ─── RODAID · Servicio 2FA (TOTP) para Inspectores ───────
import { authenticator } from 'otplib'
import qrcode from 'qrcode'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { query, queryOne } from '../config/database'
import { AppError } from '../middleware/errorHandler'
import { log } from '../middleware/logger'

const ISSUER           = 'RODAID'
const BACKUP_CODE_COUNT = 8
const PREAUTH_TTL_MIN   = 5
const TOTP_PERIOD       = 30

export interface TwoFASetupResult {
  secret: string; otpauthUrl: string; qrCodeDataUrl: string
  manualEntry: { secret: string; account: string; issuer: string }
}

export interface TwoFAConfirmResult {
  enabled: true; backupCodes: string[]; enabledAt: string
}

export interface TwoFAStatus {
  enabled: boolean; enabledAt: string | null; backupCodesRemaining: number
}

// ── Setup ──────────────────────────────────────────────────
export async function setup2FA(userId: string, email: string): Promise<TwoFASetupResult> {
  const u = await queryOne<{ totp_habilitado: boolean }>('SELECT totp_habilitado FROM usuarios WHERE id=$1',[userId])
  if (u?.totp_habilitado) throw new AppError('El 2FA ya está habilitado. Deshabilitalo primero.', 409, 'TOTP_ALREADY_ENABLED')

  const secret = authenticator.generateSecret()
  await query('UPDATE usuarios SET totp_secret=$2, totp_habilitado=FALSE, actualizado_en=NOW() WHERE id=$1',[userId,secret])

  const otpauthUrl = authenticator.keyuri(email, ISSUER, secret)
  const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl, { width: 256, margin: 2, color: { dark: '#0F1E35', light: '#FFFFFF' } })

  log.auth.info({ userId }, '2FA setup iniciado')
  return { secret, otpauthUrl, qrCodeDataUrl, manualEntry: { secret, account: email, issuer: ISSUER } }
}

// ── Validar código TOTP ────────────────────────────────────
async function validateTOTP(code: string, secret: string, userId: string): Promise<void> {
  const clean = code.replace(/[\s-]/g, '')
  if (!/^\d{6}$/.test(clean)) throw new AppError('El código debe tener 6 dígitos', 400, 'TOTP_FORMAT_INVALID')

  const isValid = authenticator.check(clean, secret)
  if (!isValid) throw new AppError('Código 2FA incorrecto. Verificá que la hora de tu dispositivo esté sincronizada.', 401, 'TOTP_INVALID')

  // Anti-replay: mismo período → rechazar
  const epoch = Math.floor(Date.now() / 1000 / TOTP_PERIOD)
  const row = await queryOne<{ totp_ultimo_uso: Date | null }>('SELECT totp_ultimo_uso FROM usuarios WHERE id=$1',[userId])
  if (row?.totp_ultimo_uso) {
    const last = Math.floor(new Date(row.totp_ultimo_uso).getTime() / 1000 / TOTP_PERIOD)
    if (last >= epoch - 1) throw new AppError('Código ya utilizado. Esperá el siguiente período (30s).', 401, 'TOTP_REPLAY')
  }

  await query('UPDATE usuarios SET totp_ultimo_uso=NOW() WHERE id=$1',[userId])
}

// ── Confirmar y activar ────────────────────────────────────
export async function confirm2FA(userId: string, code: string): Promise<TwoFAConfirmResult> {
  const u = await queryOne<{ totp_secret: string|null; totp_habilitado: boolean }>('SELECT totp_secret, totp_habilitado FROM usuarios WHERE id=$1',[userId])
  if (!u?.totp_secret) throw new AppError('Primero iniciá la configuración con POST /auth/2fa/setup', 400, 'TOTP_NOT_SETUP')
  if (u.totp_habilitado) throw new AppError('El 2FA ya está habilitado', 409, 'TOTP_ALREADY_ENABLED')

  await validateTOTP(code, u.totp_secret, userId)
  await query('UPDATE usuarios SET totp_habilitado=TRUE, totp_habilitado_en=NOW(), actualizado_en=NOW() WHERE id=$1',[userId])

  const backupCodes = await generateBackupCodes(userId)
  log.auth.info({ userId }, '2FA activado')
  return { enabled: true, backupCodes, enabledAt: new Date().toISOString() }
}

// ── Pre-auth token ─────────────────────────────────────────
export async function issuePreauthToken(userId: string, ipAddress?: string): Promise<string> {
  const token     = crypto.randomBytes(32).toString('hex')
  const tokenHash = await bcrypt.hash(token, 8)
  await query(
    'INSERT INTO preauth_tokens (usuario_id, token_hash, expires_at, ip_address) VALUES ($1,$2,NOW()+INTERVAL \'5 minutes\',$3::inet)',
    [userId, tokenHash, ipAddress ?? null]
  )
  return token
}

export async function consumePreauthToken(rawToken: string): Promise<string> {
  const rows = await query<{ id: string; usuario_id: string; token_hash: string }>(
    'SELECT id, usuario_id, token_hash FROM preauth_tokens WHERE expires_at>NOW() AND NOT usado ORDER BY creado_en DESC LIMIT 20'
  )
  for (const row of rows) {
    if (await bcrypt.compare(rawToken, row.token_hash)) {
      await query('UPDATE preauth_tokens SET usado=TRUE WHERE id=$1',[row.id])
      return row.usuario_id
    }
  }
  throw new AppError('Token de pre-autenticación inválido o expirado. Iniciá sesión nuevamente.', 401, 'PREAUTH_TOKEN_INVALID')
}

// ── Backup codes ───────────────────────────────────────────
async function generateBackupCodes(userId: string): Promise<string[]> {
  await query('DELETE FROM totp_backup_codes WHERE usuario_id=$1',[userId])
  const codes: string[] = []
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const raw  = crypto.randomBytes(4).toString('hex').toUpperCase()
    const code = `${raw.slice(0,4)}-${raw.slice(4)}`
    codes.push(code)
    await query('INSERT INTO totp_backup_codes (usuario_id, code_hash) VALUES ($1,$2)',[userId, await bcrypt.hash(code.replace('-',''),10)])
  }
  return codes
}

export async function useBackupCode(userId: string, rawCode: string): Promise<void> {
  const normalized = rawCode.replace(/[-\s]/g,'').toUpperCase()
  const rows = await query<{ id: string; code_hash: string }>(
    'SELECT id, code_hash FROM totp_backup_codes WHERE usuario_id=$1 AND NOT usado ORDER BY creado_en',[userId]
  )
  for (const row of rows) {
    if (await bcrypt.compare(normalized, row.code_hash)) {
      await query('UPDATE totp_backup_codes SET usado=TRUE, usado_en=NOW() WHERE id=$1',[row.id])
      const remaining = rows.length - 1
      log.auth.warn({ userId, remaining }, '2FA: código de respaldo utilizado')
      return
    }
  }
  throw new AppError('Código de respaldo inválido o ya utilizado.', 401, 'BACKUP_CODE_INVALID')
}

// ── Validate (login 2FA) ───────────────────────────────────
export async function validate2FA(preauthToken: string, code: string, ctx: { ipAddress?: string; userAgent?: string } = {}): Promise<string> {
  const userId = await consumePreauthToken(preauthToken)

  // Puede ser TOTP o backup code
  const u = await queryOne<{ totp_secret: string|null; totp_habilitado: boolean; email: string; rol: string }>(
    'SELECT totp_secret, totp_habilitado, email, rol FROM usuarios WHERE id=$1 AND activo=TRUE',[userId]
  )
  if (!u) throw new AppError('Usuario no encontrado', 404)
  if (!u.totp_habilitado || !u.totp_secret) throw new AppError('2FA no está habilitado', 400, 'TOTP_NOT_ENABLED')

  // Intentar como TOTP primero, luego como backup code
  try {
    await validateTOTP(code, u.totp_secret, userId)
  } catch (totpErr) {
    // Si el código tiene formato de backup (XXXX-XXXX o XXXXXXXX), intentar como backup
    const isBackupFormat = /^[A-F0-9]{4}-?[A-F0-9]{4}$/i.test(code.trim())
    if (isBackupFormat) {
      await useBackupCode(userId, code)
    } else {
      throw totpErr
    }
  }

  const { buildTokenPair } = await import('./jwt.service')
  const tokens = await buildTokenPair(userId, u.email, u.rol as any, ctx)

  log.auth.info({ userId, rol: u.rol }, '2FA validado — JWT emitido')
  return userId  // el caller construye la respuesta con tokens
}

// ── Disable ────────────────────────────────────────────────
export async function disable2FA(userId: string, code: string): Promise<void> {
  const u = await queryOne<{ totp_secret: string|null; totp_habilitado: boolean }>(
    'SELECT totp_secret, totp_habilitado FROM usuarios WHERE id=$1',[userId]
  )
  if (!u?.totp_habilitado || !u.totp_secret) throw new AppError('El 2FA no está habilitado.', 400, 'TOTP_NOT_ENABLED')
  await validateTOTP(code, u.totp_secret, userId)
  await query('UPDATE usuarios SET totp_secret=NULL, totp_habilitado=FALSE, totp_habilitado_en=NULL, actualizado_en=NOW() WHERE id=$1',[userId])
  await query('DELETE FROM totp_backup_codes WHERE usuario_id=$1',[userId])
  log.auth.info({ userId }, '2FA deshabilitado')
}

// ── Status ─────────────────────────────────────────────────
export async function get2FAStatus(userId: string): Promise<TwoFAStatus> {
  const row = await queryOne<{ totp_habilitado: boolean; totp_habilitado_en: Date|null }>(
    'SELECT totp_habilitado, totp_habilitado_en FROM usuarios WHERE id=$1',[userId]
  )
  const rem = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM totp_backup_codes WHERE usuario_id=$1 AND NOT usado',[userId]
  )
  return { enabled: row?.totp_habilitado??false, enabledAt: row?.totp_habilitado_en?.toISOString()??null, backupCodesRemaining: parseInt(rem?.count??'0') }
}

// ── Require 2FA check ──────────────────────────────────────
export async function check2FARequired(userId: string, rol: string): Promise<{ required: boolean; enabled: boolean }> {
  if (rol !== 'INSPECTOR') return { required: false, enabled: false }
  const s = await get2FAStatus(userId)
  return { required: true, enabled: s.enabled }
}

// ── Regenerar backup codes ────────────────────────────────
export async function regenerateBackupCodes(userId: string, code: string): Promise<string[]> {
  const u = await queryOne<{ totp_secret: string|null; totp_habilitado: boolean }>(
    'SELECT totp_secret, totp_habilitado FROM usuarios WHERE id=$1',[userId]
  )
  if (!u?.totp_habilitado || !u.totp_secret) throw new AppError('El 2FA no está habilitado.', 400, 'TOTP_NOT_ENABLED')
  await validateTOTP(code, u.totp_secret, userId)
  const codes = await generateBackupCodes(userId)
  log.auth.info({ userId }, '2FA: backup codes regenerados')
  return codes
}

// ── Purgar tokens viejos ───────────────────────────────────
export async function purge2FAData(): Promise<{ preauthTokens: number }> {
  const r = await query<{ count: string }>(
    `WITH d AS (DELETE FROM preauth_tokens WHERE expires_at<NOW() OR (usado AND creado_en<NOW()-INTERVAL '7 days') RETURNING id) SELECT COUNT(*)::text AS count FROM d`
  )
  return { preauthTokens: parseInt(r[0]?.count??'0') }
}
