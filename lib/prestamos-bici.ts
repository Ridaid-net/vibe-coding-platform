'use client'

import useSWR from 'swr'
import { authedFetch } from '@/lib/session'

/**
 * Cliente del Préstamo gratuito de bicis certificadas propias del Taller
 * Aliado (NO alquiler pago, sin cobro). Habla con /api/v1/taller/prestamos/*.
 */

export interface PrestamoBici {
  id: string
  bicicletaId: string
  tallerId: string
  estado: 'disponible' | 'prestada'
  prestatarioNombre: string | null
  prestatarioContacto: string | null
  horaInicio: string | null
  horaEsperadaDevolucion: string | null
  horaDevolucionReal: string | null
  vencido: boolean
}

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function fetchPrestamos(url: string): Promise<{ prestamos: PrestamoBici[] }> {
  return leer(await authedFetch(url))
}

/** Bicis en préstamo/disponibles del Taller Aliado logueado. */
export function usePrestamosBici() {
  return useSWR<{ prestamos: PrestamoBici[] }>(
    '/api/v1/taller/prestamos',
    fetchPrestamos,
    { revalidateOnFocus: true, keepPreviousData: true }
  )
}

export async function marcarDisponible(bicicletaId: string): Promise<PrestamoBici> {
  const data = await leer<{ prestamo: PrestamoBici }>(
    await authedFetch('/api/v1/taller/prestamos/marcar-disponible', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bicicletaId }),
    })
  )
  return data.prestamo
}

export async function iniciarPrestamo(input: {
  bicicletaId: string
  prestatarioNombre: string
  prestatarioContacto?: string
  horaEsperadaDevolucion: string
}): Promise<PrestamoBici> {
  const data = await leer<{ prestamo: PrestamoBici }>(
    await authedFetch('/api/v1/taller/prestamos/iniciar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  )
  return data.prestamo
}

export async function cerrarPrestamo(bicicletaId: string): Promise<PrestamoBici> {
  const data = await leer<{ prestamo: PrestamoBici }>(
    await authedFetch('/api/v1/taller/prestamos/cerrar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bicicletaId }),
    })
  )
  return data.prestamo
}
