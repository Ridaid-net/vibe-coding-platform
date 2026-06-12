import { createHash, randomInt } from 'node:crypto'
import { ApiError, getPool } from '@/lib/marketplace'

/**
 * RODAID — RBAC + gestión de inspectores y talleres aliados.
 *
 * Cuatro roles con herencia acumulativa:
 *
 *   CICLISTA  → propietario de bicicletas, marketplace y denuncias
 *   INSPECTOR → hereda CICLISTA + emite CITs en su taller
 *   ALIADO    → dueño de taller, gestiona sus inspectores
 *   ADMIN     → acceso total + gestión de roles, talleres e inspectores
 *
 * La verificación de permisos es síncrona y sin DB: la matriz vive en el código
 * (`PERMISSIONS_MAP`) y la fuente del rol es la tabla `usuarios` (con respaldo en
 * el claim `rol` del JWT). El perfil de inspector (activo + taller habilitado) sí
 * consulta la DB y solo se exige en la emisión de CITs.
 */

export type Rol = 'CICLISTA' | 'INSPECTOR' | 'ALIADO' | 'ADMIN'

export const ROLES: Rol[] = ['CICLISTA', 'INSPECTOR', 'ALIADO', 'ADMIN']

export const PERMISOS = [
  // Bicicletas (Garaje Digital)
  'bicicletas:read',
  'bicicletas:create',
  'bicicletas:update',
  // CIT
  'cit:read',
  'cit:verificar',
  'cit:iniciar',
  'cit:validar',
  'cit:finalizar',
  'cit:denunciar',
  // Marketplace
  'marketplace:read',
  'marketplace:create',
  'marketplace:update',
  'marketplace:comprar',
  'marketplace:confirmar',
  // Seguridad / denuncias
  'denuncia:create',
  'denuncia:read',
  'denuncia:recuperar',
  // Inspector
  'inspector:read',
  'inspector:list',
  // Taller aliado
  'taller:read',
  'taller:update',
  'taller:create',
  'taller:habilitar',
  // Usuarios / Admin
  'usuario:read:own',
  'usuario:read:all',
  'usuario:update:own',
  'usuario:update:all',
  'roles:assign',
  'inspector:certify',
  'inspector:habilitar',
  'admin:queue',
] as const

export type Permiso = (typeof PERMISOS)[number]

const CICLISTA_PERMS: Permiso[] = [
  'bicicletas:read', 'bicicletas:create', 'bicicletas:update',
  'cit:read', 'cit:verificar', 'cit:denunciar',
  'marketplace:read', 'marketplace:create', 'marketplace:update',
  'marketplace:comprar', 'marketplace:confirmar',
  'denuncia:create', 'denuncia:read', 'denuncia:recuperar',
  'usuario:read:own', 'usuario:update:own',
]

const PERMISSIONS_MAP: Record<Rol, ReadonlySet<Permiso>> = {
  CICLISTA: new Set<Permiso>(CICLISTA_PERMS),
  INSPECTOR: new Set<Permiso>([
    ...CICLISTA_PERMS,
    'cit:iniciar', 'inspector:read', 'taller:read',
  ]),
  ALIADO: new Set<Permiso>([
    ...CICLISTA_PERMS,
    'taller:read', 'taller:update', 'inspector:read', 'inspector:list',
  ]),
  ADMIN: new Set<Permiso>([...PERMISOS]),
}

const ROLES_DESCRIPCION: Record<Rol, { emoji: string; descripcion: string }> = {
  CICLISTA: {
    emoji: '🚲',
    descripcion: 'Propietario de bicicletas. Garaje Digital, CITs, Marketplace y denuncias.',
  },
  INSPECTOR: {
    emoji: '🔧',
    descripcion: 'Técnico certificado. Emite CITs con 20 puntos de inspección según Ley 9556.',
  },
  ALIADO: {
    emoji: '🏪',
    descripcion: 'Propietario o gestor de un Taller Aliado. Administra el taller y sus inspectores.',
  },
  ADMIN: {
    emoji: '⚙️',
    descripcion: 'Administración RODAID. Gestión de roles, talleres, inspectores y sistema.',
  },
}

