// ─── RODAID · Manejo de errores global ───────────────────
import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { logger } from './logger'

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
    public details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: err.flatten().fieldErrors },
    })
  }

  // Errores de aplicación controlados
  if (err instanceof AppError) {
    if (err.statusCode >= 500) logger.error({ err, url: req.url }, err.message)
    return res.status(err.statusCode).json({
      ok: false,
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    })
  }

  // Error no controlado
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled error')
  return res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
  })
}

// Wrapper para rutas async — evita try/catch repetitivo
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
