// ─── RODAID · RBAC — Role-Based Access Control ───────────
//
// 4 roles con jerarquía y herencia:
//
//   CICLISTA  → propietario de bicicletas, marketplace, denuncias
//   INSPECTOR → hereda CICLISTA + puede emitir CITs en su taller
//   ALIADO    → dueño de taller, gestiona inspectores propios
//   ADMIN     → acceso total + gestión de roles y habilitaciones
//
// La verificación de permisos es síncrona (sin DB) — la
// fuente de verdad es el JWT claim `rol`.
// El perfil de inspector (activo, taller vinculado) sí
// requiere DB — se usa solo en endpoints de emisión de CIT.

import { query, queryOne } from '../config/database'
import { AppError } from '../middleware/errorHandler'
import { log } from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// PERMISOS DISPONIBLES
// ══════════════════════════════════════════════════════════

export const PERMISOS = [
  // Bicicletas (Garaje Digital)
  'bicicletas:read',
  'bicicletas:create',
  'bicicletas:update',

  // CIT — Certificado de Identidad Técnica
  'cit:read',
  'cit:verificar',      // público — verificar serial
  'cit:iniciar',        // INSPECTOR: emitir nuevo CIT
  'cit:validar',        // ADMIN/WORKER: cross-reference Min.Seg
  'cit:finalizar',      // ADMIN/WORKER: acuñar NFT en BFA
  'cit:denunciar',      // CICLISTA: denunciar robo

  // Marketplace
  'marketplace:read',
  'marketplace:create', // publicar bicicleta
  'marketplace:update', // editar propia publicación
  'marketplace:comprar',
  'marketplace:confirmar',

  // Seguridad / denuncias
  'denuncia:create',
  'denuncia:read',      // ver propias denuncias
  'denuncia:recuperar',

  // Inspector
  'inspector:read',     // ver perfil propio
  'inspector:list',     // ALIADO: ver inspectores de su taller

  // Taller Aliado
  'taller:read',
  'taller:update',      // ALIADO: actualizar su propio taller
  'taller:create',      // ADMIN
  'taller:habilitar',   // ADMIN

  // Usuarios / Admin
  'usuario:read:own',   // leer perfil propio
  'usuario:read:all',   // ADMIN: leer todos los usuarios
  'usuario:update:own',
  'usuario:update:all', // ADMIN
  'roles:assign',       // ADMIN: cambiar roles
  'inspector:certify',  // ADMIN: certificar inspector
  'inspector:habilitar',// ADMIN: habilitar/deshabilitar
  'admin:queue',        // ADMIN: gestión de colas Bull
  'admin:tokens',       // ADMIN: purgar tokens
  'admin:rate-limits',  // ADMIN: ver rate limits
  'admin:health:deep',  // ADMIN: health check completo
] as const

export type Permiso = typeof PERMISOS[number]
export type Rol     = 'CICLISTA' | 'INSPECTOR' | 'ALIADO' | 'ADMIN'

// ══════════════════════════════════════════════════════════
// MATRIZ DE PERMISOS
// Cada rol lista sus permisos directos.
// ADMIN hereda todo — se define explícitamente para claridad.
// ══════════════════════════════════════════════════════════

const PERMISSIONS_MAP: Record<Rol, ReadonlySet<Permiso>> = {

  CICLISTA: new Set<Permiso>([
    'bicicletas:read', 'bicicletas:create', 'bicicletas:update',
    'cit:read', 'cit:verificar', 'cit:denunciar',
    'marketplace:read', 'marketplace:create', 'marketplace:update',
    'marketplace:comprar', 'marketplace:confirmar',
    'denuncia:create', 'denuncia:read', 'denuncia:recuperar',
    'usuario:read:own', 'usuario:update:own',
  ]),

  INSPECTOR: new Set<Permiso>([
    // Hereda todo CICLISTA
    'bicicletas:read', 'bicicletas:create', 'bicicletas:update',
    'cit:read', 'cit:verificar', 'cit:denunciar',
    'marketplace:read', 'marketplace:create', 'marketplace:update',
    'marketplace:comprar', 'marketplace:confirmar',
    'denuncia:create', 'denuncia:read', 'denuncia:recuperar',
    'usuario:read:own', 'usuario:update:own',
    // Exclusivos INSPECTOR
    'cit:iniciar',
    'inspector:read',
    'taller:read',
  ]),

  ALIADO: new Set<Permiso>([
    // Hereda todo CICLISTA
    'bicicletas:read', 'bicicletas:create', 'bicicletas:update',
    'cit:read', 'cit:verificar', 'cit:denunciar',
    'marketplace:read', 'marketplace:create', 'marketplace:update',
    'marketplace:comprar', 'marketplace:confirmar',
    'denuncia:create', 'denuncia:read', 'denuncia:recuperar',
    'usuario:read:own', 'usuario:update:own',
    // Exclusivos ALIADO (propietario de taller)
    'taller:read', 'taller:update',
    'inspector:read', 'inspector:list',
  ]),

  ADMIN: new Set<Permiso>([
    // Todos los permisos
    ...PERMISOS,
  ]),
}

