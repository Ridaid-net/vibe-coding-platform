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

export interface ActaInspeccion {
  id: string
  resultado: 'APROBADA' | 'DISCREPANCIA'
  inspectorId: string
  aliadoId: string | null
  inspectorWallet: string
  firmaHash: string
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
    await authedFetch(`/api/v1/inspecciones/buscar?q=${encodeURIComponent(q)}`)
  )
}

export interface AprobacionRespuesta {
  inspeccionId: string
  resultado: 'APROBADA'
  firmaHash: string
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
    await authedFetch(`/api/v1/inspecciones/${encodeURIComponent(citId)}/aprobar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notas: notas ?? null }),
    })
  )
}

export async function reportarDiscrepancia(
  citId: string,
  motivo: string
): Promise<{ inspeccionId: string; resultado: 'DISCREPANCIA'; citEstado: string }> {
  return leer(
    await authedFetch(`/api/v1/inspecciones/${encodeURIComponent(citId)}/discrepancia`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo }),
    })
  )
}
