// ─── RODAID · Cliente de API ─────────────────────────────────────────────
//
// Cliente tipado para los endpoints reales de la API RODAID montada en este
// proyecto (`app/api/v1/**`). Cada método llama a un endpoint que existe hoy y
// devuelve el envoltorio de respuesta que ese endpoint produce realmente.
//
// La autenticación de usuario usa Bearer JWT tomado de `localStorage`
// (clave `rodaid_token`); las operaciones administrativas usan el header
// `x-admin-token`. Toda llamada pasa por `fetchConErrores`, así que los errores
// llegan ya clasificados como `RodaidError` con reintento automático para
// fallas de red y 5xx.
//
// Nota: el material de referencia (`rodaid-api-client.js`) describía además
// endpoints que este backend todavía no expone (auth/login, garaje, cit/nuevo,
// firma PDF, MxM, MinSeg, analítica, mapa de calor, GPT). Esos métodos no se
// incluyen aquí para no apuntar a rutas inexistentes; se agregarán cuando los
// endpoints correspondientes existan.

import { fetchConErrores, type FetchConErroresOpts } from '@/lib/rodaid/errors'

// ─── Tipos de respuesta ────────────────────────────────────────────────────

export interface BicicletaResumen {
  marca: string | null
  modelo: string | null
  anio: number | null
  tipo: string | null
  numeroSerie: string | null
}

export interface Publicacion {
  id: string
  citId: string
  bicicletaId: string
  vendedorId: string
  titulo: string
  descripcion: string
  precioARS: number
  precioUSD: number | null
  fotosUrls: string[]
  estado: string
  slug: string
  vistas: number
  contactos: number
  publicadoEn: string
  venceEn: string
  vendidoEn: string | null
  compradorId: string | null
  precioFinalARS: number | null
  comisionRodaid: number | null
  bicicleta: BicicletaResumen
}

export interface Faceta {
  valor: string
  conteo: number
}

export interface RangoPrecio {
  etiqueta: string
  min: number
  max: number
  conteo: number
}

export interface BusquedaMarketplace {
  publicaciones: Publicacion[]
  total: number
  pagina: number
  paginas: number
  tiempoMs: number
  fromCache: boolean
  facetas: {
    marcas: Faceta[]
    tipos: Faceta[]
    rangosPrecio: RangoPrecio[]
    totalActivas: number
  }
  query: {
    q: string | null
    filtros: Record<string, unknown>
  }
}

export interface FiltrosMarketplace {
  q?: string
  estado?: string
  marca?: string | string[]
  tipo?: string
  precioMin?: number
  precioMax?: number
  anioMin?: number
  anioMax?: number
  orden?: 'relevancia' | 'precio_asc' | 'precio_desc' | 'recientes' | 'vistas'
  pagina?: number
  limite?: number
}

// Las respuestas con datos públicos del backend usan el envoltorio { ok, data }.
export interface RespuestaOk<T> {
  ok: true
  data: T
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function toQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length) sp.set(key, value.join(','))
    } else {
      sp.set(key, String(value))
    }
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

function adminHeaders(adminToken: string): RequestInit {
  return { headers: { 'x-admin-token': adminToken } }
}

// ─── Marketplace ───────────────────────────────────────────────────────────