export function esRolValido(value: unknown): value is Rol {
  return typeof value === 'string' && (ROLES as string[]).includes(value)
}

export function can(rol: Rol, permiso: Permiso): boolean {
  return PERMISSIONS_MAP[rol]?.has(permiso) ?? false
}

export function getPermisos(rol: Rol): Permiso[] {
  return [...(PERMISSIONS_MAP[rol] ?? [])]
}

export function rolesInfo() {
  return ROLES.map((rol) => {
    const permisos = getPermisos(rol)
    return {
      rol,
      ...ROLES_DESCRIPCION[rol],
      permisos,
      totalPermisos: permisos.length,
    }
  })
}

/**
 * Resuelve el rol efectivo de un usuario: la tabla `usuarios` es la fuente de
 * verdad (refleja los cambios de rol del admin); si el usuario no está en la DB
 * se usa el claim `rol` del JWT y, en última instancia, CICLISTA.
 */
export async function resolverRol(userId: string, jwtRol?: string | null): Promise<Rol> {
  const pool = getPool()
  const { rows } = await pool.query<{ rol: string }>(
    `SELECT rol FROM usuarios WHERE id = $1 AND activo = TRUE`,
    [userId]
  )
  const dbRol = rows[0]?.rol
  if (esRolValido(dbRol)) {
    return dbRol
  }
  return esRolValido(jwtRol) ? jwtRol : 'CICLISTA'
}

// ── Perfiles de inspector / taller ────────────────────────

export interface InspectorProfile {
  inspectorId: string
  usuarioId: string
  tallerAliadoId: string
  tallerNombre: string
  tallerLocalidad: string | null
  certificado: boolean
  activo: boolean
  habilitado: boolean
}

interface InspectorProfileRow {
  id: string
  usuario_id: string
  taller_aliado_id: string
  taller_nombre: string
  taller_localidad: string | null
  certificado: boolean
  activo: boolean
  habilitado: boolean
}

export async function getInspectorProfile(userId: string): Promise<InspectorProfile | null> {
  const pool = getPool()
  const { rows } = await pool.query<InspectorProfileRow>(
    `SELECT i.id, i.usuario_id, i.taller_aliado_id,
            ta.nombre AS taller_nombre, ta.localidad AS taller_localidad,
            i.certificado, i.activo,
            (i.activo AND i.certificado AND ta.habilitado AND ta.activo) AS habilitado
       FROM inspectores i
       JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
      WHERE i.usuario_id = $1`,
    [userId]
  )
  const row = rows[0]
  if (!row) {
    return null
  }
  return {
    inspectorId: row.id,
    usuarioId: row.usuario_id,
    tallerAliadoId: row.taller_aliado_id,
    tallerNombre: row.taller_nombre,
    tallerLocalidad: row.taller_localidad,
    certificado: row.certificado,
    activo: row.activo,
    habilitado: row.habilitado,
  }
}

/**
 * Exige un perfil de inspector activo, certificado y con taller habilitado.
 * Lanza ApiError con el motivo concreto si no se cumple.
 */
export async function requireInspectorProfile(userId: string): Promise<InspectorProfile> {
  const profile = await getInspectorProfile(userId)
  if (!profile) {
    throw new ApiError(
      403,
      'NO_INSPECTOR_PROFILE',
      'No tenés un perfil de inspector registrado. Contactá a un Taller Aliado.'
    )
  }
  if (!profile.activo) {
    throw new ApiError(403, 'INSPECTOR_INACTIVE', 'Tu perfil de inspector está inactivo.')
  }
  if (!profile.certificado) {
    throw new ApiError(403, 'INSPECTOR_NO_CERTIFICADO', 'Tu perfil de inspector aún no está certificado.')
  }
  if (!profile.habilitado) {
    throw new ApiError(403, 'TALLER_DESHABILITADO', 'Tu taller aliado no está habilitado.')
  }
  return profile
}

