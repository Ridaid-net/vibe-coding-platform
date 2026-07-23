import { getStore } from '@netlify/blobs'
import { SignJWT, jwtVerify } from 'jose'
import { createHash, randomBytes } from 'node:crypto'
import {
  ApiError,
  getAuthSecret,
  getPool,
} from '@/lib/marketplace'
import { hashPassword, requireRole, type AuthUser } from '@/lib/auth'
import { enviarEmail } from '@/lib/email'
import { getModo } from '@/src/services/mercadopago.service'
import { getBfaModo } from '@/src/services/blockchain.service'
import { getMtlsModo } from '@/src/services/mtls.service'
import { cifrar, descifrar } from '@/src/services/cifrado.service'
import {
  codigoTotpActual,
  generarSecretoTotp,
  otpauthUri,
  verificarTotp,
} from '@/src/services/mfa.service'
import { revocarTokensDeApp } from '@/src/services/oauth.service'
import { urlDocumentoSeguro } from '@/src/services/denuncia-mpf.service'
import {
  confirmarNaranja,
  desestimarDisputa,
  listarColaRevisionHumana,
  type DisputaEnCola,
} from '@/src/services/disputas-cit-completo.service'
import {
  aprobarReclamoHumano,
  desestimarReclamoHumano,
  listarColaRevisionReclamos,
  type ReclamoEnCola,
} from '@/src/services/reclamos-titularidad.service'

/**
 * RODAID — Hito 19: Dashboard de Administracion (Operaciones / SysAdmin).
 *
 * Nucleo del panel: control de acceso (MFA obligatoria + sub-roles), bitacora
 * INMUTABLE de cada accion de modificacion, minimizacion de datos personales y
 * todas las consultas de los cuatro modulos del panel:
 *   - Monitor de Integridad del Sistema.
 *   - Centro de Moderacion y Auditoria.
 *   - Analitica de Ecosistema (incluye el mapa institucional sin k-anonimato).
 *   - Gestion de Identidades y Roles.
 *
 * RESTRICCIONES DEL HITO, aplicadas aqui:
 *   - El acceso exige MFA (TOTP) y un sub-rol definido (SuperAdmin/Auditor/
 *     Operador de Soporte). Cada sub-rol tiene un conjunto acotado de permisos.
 *   - Toda accion de modificacion queda asentada en `admin_bitacora` con la
 *     identidad del administrador que la ejecuto (append-only, no alterable).
 *   - Ningun administrador ve datos personales (DNI/email) salvo que sea
 *     estrictamente necesario para un proceso de soporte oficial; ese acceso se
 *     hace con un motivo explicito y queda auditado.
 */

// ── Sub-roles y permisos ───────────────────────────────────────────────────────

export type AdminRol = 'superadmin' | 'auditor' | 'soporte'

export type AdminPermiso =
  | 'integridad:ver'
  | 'moderacion:ver'
  | 'moderacion:accion'
  | 'analitica:ver'
  | 'identidades:ver'
  | 'identidades:accion'
  | 'datos-personales:ver'
  | 'bitacora:ver'
  | 'roles:gestionar'
  | 'finanzas:ver'
  | 'finanzas:accion'
  | 'aliados:ver'
  | 'aliados:accion'

const TODOS: AdminPermiso[] = [
  'integridad:ver',
  'moderacion:ver',
  'moderacion:accion',
  'analitica:ver',
  'identidades:ver',
  'identidades:accion',
  'datos-personales:ver',
  'bitacora:ver',
  'roles:gestionar',
  'finanzas:ver',
  'finanzas:accion',
  'aliados:ver',
  'aliados:accion',
]

/** Matriz de permisos por sub-rol. */
const MATRIZ: Record<AdminRol, ReadonlySet<AdminPermiso>> = {
  // Control total.
  superadmin: new Set(TODOS),
  // Solo lectura (incluye la bitacora). No ejecuta modificaciones. Mismo
  // criterio que moderacion:ver/moderacion:accion: ve el Dashboard Financiero
  // y la Cola de Pagos, pero no puede barrer liquidaciones ni confirmar pagos.
  auditor: new Set<AdminPermiso>([
    'integridad:ver',
    'moderacion:ver',
    'analitica:ver',
    'identidades:ver',
    'bitacora:ver',
    'finanzas:ver',
    'aliados:ver',
    'aliados:accion',
  ]),
  // Moderacion / soporte. Acceso justificado a datos personales para soporte
  // oficial. No gestiona roles de administracion. Finanzas fuera de su
  // alcance (ni ver ni accionar). Aliados si esta a su alcance -- confirmado
  // por Federico 2026-07-21, ya que hoy CUALQUIER admin puede aprobar/
  // rechazar sin distincion de sub-rol (requireStaff(req,'admin') a secas).
  soporte: new Set<AdminPermiso>([
    'integridad:ver',
    'moderacion:ver',
    'moderacion:accion',
    'analitica:ver',
    'identidades:ver',
    'identidades:accion',
    'datos-personales:ver',
    'bitacora:ver',
    'aliados:ver',
    'aliados:accion',
  ]),
}

export function permisosDeRol(rol: AdminRol): AdminPermiso[] {
  return TODOS.filter((p) => MATRIZ[rol].has(p))
}

// ── Perfil de administrador (sub-rol + enrolamiento MFA) ───────────────────────

interface AdminPerfilRow {
  usuario_id: string
  admin_rol: AdminRol
  mfa_secret_cifrado: string | null
  mfa_habilitado: boolean
}

export interface AdminUser {
  userId: string
  email: string | null
  adminRol: AdminRol
  mfaHabilitado: boolean
}

/** Lista de emails (coma-separados) que se aprovisionan como SuperAdmin. */
function superadminEmails(): Set<string> {
  const raw = process.env.RODAID_SUPERADMIN_EMAILS ?? ''
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )
}

/**
 * Determina el sub-rol por defecto al aprovisionar un perfil de admin. En LIVE
 * se otorga el minimo privilegio (soporte) salvo que el email este en la lista
 * de SuperAdmins. Fuera de LIVE (preview/demo) se otorga superadmin para poder
 * ejercitar todo el panel de punta a punta.
 */
function rolPorDefecto(email: string | null): AdminRol {
  if (email && superadminEmails().has(email.toLowerCase())) return 'superadmin'
  return getModo() === 'LIVE' ? 'soporte' : 'superadmin'
}

/**
 * Exige un usuario con rol 'admin' (JWT) y devuelve su perfil de administracion.
 * Aprovisiona el perfil la primera vez (sub-rol por defecto). NO valida MFA: es
 * el paso previo al enrolamiento / step-up.
 */
export async function requireAdminUser(req: Request): Promise<AdminUser> {
  const user: AuthUser = await requireRole('admin')(req)
  const pool = getPool()
  const found = await pool.query<AdminPerfilRow>(
    `SELECT usuario_id, admin_rol, mfa_secret_cifrado, mfa_habilitado
     FROM admin_perfiles WHERE usuario_id = $1 LIMIT 1`,
    [user.id]
  )
  let row = found.rows[0]
  if (!row) {
    const rol = rolPorDefecto(user.email)
    const ins = await pool.query<AdminPerfilRow>(
      `INSERT INTO admin_perfiles (usuario_id, admin_rol)
       VALUES ($1, $2)
       ON CONFLICT (usuario_id) DO UPDATE SET admin_rol = admin_perfiles.admin_rol
       RETURNING usuario_id, admin_rol, mfa_secret_cifrado, mfa_habilitado`,
      [user.id, rol]
    )
    row = ins.rows[0]
  }
  return {
    userId: row.usuario_id,
    email: user.email,
    adminRol: row.admin_rol,
    mfaHabilitado: row.mfa_habilitado,
  }
}

// ── Enrolamiento MFA + token de step-up ────────────────────────────────────────

export interface EnrolMfaResultado {
  yaHabilitado: boolean
  secret: string
  otpauthUri: string
  /** Solo fuera de LIVE: el codigo TOTP vigente, para ejercitar el flujo demo. */
  codigoDemo: string | null
}

/**
 * Enrola (o re-enrola) el segundo factor del administrador. Genera un secreto
 * TOTP, lo guarda CIFRADO y devuelve el `otpauth://` URI para escanear. El MFA
 * queda pendiente de confirmacion hasta el primer codigo valido (step-up).
 */
export async function enrolarMfa(admin: AdminUser): Promise<EnrolMfaResultado> {
  const secret = generarSecretoTotp()
  await getPool().query(
    `UPDATE admin_perfiles
     SET mfa_secret_cifrado = $2, mfa_habilitado = FALSE, mfa_confirmado_en = NULL
     WHERE usuario_id = $1`,
    [admin.userId, cifrar(secret)]
  )
  return {
    yaHabilitado: false,
    secret,
    otpauthUri: otpauthUri({
      secretBase32: secret,
      cuenta: admin.email ?? admin.userId,
    }),
    codigoDemo: getModo() === 'LIVE' ? null : codigoTotpActual(secret),
  }
}

