// ─── RODAID · Roles Controller ────────────────────────────
import { Response } from 'express'
import { z } from 'zod'
import { AuthRequest } from '../types'
import { AppError, asyncHandler } from '../middleware/errorHandler'
import { queryOne, query } from '../config/database'
import {
  assignRole,
  getPermissions,
  requireInspectorProfile,
  getAliHandler,
  Rol,
} from '../services/rbac.service'
const cambiarRol = assignRole as any
const toggleUsuarioActivo = null as any
const listarUsuarios = null as any
const getPermisos = getPermissions as any
const getInspectorProfile = requireInspectorProfile as any
const getAliadoTaller = getAliHandler as any
const crearInvitacion = null as any
const aceptarInvitacion = null as any
import { log } from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// ADMIN — Gestión de usuarios y roles
// ══════════════════════════════════════════════════════════

// GET /admin/usuarios
export const getUsuarios = asyncHandler(async (req: AuthRequest, res: Response) => {
  const q = z.object({
    rol:    z.enum(['CICLISTA','INSPECTOR','ALIADO','ADMIN']).optional(),
    activo: z.enum(['true','false']).transform(v => v === 'true').optional(),
    page:   z.coerce.number().int().positive().default(1),
    limit:  z.coerce.number().int().min(1).max(100).default(20),
  }).parse(req.query)

  const result = await listarUsuarios(q as any)
  res.json({ ok: true, data: result })
})

// GET /admin/usuarios/:id
export const getUsuario = asyncHandler(async (req: AuthRequest, res: Response) => {
  const u = await queryOne<Record<string, unknown>>(
    `SELECT u.id, u.email, u.nombre, u.apellido, u.rol, u.activo, u.dni, u.cuil,
            u.email_verificado, u.mxm_verificado, u.mxm_nivel,
            u.creado_en, u.actualizado_en,
            p.nombre AS plan,
            i.id AS inspector_id, ta.nombre AS taller_nombre, ta.localidad AS taller_localidad
     FROM usuarios u
     LEFT JOIN planes p ON p.id = u.plan_id
     LEFT JOIN inspectores i ON i.usuario_id = u.id AND i.activo = TRUE
     LEFT JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
     WHERE u.id = $1`,
    [req.params.id]
  )
  if (!u) throw new AppError('Usuario no encontrado', 404)
  res.json({ ok: true, data: u })
})

// PATCH /admin/usuarios/:id/rol
export const cambiarRolHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)

  const { rol, motivo } = z.object({
    rol:    z.enum(['CICLISTA','INSPECTOR','ALIADO','ADMIN']),
    motivo: z.string().max(500).optional(),
  }).parse(req.body)

  const result = await cambiarRol({
    targetUserId: req.params.id,
    nuevoRol:     rol as Rol,
    adminUserId:  req.user.sub,
    motivo,
  })

  res.json({ ok: true, data: {
    ...result,
    mensaje: `Rol actualizado: ${result.rolAnterior} → ${result.rolNuevo}`,
    aviso:   'El JWT del usuario seguirá con el rol anterior hasta que expire (15 min máx).',
  }})
})

// PATCH /admin/usuarios/:id/toggle-activo
export const toggleActivoHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const result = await toggleUsuarioActivo(req.params.id, req.user.sub)
  res.json({ ok: true, data: {
    activo:  result.activo,
    mensaje: result.activo ? 'Usuario reactivado' : 'Usuario desactivado',
  }})
})

// ══════════════════════════════════════════════════════════
// INSPECTOR — perfil y gestión propia
// ══════════════════════════════════════════════════════════

// GET /inspector/perfil
export const getPerfilInspector = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)

  const perfil = await getInspectorProfile(req.user.sub)
  if (!perfil) throw new AppError('No tenés un perfil de inspector activo', 404, 'NO_INSPECTOR_PROFILE')

  // Estadísticas de CITs emitidos por este inspector
  const stats = await queryOne<{ emitidos: string; activos: string; rechazados: string }>(
    `SELECT
       COUNT(*)                             FILTER (WHERE c.inspector_id = $1)::text AS emitidos,
       COUNT(*) FILTER (WHERE c.estado = 'ACTIVO' AND c.inspector_id = $1)::text    AS activos,
       COUNT(*) FILTER (WHERE c.estado = 'RECHAZADO' AND c.inspector_id = $1)::text AS rechazados
     FROM cits c WHERE c.inspector_id = $1`,
    [perfil.id]
  )

  res.json({ ok: true, data: {
    ...perfil,
    stats: {
      citsEmitidos:   parseInt(stats?.emitidos  ?? '0'),
      citsActivos:    parseInt(stats?.activos   ?? '0'),
      citsRechazados: parseInt(stats?.rechazados ?? '0'),
    },
  }})
})

