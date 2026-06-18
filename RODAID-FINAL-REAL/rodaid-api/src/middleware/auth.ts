// ─── RODAID · Middleware de Autenticación + RBAC ──────────
import { Response, NextFunction } from 'express'
import { AuthRequest, JWTPayload } from '../types'
import { verifyAccessToken } from '../services/jwt.service'
import { AppError } from './errorHandler'
import type { Permiso } from '../services/rbac.service'

function extractBearerToken(req: AuthRequest): string | null {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  return null
}

// ── auth — verificación JWT rápida (sin DB) ───────────────
export function auth(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req)
  if (!token) {
    res.status(401).json({ ok: false, error: { code: 'NO_TOKEN', message: 'Token de autenticación requerido' } })
    return
  }
  try {
    req.user = verifyAccessToken(token)
    // Actualizar actividad de sesión (debounced, fire-and-forget)
    const jti = (req.user as any).jti
    if (jti) {
      import('../services/session.service').then(({ touchSession }) =>
        touchSession(jti).catch(() => {})
      ).catch(() => {})
    }
    next()
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ ok: false, error: { code: err.code, message: err.message } })
      return
    }
    res.status(401).json({ ok: false, error: { code: 'TOKEN_INVALID', message: 'Token inválido' } })
  }
}

// ── authWithBlacklist — con consulta de blacklist en DB ───
export function authWithBlacklist(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req)
  if (!token) {
    res.status(401).json({ ok: false, error: { code: 'NO_TOKEN', message: 'Token requerido' } })
    return
  }
  import('../services/jwt.service').then(({ verifyAndExtractToken }) =>
    verifyAndExtractToken(token)
  ).then(decoded => { req.user = decoded; next() })
  .catch(err => {
    if (err instanceof AppError)
      res.status(err.statusCode).json({ ok: false, error: { code: err.code, message: err.message } })
    else
      res.status(401).json({ ok: false, error: { code: 'TOKEN_INVALID', message: 'Token inválido' } })
  })
}

// ── requireRole — verificar rol por JWT claim ─────────────
export function requireRole(...roles: JWTPayload['rol'][]): (req: AuthRequest, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'No autenticado' } })
      return
    }
    if (!roles.includes(req.user.rol)) {
      res.status(403).json({
        ok: false, error: {
          code: 'FORBIDDEN',
          message: `Acceso denegado. Rol requerido: ${roles.join(' o ')}`,
          detail: { yourRole: req.user.rol, requiredRoles: roles },
        },
      })
      return
    }
    next()
  }
}

// ── requirePermission — verificar permiso granular en DB ──
// Más costoso que requireRole (consulta DB), usar en endpoints sensibles
export function requirePermission(permiso: Permiso): (req: AuthRequest, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'No autenticado' } })
      return
    }
    import('../services/rbac.service').then(({ can }) =>
      can(req.user!.rol as any, permiso)
    ).then(allowed => {
      if (!allowed) {
        res.status(403).json({
          ok: false, error: {
            code: 'PERMISSION_DENIED',
            message: `No tenés el permiso '${permiso}' para realizar esta acción`,
            detail: { yourRole: req.user!.rol, requiredPermission: permiso },
          },
        })
        return
      }
      next()
    }).catch(() => {
      // Si la DB falla, permitir (no bloquear por error de DB)
      next()
    })
  }
}

// ── requireInspectorProfile — inspector activo con taller ─
export function requireInspectorProfile(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'No autenticado' } })
    return
  }
  import('../services/rbac.service').then(({ requireInspectorProfile: rip }) =>
    rip(req.user!.sub)
  ).then(profile => {
    req.inspectorProfile = profile as any
    next()
  }).catch(err => {
    if (err instanceof AppError)
      res.status(err.statusCode).json({ ok: false, error: { code: err.code, message: err.message } })
    else
      res.status(403).json({ ok: false, error: { code: 'NO_INSPECTOR_PROFILE', message: 'Perfil de inspector requerido' } })
  })
}

// ── Middleware compuestos ─────────────────────────────────
export const authenticated  = [auth]
export const onlyInspector  = [auth, requireRole('INSPECTOR', 'ADMIN')]
export const onlyAdmin      = [auth, requireRole('ADMIN')]
export const onlyAliado     = [auth, requireRole('ALIADO', 'ADMIN')]
export const secureAuth     = [authWithBlacklist]

// Inspector activo con perfil vinculado a taller
export const inspectorConPerfil = [auth, requireRole('INSPECTOR', 'ADMIN'), requireInspectorProfile]
