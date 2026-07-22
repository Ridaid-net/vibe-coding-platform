'use client'

import { authedFetch, ensureRoleSession } from '@/lib/session'

/**
 * RODAID — Hito 19: cliente del Dashboard de Administracion.
 *
 * Habla con los endpoints `/api/v1/admin/panel/*`. Sobre la sesion de usuario
 * (rol admin) suma el SEGUNDO FACTOR obligatorio: tras verificar el codigo TOTP,
 * el backend emite un token de step-up corto que este cliente adjunta en cada
 * llamada del panel (cabecera `x-rodaid-mfa`). En preview, la sesion admin demo y
 * el codigo TOTP demo permiten ejercitar el flujo de punta a punta.
 */

const MFA_KEY = 'rodaid.admin.mfa.v1'

interface StepUpStored {
  token: string
  venceEn: number
  adminRol: AdminRol
  permisos: AdminPermiso[]
}

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

function readStepUp(): StepUpStored | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(MFA_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as StepUpStored
    if (s.token && s.venceEn > Date.now()) return s
  } catch {
    // descartar
  }
  return null
}

function writeStepUp(s: StepUpStored) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(MFA_KEY, JSON.stringify(s))
}

export function clearStepUp() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(MFA_KEY)
}

export function tieneStepUp(): boolean {
  return readStepUp() !== null
}

export function permisosActuales(): AdminPermiso[] {
  return readStepUp()?.permisos ?? []
}

export function rolActual(): AdminRol | null {
  return readStepUp()?.adminRol ?? null
}

export function puede(permiso: AdminPermiso): boolean {
  return permisosActuales().includes(permiso)
}

/** Garantiza la sesion base con rol admin (en preview, demo). */
export async function ensureAdminBaseSession() {
  return ensureRoleSession(['admin'], 'admin')
}

/** Error del panel con el codigo estable de la API (para distinguir MFA). */
export class AdminError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message)
  }
}

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null
    throw new AdminError(detalle?.error ?? 'ERROR', detalle?.message ?? `HTTP ${res.status}`, res.status)
  }
  return (await res.json()) as T
}

/** fetch del panel: sesion admin + cabecera de step-up MFA. */
async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  await ensureAdminBaseSession()
  const step = readStepUp()
  const headers = new Headers(init.headers)
  if (step) headers.set('x-rodaid-mfa', step.token)
  return authedFetch(path, { ...init, headers })
}

async function getJson<T>(path: string): Promise<T> {
  return leer<T>(await adminFetch(path))
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return leer<T>(
    await adminFetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  )
}

// ── MFA ────────────────────────────────────────────────────────────────────────

export interface MfaStatus {
  adminRol: AdminRol
  mfaHabilitado: boolean
  permisos: AdminPermiso[]
}

export async function getMfaStatus(): Promise<MfaStatus> {
  await ensureAdminBaseSession()
  return leer<MfaStatus>(await authedFetch('/api/v1/admin/panel/mfa'))
}

export interface EnrolMfa {
  yaHabilitado: boolean
  secret: string
  otpauthUri: string
  codigoDemo: string | null
}

export async function enrollMfa(): Promise<EnrolMfa> {
  await ensureAdminBaseSession()
  return leer<EnrolMfa>(
    await authedFetch('/api/v1/admin/panel/mfa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  )
}

/** Verifica el codigo TOTP y persiste el token de step-up. */
export async function stepUp(code: string): Promise<MfaStatus> {
  await ensureAdminBaseSession()
  const data = await leer<{
    stepUpToken: string
    expiraEnSeg: number
    adminRol: AdminRol
    permisos: AdminPermiso[]
  }>(
    await authedFetch('/api/v1/admin/panel/sesion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
  )
  writeStepUp({
    token: data.stepUpToken,
    venceEn: Date.now() + (data.expiraEnSeg - 30) * 1000,
    adminRol: data.adminRol,
    permisos: data.permisos,
  })
  return { adminRol: data.adminRol, mfaHabilitado: true, permisos: data.permisos }
}

// ── Tipos de los modulos ─────────────────────────────────────────────────────

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
  documentoUrl: string
}

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

export interface AnaliticaEcosistema {
  generadoEn: string
  gpt: { consultas30d: number; tokensEntrada30d: number; tokensSalida30d: number; cacheHits30d: number; rehusadas30d: number }
  api: { llamadas30d: number; errores30d: number; appsActivas: number; latenciaP95Ms: number | null }
  pay: { transacciones30d: number; volumenARS30d: number; comisionARS30d: number; enDisputa: number; completadas30d: number }
  cits: { total: number; activos: number; bloqueados: number }
  usuarios: { total: number; suspendidos: number; conSelloMxm: number }
}

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
  centro: { lat: number; lon: number }
  focos: FocoInstitucional[]
  totales: { consultas: number; denuncias: number; celdas: number }
}

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
  horasEnEspera: number | null
}
export interface RemitosAdminResumen {
  generadoEn: string
  dias: number
  resumen: {
    totalGenerados: number
    totalDespachados: number
    totalPendientes: number
    tiempoPromedioDespachoHoras: number | null
  }
  talleres: { id: string; nombre: string }[]
  remitos: RemitoAdminItem[]
}

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
export interface TallerOpcion {
  id: string
  nombre: string
  ciudad: string | null
}

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

