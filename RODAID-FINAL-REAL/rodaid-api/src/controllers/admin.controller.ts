// ─── RODAID · Admin Controller — Roles & Gestión ─────────
import { Request, Response } from 'express'
import { z } from 'zod'
import { AuthRequest } from '../types'
import { AppError, asyncHandler } from '../middleware/errorHandler'
import { log } from '../middleware/logger'
import {
  can, getPermissions, getRolesSummary,
  assignRole, registerInspector, certifyInspector,
  listUsuariosByRol, listInspectores, listTalleres,
  requireInspectorProfile, getAliHandler, Rol, Permiso,
} from '../services/rbac.service'
import { query, queryOne } from '../config/database'

// GET /api/v1/roles
export const getRolesInfo = asyncHandler(async (_req: Request, res: Response) => {
  const summary = getRolesSummary()
  const info = {
    CICLISTA:  { emoji:'🚲', descripcion:'Propietario de bicicletas. Garaje Digital, CITs, Marketplace y denuncias.', ...summary.CICLISTA },
    INSPECTOR: { emoji:'🔧', descripcion:'Técnico certificado. Emite CITs con 20 puntos de inspección según Ley 9556.', ...summary.INSPECTOR },
    ALIADO:    { emoji:'🏪', descripcion:'Propietario o gestor de Taller Aliado. Administra taller e inspectores.', ...summary.ALIADO },
    ADMIN:     { emoji:'⚙️', descripcion:'Administrador RODAID. Gestión de roles, talleres, inspectores y sistema.', ...summary.ADMIN },
  }
  res.json({ ok: true, data: info })
})

// GET /api/v1/roles/mine
export const getMyPermissions = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const perms = getPermissions(req.user.rol as Rol)
  res.json({ ok: true, data: { rol: req.user.rol, permissions: perms, count: perms.length } })
})

// GET /api/v1/roles/check/:permiso
export const checkPermission = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const permiso = req.params.permiso as Permiso
  const allowed = can(req.user.rol as Rol, permiso)
  res.json({ ok: true, data: { permiso, allowed, rol: req.user.rol } })
})

// GET /api/v1/admin/usuarios
export const listUsuarios = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { rol, page, limit } = z.object({
    rol:   z.enum(['CICLISTA','INSPECTOR','ALIADO','ADMIN']).optional(),
    page:  z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).parse(req.query)
  const result = await listUsuariosByRol(rol as Rol | undefined, page, limit)
  res.json({ ok: true, data: result })
})

// POST /api/v1/admin/usuarios/:id/rol
export const asignarRol = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const { rol, motivo } = z.object({
    rol:    z.enum(['CICLISTA','INSPECTOR','ALIADO','ADMIN']),
    motivo: z.string().max(500).optional(),
  }).parse(req.body)
  await assignRole({ usuarioId: req.params.id, newRol: rol as Rol, adminId: req.user.sub, motivo })
  res.json({ ok: true, data: { usuarioId: req.params.id, nuevoRol: rol, mensaje: `Rol actualizado a ${rol}. Cambio en próximo login.` } })
})

// GET /api/v1/admin/inspectores
export const getInspectores = asyncHandler(async (req: Request, res: Response) => {
  const { taller } = z.object({ taller: z.string().uuid().optional() }).parse(req.query)
  res.json({ ok: true, data: await listInspectores(taller) })
})

// POST /api/v1/admin/inspectores
export const crearInspector = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const data = z.object({
    usuarioId:      z.string().uuid(),
    tallerAliadoId: z.string().uuid(),
    certificacion:  z.string().max(200).optional(),
    notas:          z.string().max(1000).optional(),
  }).parse(req.body)
  const profile = await registerInspector({ ...data, adminId: req.user.sub })
  res.status(201).json({ ok: true, data: { ...profile, mensaje: 'Inspector registrado. Pendiente de certificación.' } })
})

// POST /api/v1/admin/inspectores/:id/certificar
export const certificarInspector = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const { certificacion } = z.object({ certificacion: z.string().min(3).max(200) }).parse(req.body)
  await certifyInspector(req.params.id, req.user.sub, certificacion)
  res.json({ ok: true, data: { inspectorId: req.params.id, certificado: true, mensaje: 'Inspector certificado. Ya puede emitir CITs.' } })
})