/** TTL del token de step-up MFA, en segundos (por defecto 30 min). */
function stepUpTtlSeg(): number {
  const raw = Number(process.env.RODAID_ADMIN_MFA_TTL_SEG)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30 * 60
}

function secretKey(): Uint8Array {
  const secret = getAuthSecret()
  if (!secret) {
    throw new ApiError(500, 'AUTH_NOT_CONFIGURED', 'Autenticacion no configurada.')
  }
  return new TextEncoder().encode(secret)
}

export interface StepUpResultado {
  stepUpToken: string
  expiraEnSeg: number
  adminRol: AdminRol
  permisos: AdminPermiso[]
}

/**
 * Verifica el codigo TOTP y emite el token de step-up MFA. Si era el primer
 * codigo valido, confirma el enrolamiento. El token es de vida corta y se exige
 * en cada accion del panel (cabecera `x-rodaid-mfa`).
 */
export async function verificarMfaYStepUp(
  admin: AdminUser,
  code: string
): Promise<StepUpResultado> {
  const pool = getPool()
  const res = await pool.query<{ mfa_secret_cifrado: string | null }>(
    `SELECT mfa_secret_cifrado FROM admin_perfiles WHERE usuario_id = $1 LIMIT 1`,
    [admin.userId]
  )
  const cifrado = res.rows[0]?.mfa_secret_cifrado
  if (!cifrado) {
    throw new ApiError(409, 'MFA_NO_ENROLADO', 'Tenes que enrolar el segundo factor primero.')
  }
  let secret: string
  try {
    secret = descifrar(cifrado)
  } catch {
    throw new ApiError(500, 'MFA_SECRET_INVALIDO', 'No se pudo leer el factor MFA.')
  }
  if (!verificarTotp(secret, code)) {
    throw new ApiError(401, 'MFA_CODIGO_INVALIDO', 'El codigo de verificacion es invalido o expiro.')
  }

  // Confirmar enrolamiento la primera vez.
  await pool.query(
    `UPDATE admin_perfiles
     SET mfa_habilitado = TRUE,
         mfa_confirmado_en = COALESCE(mfa_confirmado_en, NOW())
     WHERE usuario_id = $1`,
    [admin.userId]
  )

  const ttl = stepUpTtlSeg()
  const token = await new SignJWT({
    kind: 'admin_step_up',
    adminRol: admin.adminRol,
    amr: ['mfa'],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(admin.userId)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secretKey())

  return {
    stepUpToken: token,
    expiraEnSeg: ttl,
    adminRol: admin.adminRol,
    permisos: permisosDeRol(admin.adminRol),
  }
}

/** Verifica el token de step-up MFA de la cabecera y exige que sea del admin. */
async function verificarStepUp(req: Request, userId: string): Promise<void> {
  const token =
    req.headers.get('x-rodaid-mfa') ??
    req.headers.get('x-admin-mfa') ??
    null
  if (!token) {
    throw new ApiError(401, 'MFA_REQUERIDA', 'El panel exige verificacion MFA. Inicia el step-up.')
  }
  try {
    const { payload } = await jwtVerify(token, secretKey())
    if (payload.kind !== 'admin_step_up' || payload.sub !== userId) {
      throw new Error('step-up invalido')
    }
  } catch {
    throw new ApiError(401, 'MFA_EXPIRADA', 'Tu verificacion MFA expiro. Verifica de nuevo.')
  }
}

// ── Contexto del panel + guard de permisos ─────────────────────────────────────

export interface AdminContext extends AdminUser {
  req: Request
}

/**
 * Guard del panel de administracion. Exige: (1) usuario con rol admin, (2) token
 * de step-up MFA valido, (3) que el sub-rol tenga TODOS los permisos pedidos.
 * Devuelve el contexto del admin para auditar sus acciones.
 */
export async function requireAdminPanel(
  req: Request,
  ...permisos: AdminPermiso[]
): Promise<AdminContext> {
  const admin = await requireAdminUser(req)
  await verificarStepUp(req, admin.userId)
  for (const p of permisos) {
    if (!MATRIZ[admin.adminRol].has(p)) {
      throw new ApiError(
        403,
        'PERMISO_DENEGADO',
        `Tu rol (${admin.adminRol}) no tiene el permiso requerido (${p}).`
      )
    }
  }
  return { ...admin, req }
}

// ── Bitacora inmutable ─────────────────────────────────────────────────────────

function hashIp(ip: string | null): string | null {
  if (!ip) return null
  const secret = getAuthSecret() ?? 'rodaid-admin'
  return createHash('sha256').update(`${secret}:admin-ip:${ip}`).digest('hex')
}

function leerIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    (fwd ? fwd.split(',')[0]?.trim() ?? null : null) ??
    null
  )
}

interface AuditoriaAdmin {
  accion: string
  recursoTipo?: string | null
  recursoId?: string | null
  resultado?: 'ok' | 'error' | 'denegado'
  detalle?: Record<string, unknown>
}

/**
 * Asienta una accion del panel en la bitacora INMUTABLE, con la identidad del
 * administrador que la ejecuto. Best-effort: nunca tira abajo la operacion.
 */