// ══════════════════════════════════════════════════════════
// FUNCIONES DE VERIFICACIÓN
// ══════════════════════════════════════════════════════════

// Verificación síncrona — no consulta DB
export function can(rol: Rol, permiso: Permiso): boolean {
  return PERMISSIONS_MAP[rol]?.has(permiso) ?? false
}

// Lista todos los permisos de un rol
export function getPermissions(rol: Rol): Permiso[] {
  return [...(PERMISSIONS_MAP[rol] ?? [])]
}

// Verifica múltiples permisos (AND — todos deben cumplirse)
export function canAll(rol: Rol, permisos: Permiso[]): boolean {
  return permisos.every(p => can(rol, p))
}

// Verifica múltiples permisos (OR — al menos uno)
export function canAny(rol: Rol, permisos: Permiso[]): boolean {
  return permisos.some(p => can(rol, p))
}

// ══════════════════════════════════════════════════════════
// TIPOS PARA PERFILES EXTENDIDOS
// ══════════════════════════════════════════════════════════

export interface InspectorProfile {
  inspectorId:    string
  tallerAliadoId: string
  tallerNombre:   string
  tallerLocalidad: string
  certificado:    boolean
  habilitado:     boolean
}

export interface AliHandler {
  tallerAliadoId: string
  tallerNombre:   string
  planAliado:     string
  habilitado:     boolean
}

// ══════════════════════════════════════════════════════════
// PERFIL DE INSPECTOR — requiere DB
// ══════════════════════════════════════════════════════════

// Verifica que el usuario tiene un perfil de inspector
// activo y habilitado — lanza AppError si no
export async function requireInspectorProfile(userId: string): Promise<InspectorProfile> {
  const profile = await queryOne<{
    id: string; taller_aliado_id: string; taller_nombre: string
    taller_localidad: string; certificado: boolean; activo: boolean; habilitado: boolean
  }>(
    `SELECT i.id, i.taller_aliado_id, ta.nombre AS taller_nombre,
            ta.localidad AS taller_localidad,
            i.certificado, i.activo,
            (i.activo AND ta.habilitado AND ta.activo) AS habilitado
     FROM inspectores i
     JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
     WHERE i.usuario_id = $1`,
    [userId]
  )

  if (!profile) {
    throw new AppError(
      'No tenés un perfil de inspector registrado. Contactá a un Taller Aliado.',
      403, 'NO_INSPECTOR_PROFILE'
    )
  }

  if (!profile.activo) {
    throw new AppError('Tu perfil de inspector está inactivo.', 403, 'INSPECTOR_INACTIVE')
  }

  if (!profile.habilitado) {
    throw new AppError(
      'Tu taller aliado no está habilitado. Contactá al soporte de RODAID.',
      403, 'TALLER_DESHABILITADO'
    )
  }

  return {
    inspectorId:     profile.id,
    tallerAliadoId:  profile.taller_aliado_id,
    tallerNombre:    profile.taller_nombre,
    tallerLocalidad: profile.taller_localidad,
    certificado:     profile.certificado,
    habilitado:      profile.habilitado,
  }
}

// Obtener el taller de un usuario ALIADO
export async function getAliHandler(userId: string): Promise<AliHandler> {
  const taller = await queryOne<{
    id: string; nombre: string; plan_aliado: string; habilitado: boolean; activo: boolean
  }>(
    `SELECT id, nombre, plan_aliado, habilitado, activo
     FROM talleres_aliados WHERE propietario_id = $1`,
    [userId]
  )

  if (!taller) {
    throw new AppError('No tenés un taller aliado registrado.', 403, 'NO_TALLER_ALIADO')
  }

  return {
    tallerAliadoId: taller.id,
    tallerNombre:   taller.nombre,
    planAliado:     taller.plan_aliado,
    habilitado:     taller.habilitado && taller.activo,
  }
}