export interface DatosPersonales {
  usuarioId: string
  email: string | null
  dni: string | null
  nombre: string | null
  telefono: string | null
  rol: string
  estado: string
}

// ── Lecturas ─────────────────────────────────────────────────────────────────

export const obtenerIntegridad = () => getJson<IntegridadSistema>('/api/v1/admin/panel/integridad')

export const obtenerDenuncias = (estado?: string) =>
  getJson<{ denuncias: DenunciaModeracion[] }>(
    `/api/v1/admin/panel/moderacion/denuncias${estado ? `?estado=${encodeURIComponent(estado)}` : ''}`
  ).then((d) => d.denuncias)

export const obtenerPublicaciones = () =>
  getJson<{ publicaciones: PublicacionDisputa[] }>('/api/v1/admin/panel/moderacion/publicaciones').then(
    (d) => d.publicaciones
  )

export const obtenerAnalitica = () => getJson<AnaliticaEcosistema>('/api/v1/admin/panel/analitica')

export const obtenerMapaInstitucional = (dias: number) =>
  getJson<MapaInstitucional>(`/api/v1/admin/panel/analitica/mapa-institucional?dias=${dias}`)

export interface RemitosAdminFiltrosCliente {
  estado?: 'GENERADO' | 'DESPACHADO'
  aliadoId?: string | null
  dias?: number
}

export const obtenerRemitosAdmin = (filtros: RemitosAdminFiltrosCliente = {}) => {
  const qs = new URLSearchParams()
  if (filtros.estado) qs.set('estado', filtros.estado)
  if (filtros.aliadoId) qs.set('aliadoId', filtros.aliadoId)
  qs.set('dias', String(filtros.dias ?? 30))
  return getJson<RemitosAdminResumen>(`/api/v1/admin/panel/analitica/remitos?${qs.toString()}`)
}

export const obtenerInspectores = () =>
  getJson<{ inspectores: InspectorAdmin[]; talleres: TallerOpcion[] }>(
    '/api/v1/admin/panel/identidades/inspectores'
  )

export const obtenerApiKeys = () =>
  getJson<{ apps: ApiKeyAdmin[] }>('/api/v1/admin/panel/identidades/api-keys').then((d) => d.apps)

export const obtenerBitacora = (accion?: string) =>
  getJson<{ entradas: BitacoraEntrada[] }>(
    `/api/v1/admin/panel/bitacora${accion ? `?accion=${encodeURIComponent(accion)}` : ''}`
  ).then((d) => d.entradas)

// ── Acciones ───────────────────────────────────────────────────────────────────

export const accionarDenuncia = (id: string, accion: 'aprobar' | 'rechazar' | 'desbloquear', motivo?: string) =>
  postJson<{ id: string; estado: string; cambios: string[] }>(
    `/api/v1/admin/panel/moderacion/denuncias/${id}`,
    { accion, motivo }
  )

export const accionarPublicacion = (
  id: string,
  accion: 'despublicar' | 'reactivar' | 'suspender-cuenta' | 'reactivar-cuenta',
  motivo?: string
) => postJson<{ id: string; estado?: string; cuentaEstado?: string }>(
  `/api/v1/admin/panel/moderacion/publicaciones/${id}`,
  { accion, motivo }
)

export const accionarInspector = (
  id: string,
  body: {
    accion: 'licencia' | 'asignar-taller' | 'quitar-taller'
    licenciaNumero?: string | null
    licenciaEstado?: string | null
    venceEn?: string | null
    aliadoId?: string | null
  }
) => postJson<{ ok: true }>(`/api/v1/admin/panel/identidades/inspectores/${id}`, body)

export const accionarApiKey = (id: string, accion: 'revocar' | 'habilitar', motivo?: string) =>
  postJson<{ id: string; estado: string }>(`/api/v1/admin/panel/identidades/api-keys/${id}`, { accion, motivo })

export const revelarDatos = (usuarioId: string, motivo: string) =>
  postJson<DatosPersonales>(`/api/v1/admin/panel/soporte/usuario/${usuarioId}`, { motivo })