export async function auditarAdmin(
  ctx: AdminContext,
  a: AuditoriaAdmin
): Promise<void> {
  await getPool()
    .query(
      `INSERT INTO admin_bitacora
         (admin_id, admin_rol, accion, recurso_tipo, recurso_id, resultado, detalle, ip_hash, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        ctx.userId,
        ctx.adminRol,
        a.accion,
        a.recursoTipo ?? null,
        a.recursoId ?? null,
        a.resultado ?? 'ok',
        JSON.stringify(a.detalle ?? {}),
        hashIp(leerIp(ctx.req)),
        ctx.req.headers.get('user-agent'),
      ]
    )
    .catch((err: unknown) =>
      console.error('[admin] no se pudo asentar la bitacora', err)
    )
}

// ── Minimizacion de datos personales ───────────────────────────────────────────

/** Enmascara un email: j***@d***.com. Sin email -> null. */
export function enmascararEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const [user, dom] = email.split('@')
  if (!dom) return '***'
  const u = user.length <= 1 ? user : `${user[0]}***`
  const partes = dom.split('.')
  const host = partes[0]?.length ? `${partes[0][0]}***` : '***'
  const tld = partes.slice(1).join('.')
  return `${u}@${host}${tld ? '.' + tld : ''}`
}

/** Enmascara un documento dejando solo los ultimos 2 digitos: ******78. */
export function enmascararDni(dni: string | null | undefined): string | null {
  if (!dni) return null
  const d = dni.replace(/\D+/g, '')
  if (d.length <= 2) return '****'
  return `${'*'.repeat(Math.max(2, d.length - 2))}${d.slice(-2)}`
}

// ───────────────────────────────────────────────────────────────────────────────
// MODULO 1 — Monitor de Integridad del Sistema.
// ───────────────────────────────────────────────────────────────────────────────

export type SaludEstado = 'operativo' | 'degradado' | 'caido'

export interface ServicioSalud {
  clave: string
  nombre: string
  estado: SaludEstado
  modo: string
  detalle: string
  latenciaMs: number | null
}

export interface NodoBlockchain {
  nombre: string
  estado: SaludEstado
  bloque: number | null
  latenciaMs: number | null
}

export interface IntegridadSistema {
  generadoEn: string
  servicios: ServicioSalud[]
  nodosBFA: NodoBlockchain[]
  resumen: { operativos: number; degradados: number; caidos: number }
}

/** Probe real de Netlify Blobs: write/read/delete en un store de health. */
async function probeBlobs(): Promise<ServicioSalud> {
  const inicio = Date.now()
  try {
    const store = getStore('rodaid-health')
    const key = `probe-${hashIp(String(inicio)) ?? 'k'}`
    await store.set(key, 'ok')
    const val = await store.get(key, { type: 'text' })
    await store.delete(key).catch(() => undefined)
    const latenciaMs = Date.now() - inicio
    if (val !== 'ok') {
      return {
        clave: 'blobs',
        nombre: 'Netlify Blobs',
        estado: 'degradado',
        modo: 'lectura inconsistente',
        detalle: 'El almacenamiento respondio pero la lectura no coincidio.',
        latenciaMs,
      }
    }
    return {
      clave: 'blobs',
      nombre: 'Netlify Blobs',
      estado: 'operativo',
      modo: 'rw',
      detalle: 'Escritura y lectura verificadas.',
      latenciaMs,
    }
  } catch (err) {
    return {
      clave: 'blobs',
      nombre: 'Netlify Blobs',
      estado: 'caido',
      modo: 'sin acceso',
      detalle: (err as Error).message?.slice(0, 160) ?? 'No se pudo acceder al almacenamiento.',
      latenciaMs: Date.now() - inicio,
    }
  }
}

/** Estado del canal institucional (webhook al Ministerio + mTLS). */
function saludMinisterio(): ServicioSalud {
  const url =
    process.env.RODAID_MINISTERIO_DENUNCIA_URL ??
    process.env.RODAID_MINISTERIO_ROBO_URL
  const mtls = getMtlsModo()
  const live = Boolean(url)
  return {
    clave: 'ministerio',
    nombre: 'Webhooks Ministerio de Seguridad',
    estado: live ? 'operativo' : 'degradado',
    modo: live ? 'LIVE' : 'SIMULADO',
    detalle: live
      ? `Endpoint configurado · mTLS ${mtls}`
      : 'Sin endpoint real configurado: los avisos operan en modo simulado.',
    latenciaMs: null,
  }
}

/** Estado del API Gateway (AI Gateway) a partir de la actividad reciente. */
async function saludApiGateway(): Promise<ServicioSalud> {
  try {
    const res = await getPool().query<{ total: string; ultima: string | null }>(
      `SELECT COUNT(*) AS total, MAX(created_at) AS ultima
       FROM gpt_consultas
       WHERE created_at >= NOW() - INTERVAL '24 hours'`
    )
    const total = Number(res.rows[0]?.total ?? 0)
    return {
      clave: 'api_gateway',
      nombre: 'API Gateway (IA)',
      estado: 'operativo',
      modo: 'AI Gateway',
      detalle:
        total > 0
          ? `${total} inferencias en las ultimas 24 h.`
          : 'Sin inferencias recientes; el gateway responde a demanda.',
      latenciaMs: null,
    }
  } catch (err) {
    return {
      clave: 'api_gateway',
      nombre: 'API Gateway (IA)',
      estado: 'degradado',
      modo: 'desconocido',
      detalle: (err as Error).message?.slice(0, 160) ?? 'No se pudo leer la actividad.',
      latenciaMs: null,
    }
  }
}

/** Construye el estado de los nodos federados de la BFA (semaforo). */
function nodosBFA(modo: string): NodoBlockchain[] {
  const onchain = modo === 'ONCHAIN'
  const base = ['Nodo Federal AR-1', 'Nodo Provincial MZA-2', 'Nodo Validador MZA-3']
  return base.map((nombre, i) => ({
    nombre,
    estado: onchain ? 'operativo' : ('degradado' as SaludEstado),
    bloque: onchain ? 0 : null,
    latenciaMs: onchain ? 40 + i * 12 : null,
  }))
}

/** Reune el estado de integridad de todo el sistema. */
export async function estadoIntegridad(): Promise<IntegridadSistema> {
  const bfaModo = getBfaModo()
  const [blobs, apiGateway] = await Promise.all([probeBlobs(), saludApiGateway()])
  const servicios: ServicioSalud[] = [
    {
      clave: 'bfa',
      nombre: 'Blockchain Federal Argentina',
      estado: bfaModo === 'ONCHAIN' ? 'operativo' : 'degradado',
      modo: bfaModo,
      detalle:
        bfaModo === 'ONCHAIN'
          ? 'Anclaje on-chain operativo.'
          : 'Anclaje en modo simulado (sin credenciales de BFA).',
      latenciaMs: null,
    },
    apiGateway,
    blobs,
    saludMinisterio(),
  ]
  const resumen = servicios.reduce(
    (acc, s) => {
      if (s.estado === 'operativo') acc.operativos++
      else if (s.estado === 'degradado') acc.degradados++
      else acc.caidos++
      return acc
    },
    { operativos: 0, degradados: 0, caidos: 0 }
  )
  return {
    generadoEn: new Date().toISOString(),
    servicios,
    nodosBFA: nodosBFA(bfaModo),
    resumen,
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// MODULO 2 — Centro de Moderacion y Auditoria.
// ───────────────────────────────────────────────────────────────────────────────

export interface DenunciaModeracion {
  id: string
  estado: string
  bicicletaId: string
  serial: string
  expediente: string | null
  fechaDocumento: string | null
  estructuraValida: boolean
  titularCoincide: boolean
  ilegible: boolean
  motivos: string[]
  pdfHash: string
  pdfBytes: number
  creadoEn: string
  /** Link seguro (token firmado) para verificar el PDF del MPF. */
  documentoUrl: string
}

interface DenunciaModRow {
  id: string
  estado: string
  bicicleta_id: string
  serial_normalizado: string
  numero_expediente: string | null
  fecha_documento: string | null
  estructura_valida: boolean
  titular_coincide: boolean
  validacion: { motivos?: string[]; ilegible?: boolean } | null
  pdf_sha256: string
  pdf_bytes: number
  creado_en: string
}

/** Lista denuncias para moderacion (por defecto, las que estan EN_REVISION). */
export async function listarDenunciasModeracion(
  estado?: string
): Promise<DenunciaModeracion[]> {
  const where = estado ? `WHERE estado = $1` : ''
  const params = estado ? [estado, 100] : [100]
  const res = await getPool().query<DenunciaModRow>(
    `SELECT id, estado, bicicleta_id, serial_normalizado, numero_expediente,
            fecha_documento, estructura_valida, titular_coincide, validacion,
            pdf_sha256, pdf_bytes, creado_en
     FROM denuncias_mpf
     ${where}
     ORDER BY CASE estado WHEN 'EN_REVISION' THEN 0 WHEN 'DENUNCIA_JUDICIAL_ACTIVA' THEN 1 ELSE 2 END,
              creado_en DESC
     LIMIT $${estado ? 2 : 1}`,
    params
  )
  return Promise.all(
    res.rows.map(async (r: DenunciaModRow) => ({
      id: r.id,
      estado: r.estado,
      bicicletaId: r.bicicleta_id,
      serial: r.serial_normalizado,
      expediente: r.numero_expediente,
      fechaDocumento: r.fecha_documento,
      estructuraValida: r.estructura_valida,
      titularCoincide: r.titular_coincide,
      ilegible: r.validacion?.ilegible ?? false,
      motivos: r.validacion?.motivos ?? [],
      pdfHash: r.pdf_sha256,
      pdfBytes: r.pdf_bytes,
      creadoEn: r.creado_en,
      documentoUrl: await urlDocumentoSeguro(r.id),
    }))
  )
}

export type AccionDenuncia = 'aprobar' | 'rechazar' | 'desbloquear'

export interface AccionDenunciaResultado {
  id: string
  estado: string
  cambios: string[]
}

/**
 * Resuelve una denuncia en revision (Hito 18) desde la moderacion:
 *   - aprobar: activa la denuncia (DENUNCIA_JUDICIAL_ACTIVA), bloquea el CIT y
 *     pausa las publicaciones del Marketplace de esa bici.
 *   - rechazar: anula la denuncia (no bloquea nada).
 *   - desbloquear: levanta el bloqueo (reactiva el CIT) y anula la denuncia.
 * Cada accion queda en la bitacora inmutable con la identidad del admin.
 */
export async function accionDenuncia(
  ctx: AdminContext,
  denunciaId: string,
  accion: AccionDenuncia,
  opts: { motivo?: string | null } = {}
): Promise<AccionDenunciaResultado> {
  const pool = getPool()
  const found = await pool.query<{ id: string; estado: string; bicicleta_id: string; pdf_sha256: string; serial_normalizado: string }>(
    `SELECT id, estado, bicicleta_id, pdf_sha256, serial_normalizado
     FROM denuncias_mpf WHERE id = $1 LIMIT 1`,
    [denunciaId]
  )
  const den = found.rows[0]
  if (!den) throw new ApiError(404, 'DENUNCIA_NOT_FOUND', 'No se encontro la denuncia.')

  const cambios: string[] = []
  let estadoFinal = den.estado

  if (accion === 'aprobar') {
    await bloquearActivos(den.bicicleta_id, denunciaId)
    await pool.query(
      `UPDATE denuncias_mpf SET estado = 'DENUNCIA_JUDICIAL_ACTIVA' WHERE id = $1`,
      [denunciaId]
    )
    estadoFinal = 'DENUNCIA_JUDICIAL_ACTIVA'
    cambios.push('CIT bloqueado', 'Publicaciones pausadas', 'Denuncia activada')
  } else if (accion === 'rechazar') {
    await pool.query(`UPDATE denuncias_mpf SET estado = 'ANULADA' WHERE id = $1`, [denunciaId])
    estadoFinal = 'ANULADA'
    cambios.push('Denuncia anulada')
  } else if (accion === 'desbloquear') {
    await desbloquearActivos(den.bicicleta_id, denunciaId)
    await pool.query(`UPDATE denuncias_mpf SET estado = 'ANULADA' WHERE id = $1`, [denunciaId])
    estadoFinal = 'ANULADA'
    cambios.push('CIT reactivado', 'Denuncia anulada')
  }

  // Asentar en la auditoria especifica de denuncias (con el hash del PDF) y en la
  // bitacora del panel (con la identidad del admin).
  await pool
    .query(
      `INSERT INTO denuncias_mpf_auditoria
         (denuncia_id, bicicleta_id, serial_normalizado, usuario_id, evento, pdf_sha256, detalle)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        denunciaId,
        den.bicicleta_id,
        den.serial_normalizado,
        ctx.userId,
        'MODERACION',
        den.pdf_sha256,
        JSON.stringify({ accion, estadoFinal, adminRol: ctx.adminRol, motivo: opts.motivo ?? null }),
      ]
    )
    .catch(() => undefined)

  await auditarAdmin(ctx, {
    accion: `denuncia.${accion}`,
    recursoTipo: 'denuncia_mpf',
    recursoId: denunciaId,
    detalle: { estadoPrevio: den.estado, estadoFinal, pdfHash: den.pdf_sha256, motivo: opts.motivo ?? null },
  })

  return { id: denunciaId, estado: estadoFinal, cambios }
}

