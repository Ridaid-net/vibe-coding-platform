'use client'

import { authedFetch } from '@/lib/session'

/**
 * Cliente de "Uso autorizado" (Garaje Digital): hasta 2 personas por bici
 * que pueden circular con ella de forma legítima. Habla con
 * /api/v1/bicicletas/[id]/autorizados/*.
 */

export interface Autorizado {
  id: string
  bicicletaId: string
  nombreCompleto: string
  dni: string
  direccion: string
  telefono: string | null
  createdAt: string
  updatedAt: string
}

export interface AutorizadoInput {
  nombreCompleto: string
  dni: string
  direccion: string
  telefono?: string
}

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function listarAutorizados(bicicletaId: string): Promise<Autorizado[]> {
  const data = await leer<{ autorizados: Autorizado[] }>(
    await authedFetch(`/api/v1/bicicletas/${bicicletaId}/autorizados`)
  )
  return data.autorizados
}

export async function agregarAutorizado(
  bicicletaId: string,
  input: AutorizadoInput
): Promise<Autorizado> {
  const data = await leer<{ autorizado: Autorizado }>(
    await authedFetch(`/api/v1/bicicletas/${bicicletaId}/autorizados`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  )
  return data.autorizado
}

export async function editarAutorizado(
  bicicletaId: string,
  autorizadoId: string,
  input: AutorizadoInput
): Promise<Autorizado> {
  const data = await leer<{ autorizado: Autorizado }>(
    await authedFetch(`/api/v1/bicicletas/${bicicletaId}/autorizados/${autorizadoId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  )
  return data.autorizado
}

export async function eliminarAutorizado(bicicletaId: string, autorizadoId: string): Promise<void> {
  await leer(
    await authedFetch(`/api/v1/bicicletas/${bicicletaId}/autorizados/${autorizadoId}`, {
      method: 'DELETE',
    })
  )
}
