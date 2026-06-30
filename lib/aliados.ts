'use client'

import { authedFetch, ensureRoleSession } from '@/lib/session'

/**
 * Cliente de Gestion de Aliados (Hito 11): solicitud publica de talleres/tiendas
 * y administracion (listado + aprobacion) para el rol admin.
 */

export interface AliadoPublico {
  id: string
  nombre: string
  tipo: string
  email: string
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  cuit: string | null
  estado: string
  usuarioId: string | null
  solicitadoEn: string
  resueltoEn: string | null
  motivoRechazo: string | null
  serviciosCount?: number
}

export interface SolicitudAliadoInput {
  nombre: string
  tipo: string
  email: string
  telefono?: string
  direccion?: string
  ciudad?: string
  cuit?: string
}

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

/**
 * Envia la solicitud para ser Aliado. Usa `authedFetch` para que, si hay sesion,
 * esa cuenta quede vinculada como duena del aliado (y reciba el rol al aprobarse).
 */
export async function solicitarAliado(
  input: SolicitudAliadoInput
): Promise<{ aliado: AliadoPublico }> {
  return leer(
    await authedFetch('/api/v1/aliados/solicitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  )
}

/** Garantiza una sesion admin (preview) para operar el panel de aliados. */
export async function ensureAdminSession() {
  return ensureRoleSession(['admin'], 'admin')
}

export async function listarAliados(estado?: string): Promise<AliadoPublico[]> {
  const qs = estado ? `?estado=${encodeURIComponent(estado)}` : ''
  const data = await leer<{ aliados: AliadoPublico[] }>(
    await authedFetch(`/api/v1/admin/aliados${qs}`)
  )
  return data.aliados
}

export async function resolverAliado(
  id: string,
  accion: 'aprobar' | 'rechazar',
  motivo?: string
): Promise<{ aliado: AliadoPublico; rolAsignado: boolean }> {
  return leer(
    await authedFetch(`/api/v1/admin/aliados/${encodeURIComponent(id)}/aprobar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion, motivo }),
    })
  )
}