/** Bloquea el CIT y pausa el Marketplace de una bici (denuncia activa). */
async function bloquearActivos(bicicletaId: string, denunciaId: string): Promise<void> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE cits
       SET estado = 'bloqueado',
           metadata_json = metadata_json || $2::jsonb,
           updated_at = NOW()
       WHERE bicicleta_id = $1 AND estado IN ('activo', 'pendiente')`,
      [bicicletaId, JSON.stringify({ denuncia: { denunciaId, estado: 'DENUNCIA_JUDICIAL_ACTIVA', bloqueadoEn: new Date().toISOString() } })]
    )
    await client.query(
      `UPDATE marketplace_publicaciones SET estado = 'PAUSADA'
       WHERE bicicleta_id = $1 AND estado = 'ACTIVA'`,
      [bicicletaId]
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    client.release()
  }
}

/** Levanta el bloqueo: reactiva el CIT bloqueado por una denuncia. */
async function desbloquearActivos(bicicletaId: string, denunciaId: string): Promise<void> {
  await getPool().query(
    `UPDATE cits
     SET estado = 'activo',
         metadata_json = metadata_json || $2::jsonb,
         updated_at = NOW()
     WHERE bicicleta_id = $1 AND estado = 'bloqueado'`,
    [bicicletaId, JSON.stringify({ denuncia: { denunciaId, estado: 'DESBLOQUEADO', desbloqueadoEn: new Date().toISOString() } })]
  )
}

// Publicaciones en disputa / a moderar.

export interface PublicacionDisputa {
  id: string
  titulo: string
  estado: string
  precioARS: number
  vendedorId: string
  vendedorEstado: string
  bicicletaId: string
  serial: string | null
  slug: string
  motivo: string | null
  publicadoEn: string
  enDisputa: boolean
}

interface PublicacionDisputaRow {
  id: string
  titulo: string
  estado: string
  precio_ars: string
  vendedor_id: string
  vendedor_estado: string | null
  bicicleta_id: string
  numero_serie: string | null
  slug: string
  publicado_en: string
  disputa_motivo: string | null
  en_disputa: boolean
}

/**
 * Lista publicaciones bajo escrutinio: las que tienen una transaccion en disputa,
 * las pausadas (por denuncia / moderacion) y las de cuentas suspendidas.
 */
export async function listarPublicacionesDisputa(): Promise<PublicacionDisputa[]> {
  const res = await getPool().query<PublicacionDisputaRow>(
    `SELECT p.id, p.titulo, p.estado, p.precio_ars, p.vendedor_id, p.slug,
            p.bicicleta_id, p.publicado_en,
            u.estado AS vendedor_estado,
            b.numero_serie,
            d.disputa_motivo,
            (d.id IS NOT NULL) AS en_disputa
     FROM marketplace_publicaciones p
     LEFT JOIN usuarios u ON u.id = p.vendedor_id
     LEFT JOIN bicicletas b ON b.id = p.bicicleta_id
     LEFT JOIN LATERAL (
       SELECT id, disputa_motivo FROM escrow_transacciones
       WHERE publicacion_id = p.id AND estado = 'DISPUTADA'
       ORDER BY created_at DESC LIMIT 1
     ) d ON TRUE
     WHERE d.id IS NOT NULL
        OR p.estado IN ('PAUSADA', 'RECHAZADA')
        OR u.estado = 'suspendido'
     ORDER BY (d.id IS NOT NULL) DESC, p.publicado_en DESC
     LIMIT 100`
  )
  return res.rows.map((r: PublicacionDisputaRow) => ({
    id: r.id,
    titulo: r.titulo,
    estado: r.estado,
    precioARS: Number(r.precio_ars),
    vendedorId: r.vendedor_id,
    vendedorEstado: r.vendedor_estado ?? 'activo',
    bicicletaId: r.bicicleta_id,
    serial: r.numero_serie,
    slug: r.slug,
    motivo: r.disputa_motivo,
    publicadoEn: r.publicado_en,
    enDisputa: r.en_disputa,
  }))
}

export type AccionPublicacion = 'despublicar' | 'reactivar' | 'suspender-cuenta' | 'reactivar-cuenta'

/**
 * Control de moderacion sobre el Marketplace: borrar (despublicar) o reactivar
 * una publicacion que infringe los terminos, y suspender o reactivar la cuenta
 * del vendedor. Toda accion queda auditada con la identidad del admin.
 */
export async function accionPublicacion(
  ctx: AdminContext,
  publicacionId: string,
  accion: AccionPublicacion,
  opts: { motivo?: string | null } = {}
): Promise<{ id: string; estado?: string; cuentaEstado?: string }> {
  const pool = getPool()
  const found = await pool.query<{ id: string; estado: string; vendedor_id: string }>(
    `SELECT id, estado, vendedor_id FROM marketplace_publicaciones WHERE id = $1 LIMIT 1`,
    [publicacionId]
  )
  const pub = found.rows[0]
  if (!pub) throw new ApiError(404, 'PUBLICACION_NOT_FOUND', 'No se encontro la publicacion.')

  if (accion === 'despublicar') {
    await pool.query(`UPDATE marketplace_publicaciones SET estado = 'RECHAZADA' WHERE id = $1`, [publicacionId])
    await auditarAdmin(ctx, {
      accion: 'publicacion.despublicar',
      recursoTipo: 'publicacion',
      recursoId: publicacionId,
      detalle: { estadoPrevio: pub.estado, motivo: opts.motivo ?? null },
    })
    return { id: publicacionId, estado: 'RECHAZADA' }
  }

  if (accion === 'reactivar') {
    await pool.query(
      `UPDATE marketplace_publicaciones SET estado = 'ACTIVA'
       WHERE id = $1 AND estado IN ('PAUSADA', 'RECHAZADA')`,
      [publicacionId]
    )
    await auditarAdmin(ctx, {
      accion: 'publicacion.reactivar',
      recursoTipo: 'publicacion',
      recursoId: publicacionId,
      detalle: { estadoPrevio: pub.estado, motivo: opts.motivo ?? null },
    })
    return { id: publicacionId, estado: 'ACTIVA' }
  }

  // Suspender / reactivar la cuenta del vendedor.
  const suspender = accion === 'suspender-cuenta'
  await pool.query(
    `UPDATE usuarios
     SET estado = $2,
         suspendido_en = CASE WHEN $2 = 'suspendido' THEN NOW() ELSE NULL END,
         suspendido_motivo = CASE WHEN $2 = 'suspendido' THEN $3 ELSE NULL END
     WHERE id = $1`,
    [pub.vendedor_id, suspender ? 'suspendido' : 'activo', opts.motivo ?? null]
  )
  if (suspender) {
    // Al suspender la cuenta, pausar sus publicaciones activas.
    await pool.query(
      `UPDATE marketplace_publicaciones SET estado = 'PAUSADA'
       WHERE vendedor_id = $1 AND estado = 'ACTIVA'`,
      [pub.vendedor_id]
    )
  }
  await auditarAdmin(ctx, {
    accion: suspender ? 'cuenta.suspender' : 'cuenta.reactivar',
    recursoTipo: 'usuario',
    recursoId: pub.vendedor_id,
    detalle: { motivo: opts.motivo ?? null, viaPublicacion: publicacionId },
  })
  return { id: publicacionId, cuentaEstado: suspender ? 'suspendido' : 'activo' }
}

// ───────────────────────────────────────────────────────────────────────────────
// MODULO 3 — Analitica de Ecosistema.
// ───────────────────────────────────────────────────────────────────────────────

export interface AnaliticaEcosistema {
  generadoEn: string
  gpt: {
    consultas30d: number
    tokensEntrada30d: number
    tokensSalida30d: number
    cacheHits30d: number
    rehusadas30d: number
  }
  api: {
    llamadas30d: number
    errores30d: number
    appsActivas: number
    latenciaP95Ms: number | null
  }
  pay: {
    transacciones30d: number
    volumenARS30d: number
    comisionARS30d: number
    enDisputa: number
    completadas30d: number
  }
  cits: { total: number; activos: number; bloqueados: number }
  usuarios: { total: number; suspendidos: number; conSelloMxm: number }
}

/** Reune las metricas agregadas del ecosistema (sin datos personales). */
export async function analiticaEcosistema(): Promise<AnaliticaEcosistema> {
  const pool = getPool()
  const [gpt, api, apps, pay, cits, usuarios] = await Promise.all([
    pool.query<{ consultas: string; te: string | null; ts: string | null; hits: string; reh: string }>(
      `SELECT COUNT(*) AS consultas,
              COALESCE(SUM(tokens_entrada), 0) AS te,
              COALESCE(SUM(tokens_salida), 0) AS ts,
              COUNT(*) FILTER (WHERE cache_hit) AS hits,
              COUNT(*) FILTER (WHERE rehusada) AS reh
       FROM gpt_consultas WHERE created_at >= NOW() - INTERVAL '30 days'`
    ),
    pool.query<{ llamadas: string; errores: string; p95: string | null }>(
      `SELECT COUNT(*) AS llamadas,
              COUNT(*) FILTER (WHERE status >= 400) AS errores,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latencia_ms) AS p95
       FROM developer_api_logs WHERE created_at >= NOW() - INTERVAL '30 days'`
    ),
    pool.query<{ activas: string }>(
      `SELECT COUNT(*) AS activas FROM developer_apps WHERE estado = 'activa'`
    ),
    pool.query<{ tx: string; vol: string | null; com: string | null; disp: string; comp: string }>(
      `SELECT COUNT(*) AS tx,
              COALESCE(SUM(precio_ars), 0) AS vol,
              COALESCE(SUM(comision_rodaid), 0) AS com,
              COUNT(*) FILTER (WHERE estado = 'DISPUTADA') AS disp,
              COUNT(*) FILTER (WHERE estado = 'COMPLETADA') AS comp
       FROM escrow_transacciones WHERE created_at >= NOW() - INTERVAL '30 days'`
    ),
    pool.query<{ total: string; activos: string; bloqueados: string }>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE estado = 'activo') AS activos,
              COUNT(*) FILTER (WHERE estado = 'bloqueado') AS bloqueados
       FROM cits`
    ),
    pool.query<{ total: string; susp: string; sello: string }>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE estado = 'suspendido') AS susp,
              COUNT(*) FILTER (WHERE sello_gubernamental) AS sello
       FROM usuarios`
    ),
  ])
  const g = gpt.rows[0]
  const a = api.rows[0]
  const p = pay.rows[0]
  const c = cits.rows[0]
  const u = usuarios.rows[0]
  return {
    generadoEn: new Date().toISOString(),
    gpt: {
      consultas30d: Number(g.consultas),
      tokensEntrada30d: Number(g.te ?? 0),
      tokensSalida30d: Number(g.ts ?? 0),
      cacheHits30d: Number(g.hits),
      rehusadas30d: Number(g.reh),
    },
    api: {
      llamadas30d: Number(a.llamadas),
      errores30d: Number(a.errores),
      appsActivas: Number(apps.rows[0].activas),
      latenciaP95Ms: a.p95 != null ? Math.round(Number(a.p95)) : null,
    },
    pay: {
      transacciones30d: Number(p.tx),
      volumenARS30d: Number(p.vol ?? 0),
      comisionARS30d: Number(p.com ?? 0),
      enDisputa: Number(p.disp),
      completadas30d: Number(p.comp),
    },
    cits: { total: Number(c.total), activos: Number(c.activos), bloqueados: Number(c.bloqueados) },
    usuarios: { total: Number(u.total), suspendidos: Number(u.susp), conSelloMxm: Number(u.sello) },
  }
}

// Mapa de calor INSTITUCIONAL (sin las restricciones de privacidad del usuario).

export interface FocoInstitucional {
  capa: 'consultas' | 'denuncias'
  celda: string
  zona: string
  ciudad: string
  lat: number
  lon: number
  total: number
}

export interface MapaInstitucional {
  generadoEn: string
  dias: number
  /** Centro del area de interes (Gran Mendoza). */
  centro: { lat: number; lon: number }
  focos: FocoInstitucional[]
  totales: { consultas: number; denuncias: number; celdas: number }
}

/**
 * Mapa de calor INSTITUCIONAL: a diferencia del mapa publico, NO aplica
 * supresion por k-anonimato, de modo que el Ministerio ve los focos reales
 * (incluidas las celdas con un unico evento) y puede actuar en consecuencia. La
 * posicion sigue agregada a nivel barrio (recorte de ingesta, privacidad por
 * diseno), pero no se ocultan celdas de bajo volumen. El acceso queda auditado.
 */
export async function mapaInstitucional(dias: number): Promise<MapaInstitucional> {
  const d = Math.min(365, Math.max(1, Math.floor(Number.isFinite(dias) ? dias : 30)))
  const pool = getPool()
  const [consultas, denuncias] = await Promise.all([
    pool.query<{ geo_celda: string; lat: string; lon: string; zona: string | null; ciudad: string | null; total: string }>(
      `SELECT geo_celda, MAX(geo_lat) AS lat, MAX(geo_lon) AS lon,
              MAX(geo_zona) AS zona, MAX(geo_ciudad) AS ciudad, COUNT(*) AS total
       FROM logs_verificaciones
       WHERE geo_celda IS NOT NULL AND created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY geo_celda ORDER BY total DESC LIMIT 3000`,
      [String(d)]
    ),
    pool.query<{ geo_celda: string; lat: string; lon: string; zona: string | null; ciudad: string | null; total: string }>(
      `SELECT geo_celda, MAX(geo_lat) AS lat, MAX(geo_lon) AS lon,
              MAX(geo_zona) AS zona, MAX(geo_ciudad) AS ciudad, COUNT(*) AS total
       FROM discrepancias_reportadas
       WHERE geo_celda IS NOT NULL AND created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY geo_celda ORDER BY total DESC LIMIT 3000`,
      [String(d)]
    ),
  ])
  const focos: FocoInstitucional[] = []
  let totalConsultas = 0
  let totalDenuncias = 0
  for (const r of consultas.rows) {
    const total = Number(r.total)
    totalConsultas += total
    focos.push({
      capa: 'consultas',
      celda: r.geo_celda,
      zona: r.zona ?? 'Zona sin identificar',
      ciudad: r.ciudad ?? 'Mendoza',
      lat: Number(r.lat),
      lon: Number(r.lon),
      total,
    })
  }
  for (const r of denuncias.rows) {
    const total = Number(r.total)
    totalDenuncias += total
    focos.push({
      capa: 'denuncias',
      celda: r.geo_celda,
      zona: r.zona ?? 'Zona sin identificar',
      ciudad: r.ciudad ?? 'Mendoza',
      lat: Number(r.lat),
      lon: Number(r.lon),
      total,
    })
  }
  return {
    generadoEn: new Date().toISOString(),
    dias: d,
    centro: { lat: -32.8895, lon: -68.8458 },
    focos,
    totales: {
      consultas: totalConsultas,
      denuncias: totalDenuncias,
      celdas: consultas.rows.length + denuncias.rows.length,
    },
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// MODULO 3b — Remitos de Embalaje y Despacho (Fase 6b, CIT Completo).
// Sub-vista de Analitica: panorama consolidado de TODOS los Remitos del
// sistema (a diferencia de listarRemitosPorAliado() en remito.service.ts,
// que solo ve los de un Taller). Escribe su propia query SQL, siguiendo la
// convencion ya establecida en este archivo (lib/admin-panel.ts no delega a
// los *.service.ts para sus vistas agregadas).
// ───────────────────────────────────────────────────────────────────────────────

export interface RemitoAdminItem {
  id: string
  numero: string
  bici: { marca: string; modelo: string; numeroSerie: string }
  codigoCit: string
  tallerNombre: string
  vendedorNombre: string
  estado: 'GENERADO' | 'DESPACHADO'
  generadoEn: string
  despachadoEn: string | null
  /** Horas desde que se genero, sin despachar todavia. null si ya se despacho. */
  horasEnEspera: number | null
}

export interface RemitosAdminResumen {
  generadoEn: string
  dias: number
  resumen: {
    totalGenerados: number
    totalDespachados: number
    totalPendientes: number
    /** Solo sobre los DESPACHADOS del rango filtrado. null si no hay ninguno. */
    tiempoPromedioDespachoHoras: number | null
  }
  talleres: { id: string; nombre: string }[]
  remitos: RemitoAdminItem[]
}

export interface RemitosAdminFiltros {
  estado?: 'GENERADO' | 'DESPACHADO'
  aliadoId?: string | null
  dias?: number
}

interface RemitoAdminRow {
  id: string
  numero: string
  marca: string
  modelo: string
  numero_serie: string
  codigo_cit: string
  taller_nombre: string
  vendedor_nombre: string | null
  vendedor_email: string
  estado: 'GENERADO' | 'DESPACHADO'
  generado_en: string
  despachado_en: string | null
}

/**
 * Vista consolidada de Remitos para el Dashboard de Administracion. El
 * resumen numerico se calcula con una query agregada aparte (COUNT/AVG con
 * FILTER, mismo patron que analiticaEcosistema()), NO sobre el LIMIT 500 del
 * detalle -- si algun dia hay mas de 500 remitos en la ventana filtrada, el
 * resumen sigue siendo exacto aunque la lista de abajo este recortada.
 */
export async function remitosAdminResumen(
  filtros: RemitosAdminFiltros
): Promise<RemitosAdminResumen> {
  const dias = Math.min(
    365,
    Math.max(1, Math.floor(Number.isFinite(filtros.dias) ? Number(filtros.dias) : 30))
  )
  const pool = getPool()

  const condiciones: string[] = [`r.generado_en >= NOW() - ($1 || ' days')::interval`]
  const params: unknown[] = [String(dias)]
  if (filtros.estado) {
    params.push(filtros.estado)
    condiciones.push(`r.estado = $${params.length}`)
  }
  if (filtros.aliadoId) {
    params.push(filtros.aliadoId)
    condiciones.push(`r.aliado_id = $${params.length}`)
  }
  const where = condiciones.join(' AND ')

  const [agregado, filas, talleres] = await Promise.all([
    pool.query<{ total: string; despachados: string; horas_prom: string | null }>(
      `
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE r.estado = 'DESPACHADO') AS despachados,
          AVG(EXTRACT(EPOCH FROM (r.despachado_en - r.generado_en)) / 3600.0)
            FILTER (WHERE r.estado = 'DESPACHADO') AS horas_prom
        FROM remitos r
        WHERE ${where}
      `,
      params
    ),
    pool.query<RemitoAdminRow>(
      `
        SELECT
          r.id, r.numero, r.estado, r.generado_en, r.despachado_en,
          b.marca, b.modelo, b.numero_serie, c.codigo_cit,
          al.nombre AS taller_nombre,
          v.datos_perfil->>'nombre' AS vendedor_nombre, v.email AS vendedor_email
        FROM remitos r
        JOIN escrow_transacciones tx ON tx.id = r.transaccion_id
        JOIN marketplace_publicaciones mp ON mp.id = tx.publicacion_id
        JOIN bicicletas b ON b.id = mp.bicicleta_id
        JOIN cits c ON c.id = mp.cit_id
        JOIN aliados al ON al.id = r.aliado_id
        JOIN usuarios v ON v.id = r.vendedor_id
        WHERE ${where}
        ORDER BY (r.estado = 'GENERADO') DESC, r.generado_en DESC
        LIMIT 500
      `,
      params
    ),
    pool.query<{ id: string; nombre: string }>(
      `SELECT DISTINCT al.id, al.nombre FROM remitos r JOIN aliados al ON al.id = r.aliado_id ORDER BY al.nombre`
    ),
  ])

  const remitos: RemitoAdminItem[] = filas.rows.map((row: RemitoAdminRow) => ({
    id: row.id,
    numero: row.numero,
    bici: { marca: row.marca, modelo: row.modelo, numeroSerie: row.numero_serie },
    codigoCit: row.codigo_cit,
    tallerNombre: row.taller_nombre,
    vendedorNombre: row.vendedor_nombre?.trim() || row.vendedor_email,
    estado: row.estado,
    generadoEn: row.generado_en,
    despachadoEn: row.despachado_en,
    horasEnEspera:
      row.estado === 'GENERADO'
        ? (Date.now() - new Date(row.generado_en).getTime()) / 3_600_000
        : null,
  }))

  const a = agregado.rows[0]
  const totalGenerados = Number(a?.total ?? 0)
  const totalDespachados = Number(a?.despachados ?? 0)

  return {
    generadoEn: new Date().toISOString(),
    dias,
    resumen: {
      totalGenerados,
      totalDespachados,
      totalPendientes: totalGenerados - totalDespachados,
      tiempoPromedioDespachoHoras: a?.horas_prom != null ? Number(a.horas_prom) : null,
    },
    talleres: talleres.rows,
    remitos,
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// MODULO 4 — Gestion de Identidades y Roles.
// ───────────────────────────────────────────────────────────────────────────────

export interface InspectorAdmin {
  id: string
  emailMasked: string | null
  nombre: string | null
  walletAddress: string | null
  rol: string
  licenciaNumero: string | null
  licenciaEstado: string
  licenciaVenceEn: string | null
  talleres: { id: string; nombre: string }[]
  inspecciones: number
}

interface InspectorRow {
  id: string
  email: string | null
  nombre: string | null
  wallet_address: string | null
  rol: string
  licencia_numero: string | null
  licencia_estado: string | null
  licencia_vence_en: string | null
  inspecciones: string
}

/** Lista inspectores (rol inspector/aliado) con su licencia y talleres. */
export async function listarInspectores(): Promise<InspectorAdmin[]> {
  const pool = getPool()
  const res = await pool.query<InspectorRow>(
    `SELECT u.id, u.email, u.datos_perfil->>'nombre' AS nombre,
            u.wallet_address, u.rol,
            l.licencia_numero, l.estado AS licencia_estado, l.vence_en AS licencia_vence_en,
            (SELECT COUNT(*) FROM inspecciones_fisicas i WHERE i.inspector_id = u.id) AS inspecciones
     FROM usuarios u
     LEFT JOIN inspector_licencias l ON l.inspector_id = u.id
     WHERE u.rol IN ('inspector', 'aliado')
     ORDER BY u.created_at DESC
     LIMIT 200`
  )
  if (res.rows.length === 0) return []
  const ids = res.rows.map((r: InspectorRow) => r.id)
  const talleres = await pool.query<{ inspector_id: string; aliado_id: string; nombre: string }>(
    `SELECT t.inspector_id, t.aliado_id, a.nombre
     FROM inspector_talleres t
     JOIN aliados a ON a.id = t.aliado_id
     WHERE t.inspector_id = ANY($1) AND t.activo`,
    [ids]
  )
  const porInspector = new Map<string, { id: string; nombre: string }[]>()
  for (const t of talleres.rows) {
    const arr = porInspector.get(t.inspector_id) ?? []
    arr.push({ id: t.aliado_id, nombre: t.nombre })
    porInspector.set(t.inspector_id, arr)
  }
  return res.rows.map((r: InspectorRow) => ({
    id: r.id,
    emailMasked: enmascararEmail(r.email),
    nombre: r.nombre,
    walletAddress: r.wallet_address,
    rol: r.rol,
    licenciaNumero: r.licencia_numero,
    licenciaEstado: r.licencia_estado ?? 'sin_licencia',
    licenciaVenceEn: r.licencia_vence_en,
    talleres: porInspector.get(r.id) ?? [],
    inspecciones: Number(r.inspecciones),
  }))
}

const INVITACION_INSPECTOR_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 dias, mismo criterio que "Iniciar Certificacion"

export interface InvitarInspectorInput {
  nombre: string
  email: string
}

/**
 * Invita a un inspector real (rol 'inspector' -- personal de fuerzas de
 * seguridad, dado de alta por un admin). Solo `roles:gestionar`
 * (superadmin). Mismo patron que "Iniciar Certificacion" del Taller Aliado
 * (certificacion-mostrador.service.ts): cuenta con contrasena aleatoria de
 * alta entropia (nadie la conoce, nunca se expone) + token en
 * `invitaciones_cuenta` para que la persona elija su propia contrasena via
 * /reclamar-cuenta. Rechaza si el email ya tiene cuenta -- no reasigna el
 * rol de una cuenta existente por esta via.
 */
export async function invitarInspector(
  ctx: AdminContext,
  input: InvitarInspectorInput
): Promise<{ inspectorId: string }> {
  const pool = getPool()
  const email = input.email.trim().toLowerCase()

  const existente = await pool.query<{ id: string }>(
    `SELECT id FROM usuarios WHERE lower(email) = $1 LIMIT 1`,
    [email]
  )
  if (existente.rows[0]) {
    throw new ApiError(409, 'EMAIL_EN_USO', 'Ya existe una cuenta registrada con ese email.')
  }

  const passwordAleatoria = randomBytes(24).toString('hex')
  const passwordHash = await hashPassword(passwordAleatoria)
  const creado = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (email, password_hash, rol, datos_perfil, proveedor)
     VALUES ($1, $2, 'inspector', $3::jsonb, 'local')
     RETURNING id`,
    [email, passwordHash, JSON.stringify({ nombre: input.nombre, origen: 'invitacion_admin' })]
  )
  const inspectorId = creado.rows[0].id

  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await pool.query(
    `INSERT INTO invitaciones_cuenta (usuario_id, token_hash, expira_en)
     VALUES ($1, $2, $3)`,
    [inspectorId, tokenHash, new Date(Date.now() + INVITACION_INSPECTOR_TTL_MS)]
  )

  // Best-effort: un fallo de envio no debe tumbar el alta ya creada -- el
  // admin puede ver el estado y, si hace falta, resolverlo por otro medio.
  try {
    await enviarEmail({
      to: email,
      subject: 'RODAID — Invitación al Panel de Inspecciones',
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
        <h2>¡Hola ${input.nombre}!</h2>
        <p>Fuiste invitado a operar el Panel de Inspecciones de RODAID.</p>
        <p><a href="https://rodaid.net/reclamar-cuenta?token=${token}">Hacé click acá para activar tu cuenta</a> y elegir tu contraseña.</p>
      </div>`,
    })
  } catch (err) {
    console.error('Error email invitar-inspector:', err)
  }

  await auditarAdmin(ctx, {
    accion: 'inspector.invitar',
    recursoTipo: 'inspector',
    recursoId: inspectorId,
    detalle: { email: enmascararEmail(email) },
  })

  return { inspectorId }
}

/** Talleres (aliados aprobados) disponibles para asignar a un inspector. */
export async function listarTalleresAprobados(): Promise<{ id: string; nombre: string; ciudad: string | null }[]> {
  const res = await getPool().query<{ id: string; nombre: string; ciudad: string | null }>(
    `SELECT id, nombre, ciudad FROM aliados WHERE estado = 'aprobado' ORDER BY nombre LIMIT 200`
  )
  return res.rows
}

export type AccionInspector = 'licencia' | 'asignar-taller' | 'quitar-taller'

/**
 * Gestion del inspector: actualizar la licencia (numero/estado/vencimiento) o
 * asignar/quitar un taller autorizado. Auditado con la identidad del admin.
 */
export async function accionInspector(
  ctx: AdminContext,
  inspectorId: string,
  accion: AccionInspector,
  opts: {
    licenciaNumero?: string | null
    licenciaEstado?: string | null
    venceEn?: string | null
    aliadoId?: string | null
  } = {}
): Promise<{ ok: true }> {
  const pool = getPool()
  const existe = await pool.query<{ id: string }>(`SELECT id FROM usuarios WHERE id = $1 LIMIT 1`, [inspectorId])
  if (!existe.rows[0]) throw new ApiError(404, 'INSPECTOR_NOT_FOUND', 'No se encontro el inspector.')

  if (accion === 'licencia') {
    const estado = ['activa', 'suspendida', 'vencida'].includes(opts.licenciaEstado ?? '')
      ? opts.licenciaEstado!
      : 'activa'
    await pool.query(
      `INSERT INTO inspector_licencias (inspector_id, licencia_numero, estado, vence_en, actualizado_por)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (inspector_id) DO UPDATE SET
         licencia_numero = COALESCE(EXCLUDED.licencia_numero, inspector_licencias.licencia_numero),
         estado = EXCLUDED.estado,
         vence_en = EXCLUDED.vence_en,
         actualizado_por = EXCLUDED.actualizado_por`,
      [inspectorId, opts.licenciaNumero ?? null, estado, opts.venceEn ?? null, ctx.userId]
    )
    await auditarAdmin(ctx, {
      accion: 'inspector.licencia',
      recursoTipo: 'inspector',
      recursoId: inspectorId,
      detalle: { estado, licenciaNumero: opts.licenciaNumero ?? null, venceEn: opts.venceEn ?? null },
    })
    return { ok: true }
  }

  if (!opts.aliadoId) throw new ApiError(400, 'VALIDATION_ERROR', 'Falta el taller (aliadoId).')

  if (accion === 'asignar-taller') {
    await pool.query(
      `INSERT INTO inspector_talleres (inspector_id, aliado_id, asignado_por)
       VALUES ($1, $2, $3)
       ON CONFLICT (inspector_id, aliado_id) DO UPDATE SET activo = TRUE, asignado_por = EXCLUDED.asignado_por`,
      [inspectorId, opts.aliadoId, ctx.userId]
    )
    await auditarAdmin(ctx, {
      accion: 'inspector.asignar-taller',
      recursoTipo: 'inspector',
      recursoId: inspectorId,
      detalle: { aliadoId: opts.aliadoId },
    })
    return { ok: true }
  }

  // quitar-taller
  await pool.query(
    `UPDATE inspector_talleres SET activo = FALSE WHERE inspector_id = $1 AND aliado_id = $2`,
    [inspectorId, opts.aliadoId]
  )
  await auditarAdmin(ctx, {
    accion: 'inspector.quitar-taller',
    recursoTipo: 'inspector',
    recursoId: inspectorId,
    detalle: { aliadoId: opts.aliadoId },
  })
  return { ok: true }
}

// Control de accesos de terceros (Hito 16): API Keys de aseguradoras / logistica.

export interface ApiKeyAdmin {
  id: string
  nombre: string
  estado: string
  entorno: string
  apiKeyPrefix: string
  scopes: string[]
  rateLimitRpm: number
  llamadas30d: number
  creadoEn: string
}

/** Lista las aplicaciones de terceros (API Keys) con su uso reciente. */
export async function listarApiKeys(): Promise<ApiKeyAdmin[]> {
  interface ApiKeyRow {
    id: string
    nombre: string
    estado: string
    entorno: string
    api_key_prefix: string
    scopes: string[]
    rate_limit_rpm: number
    created_at: string
    llamadas: string
  }
  const res = await getPool().query<ApiKeyRow>(
    `SELECT a.id, a.nombre, a.estado, a.entorno, a.api_key_prefix, a.scopes,
            a.rate_limit_rpm, a.created_at,
            (SELECT COUNT(*) FROM developer_api_logs l
              WHERE l.app_id = a.id AND l.created_at >= NOW() - INTERVAL '30 days') AS llamadas
     FROM developer_apps a
     ORDER BY a.created_at DESC
     LIMIT 200`
  )
  return res.rows.map((r: ApiKeyRow) => ({
    id: r.id,
    nombre: r.nombre,
    estado: r.estado,
    entorno: r.entorno,
    apiKeyPrefix: r.api_key_prefix,
    scopes: r.scopes ?? [],
    rateLimitRpm: r.rate_limit_rpm,
    llamadas30d: Number(r.llamadas),
    creadoEn: r.created_at,
  }))
}

export type AccionApiKey = 'revocar' | 'habilitar'

/**
 * Habilita o revoca (suspende) la API Key de un tercero. Al revocar se anulan de
 * inmediato sus tokens OAuth vivos. Auditado con la identidad del admin.
 */
export async function accionApiKey(
  ctx: AdminContext,
  appId: string,
  accion: AccionApiKey,
  opts: { motivo?: string | null } = {}
): Promise<{ id: string; estado: string }> {
  const pool = getPool()
  const found = await pool.query<{ id: string; estado: string; nombre: string }>(
    `SELECT id, estado, nombre FROM developer_apps WHERE id = $1 LIMIT 1`,
    [appId]
  )
  const app = found.rows[0]
  if (!app) throw new ApiError(404, 'APP_NOT_FOUND', 'No se encontro la aplicacion de tercero.')

  const estado = accion === 'revocar' ? 'suspendida' : 'activa'
  await pool.query(`UPDATE developer_apps SET estado = $2, updated_at = NOW() WHERE id = $1`, [appId, estado])
  if (accion === 'revocar') {
    await revocarTokensDeApp(appId).catch(() => undefined)
  }
  await auditarAdmin(ctx, {
    accion: `apikey.${accion}`,
    recursoTipo: 'developer_app',
    recursoId: appId,
    detalle: { app: app.nombre, estadoPrevio: app.estado, estado, motivo: opts.motivo ?? null },
  })
  return { id: appId, estado }
}

// ── Soporte oficial: revelado justificado de datos personales ──────────────────

export interface DatosPersonalesRevelados {
  usuarioId: string
  email: string | null
  dni: string | null
  nombre: string | null
  telefono: string | null
  rol: string
  estado: string
}

/**
 * Revela los datos personales de un usuario para un PROCESO DE SOPORTE OFICIAL.
 * Exige un motivo explicito y queda asentado en la bitacora inmutable. Es la
 * unica via por la que un administrador ve DNI/email en claro.
 */
export async function revelarDatosUsuario(
  ctx: AdminContext,
  usuarioId: string,
  motivo: string
): Promise<DatosPersonalesRevelados> {
  if (!motivo || motivo.trim().length < 8) {
    throw new ApiError(
      400,
      'MOTIVO_REQUERIDO',
      'Para ver datos personales se requiere un motivo de soporte oficial (min. 8 caracteres).'
    )
  }
  const res = await getPool().query<{
    id: string
    email: string | null
    rol: string
    estado: string
    datos_perfil: Record<string, unknown> | null
    datos_oficiales: Record<string, unknown> | null
  }>(
    `SELECT u.id, u.email, u.rol, u.estado, u.datos_perfil,
            (SELECT datos_oficiales FROM identidades_federadas f
              WHERE f.user_id = u.id AND f.provider_id = 'mxm'
              ORDER BY f.verified_at DESC LIMIT 1) AS datos_oficiales
     FROM usuarios u WHERE u.id = $1 LIMIT 1`,
    [usuarioId]
  )
  const row = res.rows[0]
  if (!row) throw new ApiError(404, 'USUARIO_NOT_FOUND', 'No se encontro el usuario.')

  const perfil = row.datos_perfil ?? {}
  const oficial = row.datos_oficiales ?? {}
  const pick = (...vals: unknown[]): string | null => {
    for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim()
    return null
  }

  // El acceso a datos personales SIEMPRE se audita (restriccion del hito).
  await auditarAdmin(ctx, {
    accion: 'datos-personales.ver',
    recursoTipo: 'usuario',
    recursoId: usuarioId,
    detalle: { motivo: motivo.trim() },
  })

  return {
    usuarioId: row.id,
    email: row.email,
    dni: pick(oficial.dni, perfil.dni as string),
    nombre: pick(oficial.nombreCompleto, perfil.nombre as string, perfil.nombreCompleto as string),
    telefono: pick(perfil.telefono as string),
    rol: row.rol,
    estado: row.estado,
  }
}

// ── Bitacora (lectura para auditores) ──────────────────────────────────────────

export interface BitacoraEntrada {
  id: string
  adminId: string
  adminRol: string
  accion: string
  recursoTipo: string | null
  recursoId: string | null
  resultado: string
  detalle: Record<string, unknown>
  createdAt: string
}

/** Lee la bitacora inmutable del panel (opcionalmente filtrada por accion). */
export async function listarBitacora(opts: { accion?: string; limite?: number } = {}): Promise<BitacoraEntrada[]> {
  const limite = Math.min(opts.limite ?? 100, 500)
  const where = opts.accion ? `WHERE accion = $1` : ''
  const params = opts.accion ? [opts.accion, limite] : [limite]
  interface BitacoraRow {
    id: string
    admin_id: string
    admin_rol: string
    accion: string
    recurso_tipo: string | null
    recurso_id: string | null
    resultado: string
    detalle: Record<string, unknown>
    created_at: string
  }
  const res = await getPool().query<BitacoraRow>(
    `SELECT id, admin_id, admin_rol, accion, recurso_tipo, recurso_id, resultado, detalle, created_at
     FROM admin_bitacora
     ${where}
     ORDER BY created_at DESC
     LIMIT $${opts.accion ? 2 : 1}`,
    params
  )
  return res.rows.map((r: BitacoraRow) => ({
    id: r.id,
    adminId: r.admin_id,
    adminRol: r.admin_rol,
    accion: r.accion,
    recursoTipo: r.recurso_tipo,
    recursoId: r.recurso_id,
    resultado: r.resultado,
    detalle: r.detalle ?? {},
    createdAt: r.created_at,
  }))
}

// ───────────────────────────────────────────────────────────────────────────────
// MODULO 5 — Disputas de CIT Completo (Esquema 1 Caso B).
// ───────────────────────────────────────────────────────────────────────────────
//
// La logica de dominio (reputacion, evidencia, umbral anti-fraude) vive en
// src/services/disputas-cit-completo.service.ts, que deliberadamente NO
// importa de este archivo (para no crear un ciclo: este archivo ya importa
// DE ese servicio). El AdminContext/auditoria del panel se resuelve aca.

/** Cola de revision humana (2da+ cancelacion con evidencia de un vendedor). */
export async function obtenerColaRevisionDisputasCit(): Promise<DisputaEnCola[]> {
  return listarColaRevisionHumana()
}

export type DecisionDisputaCit = 'confirmar_naranja' | 'desestimar'

/**
 * Resuelve una disputa de CIT Completo EN_REVISION_HUMANA. Solo
 * `moderacion:accion` (superadmin/soporte, no auditor -- solo lectura).
 *
 * `sancionarTaller` (Esquema 2, parte (a)) es independiente de `decision`:
 * el Taller Aliado de esa transacción puede haber actuado de mala fe sin
 * importar si el vendedor termina sancionado o desestimado -- reusa la
 * misma evidencia ya presentada en la disputa, sin canal de denuncia nuevo.
 */
export async function resolverDisputaCitCompletoHumano(
  ctx: AdminContext,
  disputaId: string,
  decision: DecisionDisputaCit,
  nota: string | null,
  sancionarTaller = false,
  tallerNota: string | null = null
): Promise<{ vendedorId: string; deudaId: string | null; deudaTallerId: string | null }> {
  const resultado =
    decision === 'confirmar_naranja'
      ? await confirmarNaranja(disputaId, ctx.userId, nota, sancionarTaller, tallerNota)
      : await desestimarDisputa(disputaId, ctx.userId, nota, sancionarTaller, tallerNota).then((r) => ({
          ...r,
          deudaId: null,
        }))

  await auditarAdmin(ctx, {
    accion: decision === 'confirmar_naranja' ? 'disputa_cit.confirmar_naranja' : 'disputa_cit.desestimar',
    recursoTipo: 'disputa_cit_completo',
    recursoId: disputaId,
    detalle: {
      nota: nota ?? null,
      deudaId: resultado.deudaId,
      sancionarTaller,
      tallerNota: sancionarTaller ? tallerNota ?? null : null,
      deudaTallerId: resultado.deudaTallerId,
    },
  })

  return resultado
}

// ───────────────────────────────────────────────────────────────────────────────
// MODULO 6 — Reclamos de titularidad (Esquema 3).
// ───────────────────────────────────────────────────────────────────────────────
//
// Misma separación que el MODULO 5: la lógica de dominio (evidencia,
// notificación al dueño actual, cruce con el MPF) vive en
// src/services/reclamos-titularidad.service.ts, que deliberadamente NO
// importa de este archivo. El AdminContext/auditoria del panel se resuelve
// acá. Reusa moderacion:ver/moderacion:accion -- mismo tipo de acción que
// resolver una disputa, sin permisos nuevos.

/** Cola de revisión humana (dueño actual no respondió en 48hs, o el reclamante inició sin respuesta esperable). */
export async function obtenerColaRevisionReclamos(): Promise<ReclamoEnCola[]> {
  return listarColaRevisionReclamos()
}

export type DecisionReclamoTitularidad = 'aprobar' | 'desestimar'

/**
 * Resuelve un reclamo de titularidad EN_REVISION_HUMANA. Solo
 * `moderacion:accion` (superadmin/soporte, no auditor -- solo lectura).
 * Aprobar ejecuta la transferencia real de inmediato (mismo mecanismo que
 * los otros dos caminos de transferirTitularidadBicicleta()).
 */
export async function resolverReclamoTitularidadHumano(
  ctx: AdminContext,
  reclamoId: string,
  decision: DecisionReclamoTitularidad,
  nota: string | null
): Promise<{ reclamanteId: string; transferenciaId: string | null }> {
  const resultado =
    decision === 'aprobar'
      ? await aprobarReclamoHumano(reclamoId, ctx.userId, nota)
      : { ...(await desestimarReclamoHumano(reclamoId, ctx.userId, nota)), transferenciaId: null }

  await auditarAdmin(ctx, {
    accion: decision === 'aprobar' ? 'reclamo_titularidad.aprobar' : 'reclamo_titularidad.desestimar',
    recursoTipo: 'reclamo_titularidad',
    recursoId: reclamoId,
    detalle: { nota: nota ?? null, transferenciaId: resultado.transferenciaId },
  })

  return resultado
}