export async function getMiTaller(userId: string) {
  const pool = getPool()
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ta.*,
            COUNT(i.id) FILTER (WHERE i.activo)::int AS inspectores_activos
       FROM talleres_aliados ta
       LEFT JOIN inspectores i ON i.taller_aliado_id = ta.id
      WHERE ta.propietario_id = $1
      GROUP BY ta.id`,
    [userId]
  )
  const taller = rows[0]
  if (!taller) {
    throw new ApiError(404, 'NO_TALLER', 'No tenés un taller aliado asociado.')
  }
  return taller
}

// ── Gestión de usuarios y roles (admin) ───────────────────

export async function listarUsuarios(rol: Rol | undefined, page = 1, limit = 20) {
  const pool = getPool()
  const offset = (page - 1) * limit
  const filtros: unknown[] = []
  let where = ''
  if (rol) {
    filtros.push(rol)
    where = `WHERE u.rol = $1`
  }

  const totalResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM usuarios u ${where}`,
    filtros
  )
  const itemsResult = await pool.query<Record<string, unknown>>(
    `SELECT u.id, u.email, u.nombre, u.rol, u.activo, u.creado_en,
            i.id AS inspector_id, i.certificado AS inspector_certificado,
            ta.nombre AS taller
       FROM usuarios u
       LEFT JOIN inspectores i ON i.usuario_id = u.id AND i.activo = TRUE
       LEFT JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
       ${where}
       ORDER BY u.creado_en DESC
       LIMIT $${filtros.length + 1} OFFSET $${filtros.length + 2}`,
    [...filtros, limit, offset]
  )

  return {
    items: itemsResult.rows,
    total: Number(totalResult.rows[0]?.total ?? 0),
    page,
    limit,
  }
}

export async function cambiarRol(input: {
  usuarioId: string
  nuevoRol: Rol
  adminId: string
}): Promise<{ usuarioId: string; rolAnterior: string; rolNuevo: Rol }> {
  const pool = getPool()
  const { rows } = await pool.query<{ rol: string }>(
    `SELECT rol FROM usuarios WHERE id = $1 AND activo = TRUE`,
    [input.usuarioId]
  )
  const usuario = rows[0]
  if (!usuario) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.')
  }
  if (input.nuevoRol === 'ADMIN' && input.usuarioId === input.adminId) {
    throw new ApiError(403, 'SELF_ROLE_ESCALATION', 'No podés auto-asignarte el rol ADMIN.')
  }

  await pool.query(
    `UPDATE usuarios SET rol = $2, actualizado_en = NOW() WHERE id = $1`,
    [input.usuarioId, input.nuevoRol]
  )

  // Si deja de ser INSPECTOR (y no pasa a ADMIN), se da de baja su perfil.
  if (usuario.rol === 'INSPECTOR' && input.nuevoRol !== 'INSPECTOR' && input.nuevoRol !== 'ADMIN') {
    await pool.query(
      `UPDATE inspectores SET activo = FALSE, fecha_baja = NOW()
        WHERE usuario_id = $1 AND activo = TRUE`,
      [input.usuarioId]
    )
  }

  return { usuarioId: input.usuarioId, rolAnterior: usuario.rol, rolNuevo: input.nuevoRol }
}

// ── Inspectores (admin) ───────────────────────────────────

