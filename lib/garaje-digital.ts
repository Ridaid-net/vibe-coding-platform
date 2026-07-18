'use client'

import useSWR from 'swr'
import { authedFetch } from '@/lib/session'

/**
 * Cliente del Garaje Digital (Hito 14). Tipos compartidos con el backend
 * (`src/services/garaje.service.ts`), fetchers autenticados y los hooks de SWR
 * con POLLING optimizado del pipeline de 72hs.
 */

// ── Tipos (espejo del servicio) ───────────────────────────────────────────────

export type EstadoActivo =
  | 'verificado'
  | 'bloqueado'
  | 'pendiente'
  | 'rechazado'
  | 'vencido'
  | 'pago_pendiente'
  | 'sin_verificar'

export interface AnclajeBfa {
  estado: string
  /** 'ONCHAIN' (anclaje real) | 'STUB' (registro interno, no blockchain) | null. */
  modo: string | null
  txHash: string | null
  tokenId: string | null
  ancladoEn: string | null
}

export interface ActaFirmada {
  id: string
  resultado: 'APROBADA' | 'DISCREPANCIA'
  firmada: boolean
  algoritmo: string | null
  certSerie: string | null
  modo: string | null
  tallerNombre: string | null
  creadoEn: string
}

export interface EstadoPipeline {
  estado: 'PENDIENTE' | 'EN_PROCESO' | 'APROBADO' | 'BLOQUEADO' | 'ERROR'
  ejecutarEn: string | null
  resultado: string | null
  creadoEn: string
}

/** Score de Confianza de la Bici (0-100), ver CLAUDE.md para el diseno completo. */
export interface ScoreConfianza {
  total: number
  badge: 'oro' | 'bronce' | null
  factores: {
    cit: number
    talleres: number
    biciSalud: number
    antiguedad: number
  }
}

export interface ActivoGaraje {
  id: string
  marca: string
  modelo: string
  numeroSerie: string
  tipo: string
  anio: number | null
  color: string | null
  fotoUrl: string | null
  rodado: number | null
  talleCuadro: string | null
  creadoEn: string
  /** NULL = no declarado todavía. Distinto de FALSE (confirmado rígida). */
  suspensionTrasera: boolean | null
  /** true si la última inspección Checklist Premium marcó PR08 (batería) en 'falla'. */
  bateriaFalla: boolean
  estado: EstadoActivo
  citId: string | null
  citEstado: string | null
  codigoCit: string | null
  hashSha256: string | null
  citVencimiento: string | null
  citActivo: boolean
  bfa: AnclajeBfa | null
  pipeline: EstadoPipeline | null
  actas: ActaFirmada[]
  tienePublicacionActiva: boolean
  /** UUID real -- usar para linkear a /marketplace/[id], nunca publicacionSlug. */
  publicacionId: string | null
  publicacionSlug: string | null
  /** Presente solo si estado === 'pago_pendiente' (solicitud de CIT Express sin confirmar). */
  solicitudPago: { montoARS: number; initPoint: string } | null
  scoreConfianza: ScoreConfianza
}

export interface ActivosResponse {
  activos: ActivoGaraje[]
  hayPendientes: boolean
  /** Swipe to Sell: si el usuario ya tiene CBU/alias cargado. Chequeado de
   * entrada (no al final del gesto) -- ver usuarioTieneDatosBancarios(). */
  tieneDatosBancarios: boolean
  /** Swipe to Sell: cotización del dólar blue, resuelta en el servidor
   * (ver src/services/cotizacion.service.ts::obtenerCotizacionDolarBlue()). */
  tipoDeCambioBlueMep: {
    valor: number
    fuente: 'override_manual' | 'dolarapi.com' | 'cache_vencido' | 'referencia_fallback'
    actualizadoEn: string
  }
}

export interface MiPublicacion {
  id: string
  slug: string
  titulo: string
  estado: string
  precioARS: number
  precioUSD: number | null
  fotoUrl: string | null
  vistas: number
  contactos: number
  publicadoEn: string
  venceEn: string
  vendidoEn: string | null
  bicicleta: {
    marca: string | null
    modelo: string | null
    numeroSerie: string | null
    tipo: string | null
  }
  transaccion: {
    id: string
    estado: string
    precioARS: number
    montoVendedor: number
    comisionRodaid: number
    aliadoId: string | null
    tallerNombre: string | null
    remito: { numero: string; estado: 'GENERADO' | 'DESPACHADO' } | null
  } | null
}

export interface MiCompra {
  transaccionId: string
  estado: string
  plan: string
  precioARS: number
  reservaVenceEn: string | null
  creadoEn: string
  publicacion: {
    id: string
    slug: string
    titulo: string
    fotoUrl: string | null
  }
  bicicleta: {
    marca: string | null
    modelo: string | null
    numeroSerie: string | null
    tipo: string | null
  }
  aliadoId: string | null
  remito: { numero: string; estado: 'GENERADO' | 'DESPACHADO' } | null
  remitoVencido: boolean
}