// ══════════════════════════════════════════════════════════
// GESTIÓN DE ROLES — operaciones de Admin
// ══════════════════════════════════════════════════════════

export interface RoleAssignment {
  usuarioId:   string
  newRol:      Rol
  adminId:     string
  motivo?:     string
}

export async function assignRole({ usuarioId, newRol, adminId, motivo }: RoleAssignment): Promise<void> {
  // Verificar que el usuario existe
  const usuario = await queryOne<{ id: string; rol: string; email: string }>(
    `SELECT id, rol, email FROM usuarios WHERE id = $1 AND activo = TRUE`,
    [usuarioId]
  )
  if (!usuario) throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND')

  const oldRol = usuario.rol

  // No puede auto-asignarse admin (excepto si ya es admin)
  if (newRol === 'ADMIN' && usuarioId === adminId) {
    throw new AppError('No podés auto-asignarte el rol ADMIN', 403, 'SELF_ROLE_ESCALATION')
  }

  // Si se asigna INSPECTOR, el perfil de inspector se gestiona por separado
  // Aquí solo cambiamos el claim de rol en el JWT (se refleja en próximo login)
  await query(
    `UPDATE usuarios SET rol = $2, actualizado_en = NOW() WHERE id = $1`,
    [usuarioId, newRol]
  )

  log.auth.info({
    userId:  usuarioId, email: usuario.email,
    oldRol, newRol, adminId, motivo,
  }, `Rol actualizado: ${oldRol} → ${newRol}`)

  // Si se degrada de INSPECTOR a otro rol, desactivar perfil de inspector
  if (oldRol === 'INSPECTOR' && newRol !== 'INSPECTOR' && newRol !== 'ADMIN') {
    await query(
      `UPDATE inspectores SET activo = FALSE, fecha_baja = NOW()
       WHERE usuario_id = $1 AND activo = TRUE`,
      [usuarioId]
    ).catch(() => {}) // best-effort
  }
}

// Registrar un nuevo inspector (vincula usuario a taller)
export interface RegisterInspectorInput {
  usuarioId:       string
  tallerAliadoId:  string
  adminId:         string
  certificacion?:  string
  notas?:          string
}

export async function registerInspector(input: RegisterInspectorInput): Promise<InspectorProfile> {
  // Verificar que el taller existe y está habilitado
  const taller = await queryOne<{ id: string; nombre: string; localidad: string; habilitado: boolean }>(
    `SELECT id, nombre, localidad, habilitado FROM talleres_aliados WHERE id = $1 AND activo = TRUE`,
    [input.tallerAliadoId]
  )
  if (!taller) throw new AppError('Taller aliado no encontrado', 404, 'TALLER_NOT_FOUND')
  if (!taller.habilitado) throw new AppError('El taller no está habilitado', 409, 'TALLER_DESHABILITADO')

  // Verificar que el usuario existe y no es ya inspector
  const usuario = await queryOne<{ id: string; rol: string }>(
    `SELECT id, rol FROM usuarios WHERE id = $1 AND activo = TRUE`, [input.usuarioId]
  )
  if (!usuario) throw new AppError('Usuario no encontrado', 404)

  // Crear o reactivar perfil de inspector + cambiar rol
  const rows = await query<{ id: string }>(
    `INSERT INTO inspectores
       (usuario_id, taller_aliado_id, certificado, activo, habilitado_por, certificacion, notas)
     VALUES ($1, $2, FALSE, TRUE, $3, $4, $5)
     ON CONFLICT (usuario_id)
     DO UPDATE SET
       taller_aliado_id = EXCLUDED.taller_aliado_id,
       activo           = TRUE,
       fecha_baja       = NULL,
       fecha_alta       = NOW(),
       habilitado_por   = EXCLUDED.habilitado_por,
       certificacion    = COALESCE(EXCLUDED.certificacion, inspectores.certificacion),
       notas            = COALESCE(EXCLUDED.notas, inspectores.notas)
     RETURNING id`,
    [input.usuarioId, input.tallerAliadoId, input.adminId,
     input.certificacion ?? null, input.notas ?? null]
  )

  // Cambiar rol a INSPECTOR
  await query(
    `UPDATE usuarios SET rol = 'INSPECTOR', actualizado_en = NOW() WHERE id = $1`,
    [input.usuarioId]
  )

  log.auth.info({
    inspectorId: rows[0].id, userId: input.usuarioId,
    tallerId: input.tallerAliadoId, tallerNombre: taller.nombre,
  }, 'Inspector registrado')

  return {
    inspectorId:     rows[0].id,
    tallerAliadoId:  taller.id,
    tallerNombre:    taller.nombre,
    tallerLocalidad: taller.localidad,
    certificado:     false,
    habilitado:      true,
  }
}

