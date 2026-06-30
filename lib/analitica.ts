'use client'

import { authedFetch, ensureRoleSession } from '@/lib/session'

/**
 * Cliente del dashboard de Analitica de Seguridad (Hito 8): mapa de calor
 * (GeoJSON) y alertas de "Puntos Calientes". Todos los datos son ANONIMOS y
 * AGREGADOS por barrio.
 */

export type CapaMapa = 'consultas' | 'denuncias'

export interface MapaCalorFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: {
    capa: CapaMapa
    celda: string
    zona: string
    ciudad: string
    total: number
    intensidad: number
    consultantesDistintos?: number
    seriesDistintas?: number
  }
}

export interface MapaCalor {
  type: 'FeatureCollection'
  features: MapaCalorFeature[]
  metadata: {
    ciudad: string
    centro: { lat: number; lon: number }
    bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number }
    dias: number
    gridDeg: number
    generadoEn: string
    totales: {
      consultas: number
      denuncias: number
      celdasConsultas: number
      celdasDenuncias: number
    }
    suprimidasPorKAnon: number
  }
}

export type AlertaSeveridad = 'media' | 'alta' | 'critica'
export type AlertaEstado = 'abierta' | 'reconocida' | 'descartada'

export interface AlertaSeguridad {
  id: string
  tipo: string
  celda: string
  zona: string
  ciudad: string
  lat: number | null
  lon: number | null
  volumen: number
  umbral: number
  ventanaHoras: number
  severidad: AlertaSeveridad
  estado: AlertaEstado
  detalle: Record<string, unknown>
  primeraDeteccion: string
  actualizadaEn: string
}

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

/** Garantiza una sesion de back-office (preview) para operar el dashboard. */
export async function ensureStaffSession() {
  return ensureRoleSession(['admin', 'inspector'], 'admin')
}

/** Trae el GeoJSON del mapa de calor para una ventana de dias (7/30/90). */
export async function obtenerMapaCalor(dias: number): Promise<MapaCalor> {
  return leer(await authedFetch(`/api/v1/analitica/mapa-calor?dias=${dias}`))
}

/** Lista las alertas de Puntos Calientes (por defecto, todas). */
export async function obtenerAlertas(estado?: AlertaEstado): Promise<AlertaSeguridad[]> {
  const qs = estado ? `?estado=${estado}` : ''
  const data = await leer<{ alertas: AlertaSeguridad[] }>(
    await authedFetch(`/api/v1/analitica/alertas${qs}`)
  )
  return data.alertas
}

/** Ejecuta la deteccion de Puntos Calientes a demanda. */
export async function analizarAhora(): Promise<{ detectados: number; nuevos: number }> {
  return leer(
    await authedFetch('/api/v1/analitica/alertas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  )
}

/** Cambia el estado de una alerta (reconocida / descartada). */
export async function actualizarAlerta(
  id: string,
  estado: AlertaEstado
): Promise<AlertaSeguridad> {
  const data = await leer<{ alerta: AlertaSeguridad }>(
    await authedFetch(`/api/v1/analitica/alertas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ estado }),
    })
  )
  return data.alerta
}