export async function listarInspectores(tallerAliadoId?: string) {
  const pool = getPool()
  const filtros: unknown[] = []
  let where = `WHERE i.activo = TRUE`
  if (tallerAliadoId) {
    filtros.push(tallerAliadoId)
    where += ` AND i.taller_aliado_id = $1`
  }
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT i.id, i.certificado, i.certificacion, i.activo, i.fecha_alta,
            u.id AS usuario_id, u.email, u.nombre,
            ta.id AS taller_id, ta.nombre AS taller, ta.localidad,
            COUNT(c.id)::int AS cits_emitidos
       FROM inspectores i
       JOIN usuarios u ON u.id = i.usuario_id
       JOIN talleres_aliados ta ON ta.id = i.taller_aliado_id
       LEFT JOIN cits c ON c.inspector_id = i.id
       ${where}
       GROUP BY i.id, u.id, ta.id
       ORDER BY i.fecha_alta DESC`,
    filtros
  )
  return rows
}

export async function registrarInspector(input: {
  usuarioId: string
  tallerAliadoId: string
  adminId: string
  certificacion?: string | null
  notas?: string | null
}) {
  const pool = getPool()
  const tallerResult = await pool.query<{ id: string; nombre: string; localidad: string | null; habilitado: boolean }>(
    `SELECT id, nombre, localidad, habilitado FROM talleres_aliados WHERE id = $1 AND activo = TRUE`,
    [input.tallerAliadoId]
  )
  const taller = tallerResult.rows[0]
  if (!taller) {
    throw new ApiError(404, 'TALLER_NOT_FOUND', 'Taller aliado no encontrado.')
  }
  if (!taller.habilitado) {
    throw new ApiError(409, 'TALLER_DESHABILITADO', 'El taller no está habilitado.')
  }

  const usuarioResult = await pool.query<{ id: string }>(
    `SELECT id FROM usuarios WHERE id = $1 AND activo = TRUE`,
    [input.usuarioId]
  )
  if (!usuarioResult.rows[0]) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.')
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO inspectores
       (usuario_id, taller_aliado_id, certificado, activo, habilitado_por, certificacion, notas)
     VALUES ($1, $2, FALSE, TRUE, $3, $4, $5)
     ON CONFLICT (usuario_id) DO UPDATE SET
       taller_aliado_id = EXCLUDED.taller_aliado_id,
       activo           = TRUE,
       fecha_baja       = NULL,
       fecha_alta       = NOW(),
       habilitado_por   = EXCLUDED.habilitado_por,
       certificacion    = COALESCE(EXCLUDED.certificacion, inspectores.certificacion),
       notas            = COALESCE(EXCLUDED.notas, inspectores.notas)
     RETURNING id`,
    [input.usuarioId, input.tallerAliadoId, input.adminId, input.certificacion ?? null, input.notas ?? null]
  )

  await pool.query(
    `UPDATE usuarios SET rol = 'INSPECTOR', actualizado_en = NOW() WHERE id = $1 AND rol = 'CICLISTA'`,
    [input.usuarioId]
  )

  return {
    inspectorId: inserted.rows[0].id,
    usuarioId: input.usuarioId,
    tallerAliadoId: taller.id,
    tallerNombre: taller.nombre,
    certificado: false,
  }
}

export async function certificarInspector(inspectorId: string, adminId: string, certificacion: string) {
  const pool = getPool()
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE inspectores
        SET certificado = TRUE, certificacion = $2, habilitado_por = $3
      WHERE id = $1 AND activo = TRUE
      RETURNING id`,
    [inspectorId, certificacion, adminId]
  )
  if (!rows[0]) {
    throw new ApiError(404, 'INSPECTOR_NOT_FOUND', 'Inspector no encontrado.')
  }
}

export async function toggleInspector(inspectorId: string, adminId: string) {
  const pool = getPool()
  const { rows } = await pool.query<{ activo: boolean }>(
    `SELECT activo FROM inspectores WHERE id = $1`,
    [inspectorId]
  )
  const inspector = rows[0]
  if (!inspector) {
    throw new ApiError(404, 'INSPECTOR_NOT_FOUND', 'Inspector no encontrado.')
  }
  const nuevoActivo = !inspector.activo
  await pool.query(
    `UPDATE inspectores
        SET activo = $2,
            habilitado_por = $3,
            fecha_alta = CASE WHEN $2 THEN NOW() ELSE fecha_alta END,
            fecha_baja = CASE WHEN $2 THEN NULL ELSE NOW() END
      WHERE id = $1`,
    [inspectorId, nuevoActivo, adminId]
  )
  return { inspectorId, activo: nuevoActivo }
}

// ── Talleres (admin) ──────────────────────────────────────

export async function listarTalleres(habilitado?: boolean) {
  const pool = getPool()
  const filtros: unknown[] = []
  let where = ''
  if (habilitado !== undefined) {
    filtros.push(habilitado)
    where = `WHERE ta.habilitado = $1`
  }
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ta.id, ta.nombre, ta.localidad, ta.direccion, ta.plan_aliado,
            ta.habilitado, ta.activo, ta.creado_en,
            u.nombre AS propietario_nombre, u.email AS propietario_email,
            COUNT(i.id) FILTER (WHERE i.activo)::int AS inspectores_activos
       FROM talleres_aliados ta
       LEFT JOIN usuarios u ON u.id = ta.propietario_id
       LEFT JOIN inspectores i ON i.taller_aliado_id = ta.id
       ${where}
       GROUP BY ta.id, u.nombre, u.email
       ORDER BY ta.nombre`,
    filtros
  )
  return rows
}

