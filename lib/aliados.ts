'use client'

import { authedFetch, ensureRoleSession, getSession } from '@/lib/session'

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
 * Envia la solicitud para ser Aliado -- endpoint ABIERTO (funciona sin
 * sesion). Si ya hay una sesion guardada, se adjunta el token para que esa
 * cuenta quede vinculada como duena del aliado (y reciba el rol al
 * aprobarse) -- pero NUNCA se fuerza a crear una (authedFetch() llama a
 * ensureSession(), que en produccion intenta un demo-session bloqueado y
 * tumbaba el envio para cualquier visitante anonimo -- mismo bug ya
 * encontrado y arreglado en publicacion-detalle.tsx, 2026-07-18).
 */
export async function solicitarAliado(
  input: SolicitudAliadoInput
): Promise<{ aliado: AliadoPublico }> {
  const session = getSession()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (session?.accessToken) {
    headers.authorization = `Bearer ${session.accessToken}`
  }
  return leer(
    await fetch('/api/v1/aliados/solicitar', {
      method: 'POST',
      headers,
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