// PATCH /api/v1/admin/inspectores/:id/habilitar
export const habilitarInspector = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const insp = await queryOne<{ activo: boolean }>('SELECT activo FROM inspectores WHERE id=$1', [req.params.id])
  if (!insp) throw new AppError('Inspector no encontrado', 404)
  const newActivo = !insp.activo
  await query(
    `UPDATE inspectores SET activo=$2, fecha_${newActivo?'alta':'baja'}=NOW(), habilitado_por=$3 WHERE id=$1`,
    [req.params.id, newActivo, req.user.sub]
  )
  log.auth.info({ inspectorId: req.params.id, activo: newActivo }, 'Inspector habilitación cambiada')
  res.json({ ok: true, data: { inspectorId: req.params.id, activo: newActivo } })
})

// GET /api/v1/inspector/perfil
export const getMiPerfilInspector = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const profile = await requireInspectorProfile(req.user.sub)
  const stats = await queryOne<{ total: string; activos: string; mes: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE c.estado='ACTIVO')::text AS activos,
            COUNT(*) FILTER (WHERE c.creado_en>NOW()-INTERVAL '30d')::text AS mes
     FROM cits c JOIN inspectores i ON i.id=c.inspector_id WHERE i.usuario_id=$1`,
    [req.user.sub]
  )
  res.json({ ok: true, data: { ...profile, stats: { totalCITs: parseInt(stats?.total??'0'), citsActivos: parseInt(stats?.activos??'0'), citsEsteMes: parseInt(stats?.mes??'0') } } })
})

// GET /api/v1/admin/talleres
export const getTalleres = asyncHandler(async (req: Request, res: Response) => {
  const { habilitados } = z.object({ habilitados: z.enum(['true','false']).optional() }).parse(req.query)
  res.json({ ok: true, data: await listTalleres(habilitados===undefined ? undefined : habilitados==='true') })
})

// POST /api/v1/admin/talleres
export const crearTaller = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const data = z.object({
    nombre: z.string().min(3).max(200), direccion: z.string().min(5).max(300),
    localidad: z.string().min(2).max(100), provincia: z.string().default('Mendoza'),
    lat: z.number().optional(), lng: z.number().optional(),
    telefono: z.string().max(30).optional(), email: z.string().email().optional(),
    descripcion: z.string().max(1000).optional(),
    planAliado: z.enum(['base','estandar','premium']).default('base'),
    propietarioId: z.string().uuid().optional(),
  }).parse(req.body)
  const rows = await query<{ id: string; nombre: string }>(
    `INSERT INTO talleres_aliados (nombre,direccion,localidad,provincia,lat,lng,telefono,email,descripcion,plan_aliado,propietario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,nombre`,
    [data.nombre,data.direccion,data.localidad,data.provincia,data.lat??null,data.lng??null,
     data.telefono??null,data.email??null,data.descripcion??null,data.planAliado,data.propietarioId??null]
  )
  if (data.propietarioId) {
    await assignRole({ usuarioId: data.propietarioId, newRol: 'ALIADO', adminId: req.user.sub, motivo: `Propietario: ${rows[0].nombre}` }).catch(()=>{})
  }
  log.auth.info({ tallerId: rows[0].id, adminId: req.user.sub }, 'Taller creado')
  res.status(201).json({ ok: true, data: rows[0] })
})

// PATCH /api/v1/admin/talleres/:id/habilitar
export const habilitarTaller = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const { motivo } = z.object({ motivo: z.string().max(500).optional() }).parse(req.body)
  const taller = await queryOne<{ nombre: string; habilitado: boolean }>('SELECT nombre,habilitado FROM talleres_aliados WHERE id=$1',[req.params.id])
  if (!taller) throw new AppError('Taller no encontrado', 404)
  const newHab = !taller.habilitado
  await query('UPDATE talleres_aliados SET habilitado=$2,actualizado_en=NOW() WHERE id=$1',[req.params.id,newHab])
  log.auth.info({ tallerId: req.params.id, habilitado: newHab, motivo }, 'Taller habilitación cambiada')
  res.json({ ok: true, data: { tallerId: req.params.id, nombre: taller.nombre, habilitado: newHab } })
})

// GET /api/v1/aliado/mi-taller
export const getMiTaller = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('No autenticado', 401)
  const ah = await getAliHandler(req.user.sub)
  const taller = await queryOne<Record<string, unknown>>(
    `SELECT ta.*, COUNT(i.id)::int AS inspectores_activos,
            COUNT(c.id) FILTER (WHERE c.creado_en>NOW()-INTERVAL '30d')::int AS cits_este_mes
     FROM talleres_aliados ta
     LEFT JOIN inspectores i ON i.taller_aliado_id=ta.id AND i.activo=TRUE
     LEFT JOIN cits c ON c.taller_aliado_id=ta.id
     WHERE ta.id=$1 GROUP BY ta.id`,
    [ah.tallerAliadoId]
  )
  res.json({ ok: true, data: taller })
})
