// ─── RODAID · 2FA Controller ──────────────────────────────
import { Request, Response } from 'express'
import { z } from 'zod'
import { AuthRequest } from '../types'
import { AppError, asyncHandler } from '../middleware/errorHandler'
import { setup2FA, confirm2FA, disable2FA, get2FAStatus, validate2FA, regenerateBackupCodes } from '../services/twofa.service'
import { buildTokenPair } from '../services/jwt.service'
import { queryOne } from '../config/database'

const getIP = (req: Request) => (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip

// GET /api/v1/auth/2fa/status
export const twoFAStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  res.json({ ok: true, data: await get2FAStatus(req.user.sub) })
})

// POST /api/v1/auth/2fa/setup
export const twoFASetup = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const result = await setup2FA(req.user.sub, req.user.email)
  res.json({ ok: true, data: {
    qrCodeDataUrl: result.qrCodeDataUrl,
    manualEntry:   result.manualEntry,
    instructions:  'Escaneá el QR con Google Authenticator o Authy. Luego confirmá con POST /auth/2fa/confirm.',
  }})
})

// POST /api/v1/auth/2fa/confirm
export const twoFAConfirm = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, '6 dígitos requeridos') }).parse(req.body)
  const result = await confirm2FA(req.user.sub, code)
  res.json({ ok: true, data: {
    ...result,
    warning: '⚠️ Guardá estos códigos en un lugar seguro. Solo se muestran UNA VEZ.',
  }})
})

// POST /api/v1/auth/2fa/validate — paso 2 del login
export const twoFAValidate = asyncHandler(async (req: Request, res: Response) => {
  const { preauthToken, code } = z.object({
    preauthToken: z.string().length(64, 'Token de pre-autenticación inválido'),
    code:         z.string().min(4).max(10),
  }).parse(req.body)
  const ctx = { ipAddress: getIP(req), userAgent: req.headers['user-agent'] as string }
  const userId = await validate2FA(preauthToken, code, ctx)
  const u = await queryOne<{ email: string; rol: string; nombre: string; apellido: string }>(
    'SELECT email, rol, nombre, apellido FROM usuarios WHERE id=$1', [userId]
  )
  if (!u) throw new AppError('Usuario no encontrado', 404)
  const tokens = await buildTokenPair(userId, u.email, u.rol as any, ctx)
  res.json({ ok: true, data: {
    usuario: { id: userId, email: u.email, nombre: u.nombre, apellido: u.apellido, rol: u.rol },
    ...tokens, twoFactorVerified: true,
  }})
})

// DELETE /api/v1/auth/2fa
export const twoFADisable = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, 'Código TOTP de 6 dígitos requerido') }).parse(req.body)
  await disable2FA(req.user.sub, code)
  res.json({ ok: true, data: { message: '2FA deshabilitado correctamente.' } })
})

// POST /api/v1/auth/2fa/backup/regenerate
export const twoFARegenerateBackup = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body)
  const codes = await regenerateBackupCodes(req.user.sub, code)
  res.json({ ok: true, data: { backupCodes: codes, warning: '⚠️ Los códigos anteriores ya no son válidos.' } })
})
