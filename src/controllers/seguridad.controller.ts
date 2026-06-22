// ─── RODAID · Seguridad Controller ───────────────────────
import { Request, Response } from 'express'
import { z } from 'zod'
import { AuthRequest } from '../types'
import { AppError, asyncHandler } from '../middleware/errorHandler'
import {
  denunciarRobo, verificarAlertas, marcarRecuperada, misDenuncias,
} from '../services/seguridad.service'

const denunciarSchema = z.object({
  citId:                z.string().uuid('citId debe ser UUID'),
  descripcion:          z.string().min(20, 'Describí el robo en al menos 20 caracteres').max(1000),
  lugarRobo:            z.string().max(300).optional(),
  fechaRobo:            z.string().datetime({ message: 'fechaRobo debe ser ISO 8601' }).optional(),
  denuncianteDNI:       z.string().min(7).max(10).optional(),
  denuncianteNombre:    z.string().max(200).optional(),
  denuncianteTelefono:  z.string().max(30).optional(),
  geoLat:               z.number().min(-90).max(90).optional(),
  geoLng:               z.number().min(-180).max(180).optional(),
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/seguridad/denunciar
// ══════════════════════════════════════════════════════════
export const denunciar = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const data = denunciarSchema.parse(req.body)

  const result = await denunciarRobo({ ...data, denuncianteId: req.user.sub })

  res.status(201).json({ ok: true, data: result })
})

// ══════════════════════════════════════════════════════════
// GET /api/v1/seguridad/alertas/:serial   [público]
// ══════════════════════════════════════════════════════════
export const alertasPorSerial = asyncHandler(async (req: Request, res: Response) => {
  const serial = decodeURIComponent(req.params.serial).toUpperCase().replace(/\s/g, '-')
  const result = await verificarAlertas(serial)
  res.json({ ok: true, data: result })
})

// ══════════════════════════════════════════════════════════
// POST /api/v1/seguridad/denuncias/:id/recuperar
// ══════════════════════════════════════════════════════════
export const recuperar = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const result = await marcarRecuperada(req.params.id, req.user.sub)
  res.json({ ok: true, data: result })
})

// ══════════════════════════════════════════════════════════
// GET /api/v1/seguridad/mis-denuncias
// ══════════════════════════════════════════════════════════
export const verMisDenuncias = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const result = await misDenuncias(req.user.sub)
  res.json({ ok: true, data: result })
})