// Certificar inspector (ADMIN — habilita a emitir CITs)
export async function certifyInspector(
  inspectorId: string, adminId: string, certificacion: string
): Promise<void> {
  const result = await query<{ id: string }>(
    `UPDATE inspectores
     SET certificado = TRUE, certificacion = $2, habilitado_por = $3
     WHERE id = $1 AND activo = TRUE
     RETURNING id`,
    [inspectorId, certificacion, adminId]
  )
  if (!result.length) throw new AppError('Inspector no encontrado', 404)
  log.auth.info({ inspectorId, adminId, certificacion }, 'Inspector certificado')
}

// ══════════════════════════════════════════════════════════
// QUERIES ADMIN — listas y reportes
// ══════════════════════════════════════════════════════════

export async function listUsuariosByRol(rol?: Rol, page = 1, limit = 20) {
  const offset = (page - 1) * limit
  const where  = rol ? `WHERE u.rol = '${rol}'` : ''

  const [total] = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM usuarios u ${where}`
  )
  const items = await query<Record<string, unknown>>(
    `SELECT u.id, u.email, u.nombre, u.apellido, u.rol, u.activo,
            u.email_verificado, u.mxm_verificado, u.mxm_nivel,
            u.creado_en, p.nombre AS plan,
            i.id AS inspector_id, i.certificado, ta.nombre AS taller
     FROM usuarios u
     LEFT JOIN planes p ON p.id = u.plan_id
     LEFT JOIN inspectores i ON i.usuario_id = u.id AND i.activo = TRUE
     LEFT JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
     ${where}
     ORDER BY u.creado_en DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )

  return { items, total: parseInt(total?.count ?? '0'), page, limit }
}

export async function listInspectores(tallerAliadoId?: string) {
  const where = tallerAliadoId ? `AND i.taller_aliado_id = '${tallerAliadoId}'` : ''
  return query<Record<string, unknown>>(
    `SELECT i.id, i.certificado, i.activo, i.fecha_alta, i.certificacion,
            u.nombre, u.apellido, u.email, u.dni,
            ta.nombre AS taller, ta.localidad
     FROM inspectores i
     JOIN usuarios u ON u.id = i.usuario_id
     JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
     WHERE i.activo = TRUE ${where}
     ORDER BY i.fecha_alta DESC`
  )
}

export async function listTalleres(habilitados?: boolean) {
  const where = habilitados !== undefined ? `WHERE habilitado = ${habilitados}` : ''
  return query<Record<string, unknown>>(
    `SELECT ta.id, ta.nombre, ta.localidad, ta.direccion, ta.plan_aliado,
            ta.habilitado, ta.activo, ta.creado_en,
            u.nombre AS propietario_nombre, u.email AS propietario_email,
            COUNT(i.id)::int AS inspectores_activos
     FROM talleres_aliados ta
     LEFT JOIN usuarios u ON u.id = ta.propietario_id
     LEFT JOIN inspectores i ON i.taller_aliado_id = ta.id AND i.activo = TRUE
     ${where}
     GROUP BY ta.id, u.nombre, u.email
     ORDER BY ta.nombre`
  )
}

// ══════════════════════════════════════════════════════════
// RESUMEN DE PERMISOS — para documentación y debug
// ══════════════════════════════════════════════════════════

export function getRolesSummary(): Record<Rol, { permissions: Permiso[]; count: number }> {
  return (Object.keys(PERMISSIONS_MAP) as Rol[]).reduce((acc, rol) => {
    const perms = [...PERMISSIONS_MAP[rol]]
    acc[rol] = { permissions: perms, count: perms.length }
    return acc
  }, {} as Record<Rol, { permissions: Permiso[]; count: number }>)
}