export async function crearTaller(input: {
  nombre: string
  direccion?: string | null
  localidad?: string | null
  provincia?: string | null
  telefono?: string | null
  email?: string | null
  descripcion?: string | null
  planAliado?: string | null
  propietarioId?: string | null
  adminId: string
}) {
  const pool = getPool()
  const plan = input.planAliado ?? 'base'
  if (!['base', 'estandar', 'premium'].includes(plan)) {
    throw new ApiError(400, 'PLAN_INVALIDO', 'plan_aliado debe ser base, estandar o premium.')
  }

  if (input.propietarioId) {
    const owner = await pool.query<{ id: string }>(
      `SELECT id FROM usuarios WHERE id = $1 AND activo = TRUE`,
      [input.propietarioId]
    )
    if (!owner.rows[0]) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'El propietario indicado no existe.')
    }
  }

  const { rows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO talleres_aliados
       (nombre, direccion, localidad, provincia, telefono, email, descripcion, plan_aliado, propietario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, nombre, localidad, plan_aliado, propietario_id, habilitado`,
    [
      input.nombre,
      input.direccion ?? null,
      input.localidad ?? null,
      input.provincia ?? 'Mendoza',
      input.telefono ?? null,
      input.email ?? null,
      input.descripcion ?? null,
      plan,
      input.propietarioId ?? null,
    ]
  )

  // Al asignar propietario, se lo promueve a ALIADO (salvo que ya sea ADMIN).
  if (input.propietarioId) {
    await pool.query(
      `UPDATE usuarios SET rol = 'ALIADO', actualizado_en = NOW()
        WHERE id = $1 AND rol IN ('CICLISTA', 'INSPECTOR')`,
      [input.propietarioId]
    )
  }

  return rows[0]
}

export async function toggleTaller(tallerId: string) {
  const pool = getPool()
  const { rows } = await pool.query<{ nombre: string; habilitado: boolean }>(
    `SELECT nombre, habilitado FROM talleres_aliados WHERE id = $1`,
    [tallerId]
  )
  const taller = rows[0]
  if (!taller) {
    throw new ApiError(404, 'TALLER_NOT_FOUND', 'Taller no encontrado.')
  }
  const nuevoHabilitado = !taller.habilitado
  await pool.query(
    `UPDATE talleres_aliados SET habilitado = $2, actualizado_en = NOW() WHERE id = $1`,
    [tallerId, nuevoHabilitado]
  )
  return { tallerId, nombre: taller.nombre, habilitado: nuevoHabilitado }
}

// ── Emisión de CIT (inspector) ────────────────────────────

export const PUNTOS_INSPECCION = [
  'serial', 'cuadro', 'horquilla', 'manubrio', 'freno_delantero', 'freno_trasero',
  'cables', 'cambio_delantero', 'cambio_trasero', 'cassette', 'cadena', 'bielas',
  'pedales', 'rueda_delantera', 'rueda_trasera', 'cubiertas', 'asiento', 'luces',
  'accesorios', 'prueba_funcional',
] as const

export type PuntoInspeccion = (typeof PUNTOS_INSPECCION)[number]
export type PuntosInspeccion = Record<PuntoInspeccion, boolean>

const PUNTOS_MINIMOS = 15
const CIT_VIGENCIA_DIAS = 365

function generarNumeroCIT(): string {
  const year = new Date().getFullYear()
  const seq = randomInt(0, 100000).toString().padStart(5, '0')
  return `RCIT-${year}-${seq}`
}

function hashCIT(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort())
  return '0x' + createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export interface IniciarCITInput {
  bicicletaId: string
  inspectorId: string
  tallerAliadoId: string
  puntos: PuntosInspeccion
  fotosUrls: string[]
  firmaInspector: string
  djFirmada: boolean
  propietarioDNI: string
  propietarioNombre: string
}

/**
 * Emite un nuevo CIT para una bicicleta sin certificado vivo. Valida los 20
 * puntos de inspección (mínimo 15 según Ley 9556), firma la declaración jurada y
 * registra un hash SHA-256 del acta. El CIT queda ACTIVO y vinculado al inspector
 * y taller emisores.
 */
export async function iniciarCIT(input: IniciarCITInput) {
  const pool = getPool()

  const biciResult = await pool.query<{
    id: string
    numero_serie: string
    marca: string
    modelo: string
    anio: number | null
    tipo: string | null
    propietario_id: string
  }>(
    `SELECT id, numero_serie, marca, modelo, anio, tipo, propietario_id
       FROM bicicletas WHERE id = $1`,
    [input.bicicletaId]
  )
  const bici = biciResult.rows[0]
  if (!bici) {
    throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'Bicicleta no encontrada.')
  }

  const citActivo = await pool.query<{ id: string }>(
    `SELECT id FROM cits WHERE bicicleta_id = $1 AND estado IN ('ACTIVO', 'PENDIENTE')`,
    [input.bicicletaId]
  )
  if (citActivo.rows[0]) {
    throw new ApiError(409, 'CIT_DUPLICATE', 'Esta bicicleta ya tiene un CIT activo o en validación.')
  }

  const puntosAprobados = PUNTOS_INSPECCION.filter((punto) => input.puntos[punto] === true).length
  if (puntosAprobados < PUNTOS_MINIMOS) {
    throw new ApiError(
      422,
      'PUNTOS_INSUFICIENTES',
      `Mínimo ${PUNTOS_MINIMOS}/20 puntos requeridos · Ley 9556 (obtenidos: ${puntosAprobados}).`
    )
  }
  if (!input.djFirmada) {
    throw new ApiError(422, 'DJ_REQUERIDA', 'La declaración jurada debe estar firmada.')
  }

  const timestamp = new Date().toISOString()
  const numeroCIT = generarNumeroCIT()
  const hashSHA256 = hashCIT({
    numeroSerie: bici.numero_serie,
    marca: bici.marca,
    modelo: bici.modelo,
    anio: bici.anio,
    tipo: bici.tipo,
    propietarioDNI: input.propietarioDNI,
    propietarioNombre: input.propietarioNombre,
    inspectorId: input.inspectorId,
    tallerAliadoId: input.tallerAliadoId,
    puntos: input.puntos,
    timestamp,
  })

  const venceEn = new Date(Date.now() + CIT_VIGENCIA_DIAS * 24 * 60 * 60 * 1000)

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO cits
       (bicicleta_id, propietario_id, inspector_id, taller_aliado_id, estado,
        fecha_vencimiento, fecha_emision, numero_cit, puntos, punto_detalle,
        hash_sha256, firma_inspector, fotos)
     VALUES ($1, $2, $3, $4, 'ACTIVO', $5, NOW(), $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.bicicletaId,
      bici.propietario_id,
      input.inspectorId,
      input.tallerAliadoId,
      venceEn,
      numeroCIT,
      puntosAprobados,
      JSON.stringify(input.puntos),
      hashSHA256,
      input.firmaInspector,
      input.fotosUrls,
    ]
  )

  return {
    citId: inserted.rows[0].id,
    numeroCIT,
    estado: 'ACTIVO' as const,
    hashSHA256,
    puntos: puntosAprobados,
    fechaVencimiento: venceEn.toISOString(),
    bicicleta: {
      id: bici.id,
      marca: bici.marca,
      modelo: bici.modelo,
      numeroSerie: bici.numero_serie,
    },
    mensaje: 'CIT emitido y activo · registrado por inspector certificado RODAID.',
  }
}