export interface PuntoCalorPersonal {
  celda: string
  lat: number
  lon: number
  zona: string
  ciudad: string
  total: number
  intensidad: number
}

export interface AnaliticaPersonal {
  metricas: {
    totalBicis: number
    verificadas: number
    enProceso: number
    bloqueadas: number
    sinVerificar: number
    actasFirmadas: number
    certificadosDisponibles: number
    publicacionesActivas: number
    verificacionesRecibidas: number
    verificacionesUltimos30: number
    ultimaVerificacion: string | null
  }
  mapa: {
    centro: { lat: number; lon: number }
    bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number }
    gridDeg: number
    puntos: PuntoCalorPersonal[]
    suprimidasPorKAnon: number
    generadoEn: string
  }
}

// ── Fetcher autenticado ────────────────────────────────────────────────────

async function authedJson<T>(url: string): Promise<T> {
  const res = await authedFetch(url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

// ── Historial Clinico publico (compartir, opt-in) ───────────────────────────

export interface EstadoCompartir {
  activo: boolean
  token: string | null
  url: string | null
  activadoEn: string | null
  vistas: number
}

/**
 * Estado del Historial Clinico publico de una bici (sin polling: cambia por
 * accion del usuario). `bicicletaId: null` desactiva el fetch (key null de
 * SWR) sin romper las Rules of Hooks -- el caller sigue llamando el hook
 * siempre, solo cambia si busca datos o no.
 */
export function useEstadoCompartir(bicicletaId: string | null) {
  return useSWR<EstadoCompartir>(
    bicicletaId ? `/api/v1/bicicletas/${bicicletaId}/compartir` : null,
    authedJson,
    { revalidateOnFocus: false }
  )
}

export async function activarCompartirBici(bicicletaId: string): Promise<EstadoCompartir> {
  const res = await authedFetch(`/api/v1/bicicletas/${bicicletaId}/compartir`, { method: 'POST' })
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function revocarCompartirBici(bicicletaId: string): Promise<void> {
  const res = await authedFetch(`/api/v1/bicicletas/${bicicletaId}/compartir`, { method: 'DELETE' })
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
}

// ── Gemelo Digital Interactivo (puntos de calor) ────────────────────────────

export type ZonaId =
  | 'cadena'
  | 'cubiertas'
  | 'horquilla'
  | 'rueda_delantera'
  | 'rueda_trasera'
  | 'freno_delantero'
  | 'freno_trasero'
  // Condicionales -- solo presentes si la bici las tiene (suspension_trasera
  // / tipo Eléctrica). Ver src/services/gemelo-digital.service.ts::zonasAplicables().
  | 'amortiguador_trasero'
  | 'motor'
  | 'bateria'

export type EstadoZona = 'ok' | 'media' | 'alta' | 'sin_datos'

export interface ZonaGemeloDigital {
  zonaId: ZonaId
  fuente: 'iot' | 'manual' | 'sin_datos'
  estado: EstadoZona
  titulo: string
  mensaje: string | null
  fecha: string | null
  componente?: {
    marca: string | null
    modelo: string | null
    numeroSerie: string | null
    tieneFoto: boolean
  }
}

export interface GemeloDigital {
  tipo: string
  ilustracion: 'ruta' | 'mtb' | 'urbana' | 'generica'
  zonas: ZonaGemeloDigital[]
  servicioTecnico: { titulo: string; mensaje: string; fecha: string } | null
}

/** Gemelo Digital de una bici (sin polling: es un snapshot IoT+manual, no
 * cambia por accion del usuario en esta pantalla). Mismo null-key gate que
 * useEstadoCompartir. */
export function useGemeloDigital(bicicletaId: string | null) {
  return useSWR<GemeloDigital>(
    bicicletaId ? `/api/v1/bicicletas/${bicicletaId}/gemelo-digital` : null,
    authedJson,
    { revalidateOnFocus: false }
  )
}

/**
 * Cierre de CIT Completo: el comprador confirma que recibio la bici. Libera
 * el pago al vendedor, transfiere la titularidad real y liquida el Fee de
 * Exito -- irreversible, por eso el frontend exige una confirmacion explicita
 * antes de llamarla (ver mis-compras.tsx).
 */
export async function confirmarEntregaCitCompleto(transaccionId: string): Promise<void> {
  const res = await authedFetch(`/api/v1/transacciones/${transaccionId}/confirmar-entrega-cit-completo`, {
    method: 'POST',
  })
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
}

// ── Presentacion del estado del activo ───────────────────────────────────────

export interface EstadoVisual {
  label: string
  /** clases tailwind del badge (fondo + texto). */
  badge: string
  /** acento de color del borde de la tarjeta. */
  acento: string
  tono: 'verde' | 'rojo' | 'amarillo' | 'gris'
}

export const ESTADO_VISUAL: Record<EstadoActivo, EstadoVisual> = {
  verificado: {
    label: 'Verificado',
    badge: 'bg-lime/25 text-ink',
    acento: 'border-lime-deep/50',
    tono: 'verde',
  },
  bloqueado: {
    label: 'Bloqueado',
    badge: 'bg-clay/15 text-clay',
    acento: 'border-clay/50',
    tono: 'rojo',
  },
  pendiente: {
    label: 'Pendiente',
    badge: 'bg-amber-100 text-amber-700',
    acento: 'border-amber-300/70',
    tono: 'amarillo',
  },
  vencido: {
    label: 'Vencido',
    badge: 'bg-amber-100 text-amber-700',
    acento: 'border-amber-300/70',
    tono: 'amarillo',
  },
  rechazado: {
    label: 'Rechazado',
    badge: 'bg-clay/15 text-clay',
    acento: 'border-clay/40',
    tono: 'rojo',
  },
  pago_pendiente: {
    label: 'Pago pendiente',
    badge: 'bg-amber-100 text-amber-700',
    acento: 'border-amber-300/70',
    tono: 'amarillo',
  },
  sin_verificar: {
    label: 'Sin verificar',
    badge: 'bg-paper-dim text-slate-warm',
    acento: 'border-ink/12',
    tono: 'gris',
  },
}

export function etiquetaActivo(a: {
  marca: string
  modelo: string
}): string {
  return [a.marca, a.modelo].filter(Boolean).join(' ') || 'Bicicleta'
}

// ── Hooks SWR ────────────────────────────────────────────────────────────────

/**
 * Activos del Garaje con POLLING optimizado: mientras haya alguna bici en el
 * pipeline de 72hs (estado 'pendiente'), refresca cada `intervaloMs` para que la
 * UI reaccione apenas el CIT pase a APROBADO o BLOQUEADO. Si no hay pendientes,
 * deja de hacer polling (refreshInterval = 0) para no malgastar requests.
 */
export function useActivosGaraje(intervaloMs = 15000) {
  return useSWR<ActivosResponse>(
    '/api/usuario/bicicletas',
    authedJson,
    {
      // Polling condicional: solo mientras haya jobs pendientes.
      refreshInterval: (data) => (data?.hayPendientes ? intervaloMs : 0),
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  )
}

export function useMisPublicaciones() {
  return useSWR<{ publicaciones: MiPublicacion[]; activas: number }>(
    '/api/marketplace/mis-publicaciones',
    authedJson,
    { revalidateOnFocus: true, keepPreviousData: true }
  )
}

export function useMisCompras() {
  return useSWR<{ compras: MiCompra[] }>(
    '/api/marketplace/mis-compras',
    authedJson,
    { revalidateOnFocus: true, keepPreviousData: true }
  )
}

export function useAnaliticaPersonal() {
  return useSWR<AnaliticaPersonal>(
    '/api/usuario/analitica',
    authedJson,
    { revalidateOnFocus: false, keepPreviousData: true }
  )
}

export interface MiPerfil {
  id: string
  nombre: string | null
  email: string
  rol: string
  selloGubernamental: boolean
  emailVerificado: boolean
}

/** Perfil del usuario autenticado (para el Sello Gubernamental del Hito 9). */
export function useMiPerfil() {
  return useSWR<MiPerfil | null>(
    '/api/v1/auth/me',
    async (url: string) => {
      const res = await authedFetch(url)
      if (!res.ok) return null
      const data = await res.json()
      const u = data?.usuario
      if (!u) return null
      return {
        id: u.id as string,
        nombre: (u.datosPerfil?.nombre as string | undefined) ?? null,
        email: u.email,
        rol: u.rol,
        selloGubernamental: Boolean(u.selloGubernamental),
        emailVerificado: Boolean(u.emailVerificado),
      }
    },
    { revalidateOnFocus: false }
  )
}

/**
 * Descarga el Certificado Digital de Propiedad y Verificacion (PDF firmado) de un
 * activo verificado y dispara la descarga en el navegador. El endpoint esta
 * protegido (Bearer), por eso se baja con `authedFetch` y se abre como blob.
 */
export async function descargarCertificadoActivo(a: ActivoGaraje): Promise<void> {
  const id = a.citId ?? a.id
  const res = await authedFetch(
    `/api/v1/cit/${encodeURIComponent(id)}/certificado`
  )
  if (!res.ok) {
    const detalle = await res.json().catch(() => null)
    throw new Error(
      (detalle && (detalle.message as string)) ??
        'No pudimos generar el certificado.'
    )
  }
  const blob = await res.blob()
  const numero =
    res.headers.get('x-rodaid-cert-numero') ?? `RODAID-CERT-${a.numeroSerie}`
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = `${numero}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
