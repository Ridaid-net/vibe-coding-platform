'use client'

import { authedFetch, ensureRoleSession } from '@/lib/session'
import type { ChecklistInspeccion } from '@/lib/puntos-inspeccion'

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
  modoVista: 'propio' | 'ver_como' | 'vista_previa'
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

export async function fetchContexto(
  verComoAliado?: string | null
): Promise<InspectorContextoCliente> {
  const qs = verComoAliado ? `?verComoAliado=${encodeURIComponent(verComoAliado)}` : ''
  return leer(await authedFetch(`/api/v1/inspecciones/contexto${qs}`))
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

export async function buscarBici(
  q: string,
  verComoAliado?: string | null
): Promise<BusquedaInspeccion> {
  const verComoQs = verComoAliado ? `&verComoAliado=${encodeURIComponent(verComoAliado)}` : ''
  return leer(
    await authedFetch(`/api/inspector/cit?q=${encodeURIComponent(q)}${verComoQs}`)
  )
}

/**
 * Certificado Digital de Propiedad y Verificacion (PDF firmado). El endpoint
 * (/api/v1/cit/:id/certificado) exige Authorization: Bearer -- un <a href>
 * comun nunca lo autentica, asi que se trae el blob con authedFetch y se
 * abre/descarga desde una URL de objeto temporal (mismo patron que
 * lib/remitos.ts::descargarRemitoPdf()).
 */
async function obtenerCertificadoBlob(citId: string): Promise<Blob> {
  const res = await authedFetch(`/api/v1/cit/${citId}/certificado`)
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(detalle?.message ?? `HTTP ${res.status}`)
  }
  return res.blob()
}

export async function abrirCertificadoCit(citId: string): Promise<void> {
  const blob = await obtenerCertificadoBlob(citId)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

export async function descargarCertificadoCit(
  citId: string,
  numeroSerie: string
): Promise<void> {
  const blob = await obtenerCertificadoBlob(citId)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `CIT-${numeroSerie}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
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
  marketplaceTransicion: {
    publicacionId: string
    estadoAnterior: string
    estadoNuevo: string
  } | null
}

/**
 * Aprueba la inspeccion fisica. Dos caminos, ambos vigentes:
 *   - Rapido (default, `checklist` ausente): solo veredicto + notas libres,
 *     mismo comportamiento exacto que existia antes del Checklist de 20
 *     puntos (mismo shape de JSON, mismo content-type) -- ningun taller que
 *     no use el checklist nota una diferencia.
 *   - Checklist completo ("CIT Completo Plus", `checklist` presente): manda
 *     multipart/form-data -- las fotos de componentes tokenizados viajan
 *     como archivos reales, nunca en base64 dentro del body -- mismo patron
 *     que `denuncia-mpf-modal.tsx` ya usa para el PDF de una denuncia.
 */
export async function aprobarInspeccion(
  citId: string,
  notas?: string,
  checklist?: ChecklistInspeccion | null,
  fotosPorPunto?: Record<string, File>
): Promise<AprobacionRespuesta> {
  if (checklist) {
    const form = new FormData()
    form.set('accion', 'aprobar')
    form.set('citId', citId)
    form.set('checklist', JSON.stringify(checklist))
    if (notas) form.set('notas', notas)
    for (const [puntoId, file] of Object.entries(fotosPorPunto ?? {})) {
      form.set(`foto_${puntoId}`, file)
    }
    return leer(
      await authedFetch('/api/inspector/cit', {
        method: 'POST',
        body: form,
      })
    )
  }
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

/**
 * Reporta una discrepancia. `checklist` es opcional -- se manda cuando el
 * rechazo se origina en el checklist completo de 20 puntos (URGENTE, fix
 * 2026-07-18: antes se perdía por completo al reportar discrepancia desde
 * ese flujo). Sin archivos en este camino a propósito -- ver
 * reportarDiscrepancia() en inspeccion.service.ts.
 */
export async function reportarDiscrepancia(
  citId: string,
  motivo: string,
  checklist?: ChecklistInspeccion | null
): Promise<DiscrepanciaRespuesta> {
  return leer(
    await authedFetch('/api/inspector/cit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accion: 'discrepancia',
        citId,
        motivo,
        checklist: checklist ? JSON.stringify(checklist) : undefined,
      }),
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
