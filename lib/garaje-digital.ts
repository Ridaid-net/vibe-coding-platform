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
  publicacionSlug: string | null
}

export interface ActivosResponse {
  activos: ActivoGaraje[]
  hayPendientes: boolean
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
