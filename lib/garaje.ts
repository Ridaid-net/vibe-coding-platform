'use client'

import { authedFetch } from '@/lib/session'

/**
 * Bicicleta del usuario tal como la devuelve `GET /api/v1/bicicletas`, con el
 * estado de su CIT (identidad verificada) y si ya tiene una publicacion activa.
 * Es el modelo que consumen el BicycleSelector y "Mi Garaje".
 */
export interface BicicletaGaraje {
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
  citEstado: string | null
  citVencimiento: string | null
  citActivo: boolean
  tienePublicacionActiva: boolean
}

export interface GarajeResponse {
  bicicletas: BicicletaGaraje[]
  tieneVerificada: boolean
}

/** Trae las bicicletas del usuario autenticado (crea la sesion si hace falta). */
export async function fetchMisBicicletas(
  signal?: AbortSignal
): Promise<GarajeResponse> {
  const res = await authedFetch('/api/v1/bicicletas', { signal })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return (await res.json()) as GarajeResponse
}

export function etiquetaBici(b: BicicletaGaraje): string {
  return [b.marca, b.modelo].filter(Boolean).join(' ') || 'Bicicleta'
}