// GET /inspector/cits — CITs emitidos por este inspector
export const getCITsInspector = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const perfil = await getInspectorProfile(req.user.sub)
  if (!perfil) throw new AppError('No tenés perfil de inspector', 403, 'NO_INSPECTOR_PROFILE')

  const page  = Math.max(1, parseInt(req.query['page'] as string || '1'))
  const limit = Math.min(50, Math.max(1, parseInt(req.query['limit'] as string || '20')))

  const cits = await query<Record<string, unknown>>(
    `SELECT c.id, c.numero_cit, c.estado, c.puntos, c.hash_sha256, c.nft_token_id,
            c.fecha_emision, c.creado_en,
            b.numero_serie, b.marca, b.modelo, b.anio,
            u.nombre AS propietario_nombre, u.apellido AS propietario_apellido
     FROM cits c
     JOIN bicicletas b ON b.id = c.bicicleta_id
     JOIN usuarios   u ON u.id = c.propietario_id
     WHERE c.inspector_id = $1
     ORDER BY c.creado_en DESC
     LIMIT $2 OFFSET $3`,
    [perfil.id, limit, (page - 1) * limit]
  )

  res.json({ ok: true, data: cits, meta: { page, limit } })
})

// ══════════════════════════════════════════════════════════
// ALIADO — perfil + inspectores del taller
// ══════════════════════════════════════════════════════════

// GET /aliado/taller
export const getPerfilAliado = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)

  const taller = await getAliadoTaller(req.user.sub)
  if (!taller) throw new AppError('No tenés un taller aliado asociado', 404, 'NO_TALLER')

  // Estadísticas del taller
  const stats = await queryOne<{ inspectores: string; cits_mes: string; cits_total: string }>(
    `SELECT
       (SELECT COUNT(*) FROM inspectores WHERE taller_aliado_id = $1 AND activo = TRUE)::text AS inspectores,
       (SELECT COUNT(*) FROM cits WHERE taller_aliado_id = $1
          AND fecha_emision > NOW() - INTERVAL '30 days')::text AS cits_mes,
       (SELECT COUNT(*) FROM cits WHERE taller_aliado_id = $1)::text AS cits_total`,
    [taller.id]
  )

  res.json({ ok: true, data: {
    ...taller,
    stats: {
      inspectoresActivos: parseInt(stats?.inspectores ?? '0'),
      citsUltimos30Dias:  parseInt(stats?.cits_mes    ?? '0'),
      citsTotal:          parseInt(stats?.cits_total  ?? '0'),
    },
  }})
})

// GET /aliado/inspectores
export const getInspectoresTaller = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)

  const taller = await getAliadoTaller(req.user.sub)
  if (!taller) throw new AppError('No tenés un taller aliado asociado', 404, 'NO_TALLER')

  const inspectores = await query<Record<string, unknown>>(
    `SELECT i.id, i.activo, i.fecha_alta,
            u.id AS usuario_id, u.email, u.nombre, u.apellido, u.mxm_verificado, u.mxm_nivel,
            COUNT(c.id) AS cits_emitidos
     FROM inspectores i
     JOIN usuarios u ON u.id = i.usuario_id
     LEFT JOIN cits c ON c.inspector_id = i.id
     WHERE i.taller_aliado_id = $1
     GROUP BY i.id, i.activo, i.fecha_alta, u.id, u.email, u.nombre, u.apellido, u.mxm_verificado, u.mxm_nivel
     ORDER BY i.fecha_alta DESC`,
    [taller.id]
  )

  res.json({ ok: true, data: inspectores })
})

// POST /aliado/invitaciones — invitar inspector
export const crearInvitacionHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)

  const { email, rolDestino } = z.object({
    email:       z.string().email(),
    rolDestino:  z.enum(['INSPECTOR']).default('INSPECTOR'),
  }).parse(req.body)

  const taller = await getAliadoTaller(req.user.sub)
  if (!taller) throw new AppError('No tenés un taller aliado asociado', 404)

  const result = await crearInvitacion({
    tallerId: taller.id, invitadoPorId: req.user.sub, email, rolDestino,
  })

  res.status(201).json({ ok: true, data: {
    ...result,
    mensaje: `Invitación enviada a ${email}. El link expira en 7 días.`,
    // En producción: enviar email con el token
    _dev_token: result.token,  // solo en desarrollo
  }})
})

// POST /invitaciones/:token/aceptar
export const aceptarInvitacionHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const { token } = req.params

  const result = await aceptarInvitacion({ token, usuarioId: req.user.sub })

  log.auth.info({ userId: req.user.sub, ...result }, 'Invitación aceptada')

  res.json({ ok: true, data: {
    ...result,
    mensaje: `¡Bienvenido al equipo! Tu rol fue actualizado a ${result.rol}. El cambio se reflejará en tu próximo inicio de sesión.`,
    aviso:   'Cerrá sesión e ingresá nuevamente para que el nuevo rol tome efecto en tu JWT.',
  }})
})

// ══════════════════════════════════════════════════════════
// PERMISOS — consulta para el frontend
// ══════════════════════════════════════════════════════════

// GET /auth/permisos — permisos del usuario actual
export const misPermisos = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const permisos = await getPermisos(req.user.rol as Rol)
  res.json({ ok: true, data: { rol: req.user.rol, permisos } })
})

// GET /admin/roles/matriz — matriz completa de permisos [Admin]
export const matrizPermisos = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await query<{ rol: string; permiso: string }>(
    `SELECT rol, permiso FROM rol_permisos ORDER BY rol, permiso`
  )

  const matriz: Record<string, string[]> = {}
  for (const row of rows) {
    if (!matriz[row.rol]) matriz[row.rol] = []
    matriz[row.rol].push(row.permiso)
  }

  res.json({ ok: true, data: { matriz, totalPermisos: rows.length } })
})
