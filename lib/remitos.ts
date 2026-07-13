'use client'

import useSWR from 'swr'
import { authedFetch } from '@/lib/session'

/**
 * Cliente del Remito de Embalaje y Despacho (Fase 6b, CIT Completo). Habla con
 * `/api/v1/transacciones/:id/remito/generar`, `/api/v1/remitos/:numero/despachar`
 * y `/api/v1/remitos/:numero/pdf` — usados desde el Garaje Digital del
 * vendedor (generar), el Panel de Taller Aliado (despachar/listar) y la
 * descarga del PDF (ambos lados).
 */

export interface RemitoMapeado {
  id: string
  numero: string
  transaccionId: string
  aliadoId: string
  vendedorId: string
  estado: 'GENERADO' | 'DESPACHADO'
  pdfDocumentoHash: string
  generadoEn: string
  despachadoEn: string | null
  firmadoPor: string | null
  firmaWallet: string | null
  firmaAlgoritmo: string | null
  firmaModo: string | null
}

export interface RemitoListado extends RemitoMapeado {
  bici: { marca: string; modelo: string; numeroSerie: string }
  codigoCit: string
}

async function leer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

/** El vendedor genera el Remito de una venta de CIT Completo con el saldo ya confirmado. */
export async function generarRemito(transaccionId: string): Promise<{ remito: RemitoMapeado }> {
  return leer(
    await authedFetch(`/api/v1/transacciones/${transaccionId}/remito/generar`, {
      method: 'POST',
    })
  )
}

/** El Taller confirma que embalo y despacho, firmado con su wallet. */
export async function despacharRemito(
  numero: string
): Promise<{ remito: RemitoMapeado; transaccionId: string; compradorId: string }> {
  return leer(
    await authedFetch(`/api/v1/remitos/${encodeURIComponent(numero)}/despachar`, {
      method: 'POST',
    })
  )
}

/**
 * Descarga el PDF del remito. El endpoint exige Authorization: Bearer (igual
 * que el resto de la API), asi que un <a href> comun no autenticaria -- se
 * trae el blob autenticado y se dispara la descarga desde un link temporal.
 */
export async function descargarRemitoPdf(numero: string): Promise<void> {
  const res = await authedFetch(`/api/v1/remitos/${encodeURIComponent(numero)}/pdf`)
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${numero}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface RemitosTallerResponse {
  remitos: RemitoListado[]
  modoVista: 'propio' | 'ver_como' | 'vista_previa'
}

async function fetchRemitosTaller(url: string): Promise<RemitosTallerResponse> {
  return leer(await authedFetch(url))
}

/** Remitos del Taller Aliado logueado (o del aliado elegido en Admin View-As). */
export function useRemitosTaller(verComoAliado?: string | null) {
  const qs = verComoAliado ? `?verComoAliado=${encodeURIComponent(verComoAliado)}` : ''
  return useSWR<RemitosTallerResponse>(
    `/api/v1/talleres/remitos${qs}`,
    fetchRemitosTaller,
    { revalidateOnFocus: true, keepPreviousData: true }
  )
}