export const marketplace = {
  // GET /marketplace — listado + búsqueda full-text + facetas
  buscar: (filtros: FiltrosMarketplace = {}, opts?: FetchConErroresOpts) =>
    fetchConErrores<BusquedaMarketplace>(`/marketplace${toQuery(filtros as Record<string, unknown>)}`, {}, opts),

  // POST /marketplace/publicar — publicar una bicicleta con CIT vigente
  publicar: (body: Record<string, unknown>, opts?: FetchConErroresOpts) =>
    fetchConErrores<Publicacion>('/marketplace/publicar', { method: 'POST', body: JSON.stringify(body) }, opts),

  // POST /marketplace/:id/comprar — iniciar la compra (escrow)
  comprar: (publicacionId: string, body: Record<string, unknown> = {}, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>(
      `/marketplace/${encodeURIComponent(publicacionId)}/comprar`,
      { method: 'POST', body: JSON.stringify(body) },
      opts
    ),
}

// ─── Transacciones / escrow ──────────────────────────────────────────────────

export const transacciones = {
  // GET /transacciones/:id — estado de la transacción de escrow
  obtener: (id: string, opts?: FetchConErroresOpts) =>
    fetchConErrores<{ transaccion: unknown }>(`/transacciones/${encodeURIComponent(id)}`, {}, opts),

  // GET /transacciones/:id/eventos — historial de eventos
  eventos: (id: string, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>(`/transacciones/${encodeURIComponent(id)}/eventos`, {}, opts),

  // POST /transacciones/:id/confirmar-envio
  confirmarEnvio: (id: string, body: Record<string, unknown> = {}, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>(
      `/transacciones/${encodeURIComponent(id)}/confirmar-envio`,
      { method: 'POST', body: JSON.stringify(body) },
      opts
    ),

  // POST /transacciones/:id/confirmar-entrega
  confirmarEntrega: (id: string, body: Record<string, unknown> = {}, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>(
      `/transacciones/${encodeURIComponent(id)}/confirmar-entrega`,
      { method: 'POST', body: JSON.stringify(body) },
      opts
    ),

  // POST /transacciones/:id/disputar
  disputar: (id: string, body: Record<string, unknown> = {}, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>(
      `/transacciones/${encodeURIComponent(id)}/disputar`,
      { method: 'POST', body: JSON.stringify(body) },
      opts
    ),

  // POST /transacciones/:id/cancelar
  cancelar: (id: string, body: Record<string, unknown> = {}, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>(
      `/transacciones/${encodeURIComponent(id)}/cancelar`,
      { method: 'POST', body: JSON.stringify(body) },
      opts
    ),
}

// ─── Verificación pública de CIT ──────────────────────────────────────────────

export const verificar = {
  // GET /verificar/:serial — verificación pública por número de serie
  porSerial: (serial: string, origen = 'WEB', opts?: FetchConErroresOpts) =>
    fetchConErrores<RespuestaOk<unknown>>(
      `/verificar/${encodeURIComponent(serial)}${toQuery({ origen })}`,
      {},
      opts
    ),

  // GET /verificar/numero/:numeroCIT — verificación pública por número de CIT
  porNumero: (numeroCIT: string, origen = 'WEB', opts?: FetchConErroresOpts) =>
    fetchConErrores<RespuestaOk<unknown>>(
      `/verificar/numero/${encodeURIComponent(numeroCIT)}${toQuery({ origen })}`,
      {},
      opts
    ),
}

// ─── CIT (inspector) ──────────────────────────────────────────────────────────

export const cit = {
  // GET /cit/serial/validar?serial=... — pre-chequeo de validación de serie
  validarSerial: (serial: string, opts?: FetchConErroresOpts) =>
    fetchConErrores<RespuestaOk<unknown>>(`/cit/serial/validar${toQuery({ serial })}`, {}, opts),

  // POST /cit/iniciar — emisión de un CIT por un inspector habilitado
  iniciar: (body: Record<string, unknown>, opts?: FetchConErroresOpts) =>
    fetchConErrores<RespuestaOk<unknown>>('/cit/iniciar', { method: 'POST', body: JSON.stringify(body) }, opts),
}

// ─── Roles / perfil ───────────────────────────────────────────────────────────

export const roles = {
  // GET /roles — catálogo de roles y su matriz de permisos
  listar: (opts?: FetchConErroresOpts) => fetchConErrores<RespuestaOk<unknown>>('/roles', {}, opts),

  // GET /roles/mine — rol y permisos del usuario autenticado
  mios: (opts?: FetchConErroresOpts) => fetchConErrores<unknown>('/roles/mine', {}, opts),

  // GET /roles/check/:permiso — si el usuario tiene un permiso concreto
  comprobar: (permiso: string, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>(`/roles/check/${encodeURIComponent(permiso)}`, {}, opts),
}

export const inspector = {
  // GET /inspector/perfil — perfil del inspector autenticado
  perfil: (opts?: FetchConErroresOpts) => fetchConErrores<unknown>('/inspector/perfil', {}, opts),
}

export const aliado = {
  // GET /aliado/mi-taller — taller del aliado autenticado
  miTaller: (opts?: FetchConErroresOpts) => fetchConErrores<unknown>('/aliado/mi-taller', {}, opts),
}

// ─── Administración (header x-admin-token) ────────────────────────────────────

export const admin = {
  queueStats: (adminToken: string, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>('/admin/queue/stats', adminHeaders(adminToken), opts),

  procesarQueue: (adminToken: string, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>('/admin/queue/procesar', { method: 'POST', ...adminHeaders(adminToken) }, opts),

  limpiarQueue: (adminToken: string, cola: string, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>(
      `/admin/queue/limpiar/${encodeURIComponent(cola)}`,
      { method: 'POST', ...adminHeaders(adminToken) },
      opts
    ),

  verificadorStats: (adminToken: string, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>('/admin/verificador/stats', adminHeaders(adminToken), opts),

  autoRelease: (adminToken: string, opts?: FetchConErroresOpts) =>
    fetchConErrores<unknown>('/admin/escrow/auto-release', { method: 'POST', ...adminHeaders(adminToken) }, opts),
}

export const rodaid = {
  marketplace,
  transacciones,
  verificar,
  cit,
  roles,
  inspector,
  aliado,
  admin,
}
