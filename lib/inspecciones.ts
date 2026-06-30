'use client'

import { authedFetch, ensureRoleSession } from '@/lib/session'

/**
 * Cliente del Portal de Inspecciones (Hito 11). Habla con los endpoints
 * `/api/v1/inspecciones/*` adjuntando la sesion del inspector. En preview, una
 * sesion demo con rol inspector se arranca automaticamente.
 */

export interface InspectorContextoCliente {
  id: string
  rol: string
  nombre: string
  walletAddress: string | null
  aliado: { id: string; nombre: string } | null
}

export interface ActaFirmaCliente {
  algoritmo: string
  valor: string
  certSerie: string | null
  certFingerprint: string | null
  modo: string | null
}

export interface ActaInspeccion {
  id: string
  resultado: 'APROBADA' | 'DISCREPANCIA'
  inspectorId: string
  aliadoId: string | null
  tallerId: string | null
  inspectorWallet: string
  firmaHash: string
  firma: ActaFirmaCliente | null
  notas: string | null
  discrepanciaMotivo: string | null
  aceleroPipeline: boolean
  createdAt: string
}

export interface BusquedaInspeccion {
  encontrada: boolean
  autorizado: boolean
  aviso: string | null
  bicicleta?: {
    id: string
    marca: string
    modelo: string
    tipo: string
    numeroSerie: string
    anio: number | null
    color: string | null
    rodado: number | null
    talleCuadro: string | null
    titular: string | null
  }
  cit?: {
    id: string
    estado: string
    codigoCit: string
    hashSha256: string | null
    fechaVencimiento: string | null
    bfaEstado: string | null
    yaInspeccionada: boolean
  }
  pipeline?: { estado: string | null; ejecutarEn: string | null } | null
  actas: ActaInspeccion[]
}

/** Garantiza una sesion con rol inspector (preview) antes de operar el panel. */
export async function ensureInspectorSession() {
  return ensureRoleSession(['inspector', 'aliado', 'admin'], 'inspector')
}

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export async function fetchContexto(): Promise<InspectorContextoCliente> {
  return leer(await authedFetch('/api/v1/inspecciones/contexto'))
}

export async function guardarWallet(
  walletAddress: string
): Promise<InspectorContextoCliente> {
  return leer(
    await authedFetch('/api/v1/inspecciones/contexto', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress }),
    })
  )
}

export async function buscarBici(q: string): Promise<BusquedaInspeccion> {
  return leer(
    await authedFetch(`/api/inspector/cit?q=${encodeURIComponent(q)}`)
  )
}

export interface ActaFirmaRespuesta {
  algoritmo: string
  valor: string
  modo: string
  certSerie: string
  certFingerprint: string
  commonName: string
}

export interface AprobacionRespuesta {
  inspeccionId: string
  resultado: 'APROBADA'
  firmaHash: string
  firma: ActaFirmaRespuesta
  tallerId: string | null
  inspectorId: string
  aceleroPipeline: boolean
  citEstado: string
  bloqueadaPorSeguridad: boolean
  hashSha256: string | null
}

export async function aprobarInspeccion(
  citId: string,
  notas?: string
): Promise<AprobacionRespuesta> {
  return leer(
    await authedFetch('/api/inspector/cit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'aprobar', citId, notas: notas ?? null }),
    })
  )
}

export interface DiscrepanciaRespuesta {
  inspeccionId: string
  resultado: 'DISCREPANCIA'
  firmaHash: string
  firma: ActaFirmaRespuesta
  tallerId: string | null
  inspectorId: string
  citEstado: string
}

export async function reportarDiscrepancia(
  citId: string,
  motivo: string
): Promise<DiscrepanciaRespuesta> {
  return leer(
    await authedFetch('/api/inspector/cit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'discrepancia', citId, motivo }),
    })
  )
}

export interface VerificacionRespuesta {
  actaId: string
  resultado: 'APROBADA' | 'DISCREPANCIA'
  valido: boolean
  algoritmo: string | null
  modo: string | null
  certSerie: string | null
  certFingerprint: string | null
  commonName: string | null
  inspectorId: string
  tallerId: string | null
  emitidoEn: string | null
}

export async function verificarActa(
  actaId: string
): Promise<VerificacionRespuesta> {
  return leer(
    await authedFetch('/api/inspector/cit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'verificar', actaId }),
    })
  )
}
