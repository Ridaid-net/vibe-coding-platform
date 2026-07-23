'use client'

import { authedFetch } from '@/lib/session'

export interface DisputaCitCompleto {
  id: string
  escrowTransaccionId: string
  publicacionId: string
  compradorId: string
  vendedorId: string
  estado: 'ABIERTA' | 'RESUELTA_AMARILLO' | 'EN_REVISION_HUMANA' | 'CONFIRMADA_NARANJA' | 'DESESTIMADA'
  motivo: string
  numeroCancelacionDelVendedor: number
  montoReembolsadoArs: number | null
  revisorId: string | null
  resolucionNota: string | null
  abiertaEn: string
  resueltaEn: string | null
}

export interface EvidenciaDisputa {
  id: string
  subidoPorId: string
  subidoPorRol: 'comprador' | 'vendedor'
  nombreArchivo: string | null
  contentType: string | null
  createdAt: string
}

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

/** Esquema 1 Caso B: el comprador abre una disputa con evidencia. */
export async function abrirDisputaCitCompleto(
  transaccionId: string,
  motivo: string,
  archivos: File[]
): Promise<DisputaCitCompleto> {
  const form = new FormData()
  form.set('motivo', motivo)
  for (const archivo of archivos) form.append('evidencia', archivo)
  const res = await authedFetch(`/api/v1/escrow/${transaccionId}/disputa`, { method: 'POST', body: form })
  const data = await leer<{ disputa: DisputaCitCompleto }>(res)
  return data.disputa
}

/** El comprador o el vendedor de la disputa suben más evidencia. */
export async function agregarEvidenciaDisputa(disputaId: string, archivos: File[]): Promise<void> {
  const form = new FormData()
  for (const archivo of archivos) form.append('evidencia', archivo)
  await leer(await authedFetch(`/api/v1/disputas-cit-completo/${disputaId}/evidencia`, { method: 'POST', body: form }))
}

export async function obtenerDisputa(
  disputaId: string
): Promise<{ disputa: DisputaCitCompleto; evidencia: EvidenciaDisputa[] }> {
  return leer(await authedFetch(`/api/v1/disputas-cit-completo/${disputaId}`))
}

/** Disputas donde el usuario autenticado es el vendedor. */
export async function listarMisDisputasComoVendedor(): Promise<DisputaCitCompleto[]> {
  const data = await leer<{ disputas: DisputaCitCompleto[] }>(
    await authedFetch('/api/v1/disputas-cit-completo/mias')
  )
  return data.disputas
}

export const ESTADO_DISPUTA_LABEL: Record<DisputaCitCompleto['estado'], { label: string; clase: string }> = {
  ABIERTA: { label: 'Abierta', clase: 'bg-amber-100 text-amber-700' },
  RESUELTA_AMARILLO: { label: 'Advertencia registrada', clase: 'bg-amber-100 text-amber-700' },
  EN_REVISION_HUMANA: { label: 'En revisión — podés subir evidencia', clase: 'bg-clay/12 text-clay' },
  CONFIRMADA_NARANJA: { label: 'Confirmada en tu contra', clase: 'bg-clay/20 text-clay' },
  DESESTIMADA: { label: 'Desestimada', clase: 'bg-[#0a7d5a]/12 text-[#0a7d5a]' },
}
