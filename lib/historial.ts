'use client'

/**
 * Cliente del Historial Clinico publico (compartir del Garaje Digital).
 *
 * Tipos y fetcher para el endpoint abierto `GET /api/v1/historial/:token`
 * (sin autenticacion) -- mismo espiritu que `lib/verificar.ts` para el
 * Verificador Publico.
 */

export type VeredictoEstado =
  | 'SEGURO'
  | 'ROBADA'
  | 'EN_VALIDACION'
  | 'SIN_VERIFICAR'
  | 'NO_ENCONTRADA'

export type VeredictoColor = 'verde' | 'rojo' | 'amarillo' | 'gris'

export interface VerdictoBfa {
  coincide: boolean
  estado: string
  txHash: string | null
  tokenId: string | null
  modo: string
  ancladoEn: string | null
}

export interface VerificacionVeredicto {
  estado: VeredictoEstado
  color: VeredictoColor
  encontrada: boolean
  titulo: string
  mensaje: string
  bicicleta?: {
    marca: string
    modelo: string
    tipo: string
    anio: number | null
    color: string | null
    numeroSerie: string
  }
  codigoCit?: string | null
  bfa?: VerdictoBfa
  alertaRobo?: { mensaje: string; contacto: string }
}

export interface BiciSaludItemPublico {
  tipo: string
  severidad: string
  titulo: string
  mensaje: string
  creadoEn: string
}

export interface InspeccionesResumenPublico {
  total: number
  fechas: string[]
  tallerNombre: string | null
}

export interface HistorialPublico {
  encontrada: boolean
  veredicto: VerificacionVeredicto
  cit?: { fechaEmision: string | null }
  scoreConfianza?: { total: number; badge: 'oro' | 'bronce' | null }
  biciSalud?: BiciSaludItemPublico[]
  inspecciones?: InspeccionesResumenPublico
}

export interface HistorialError {
  error: string
  message: string
  retryAfter?: number
}

export type HistorialRespuesta =
  | { ok: true; historial: HistorialPublico }
  | { ok: false; status: number; error: HistorialError }

/** Consulta el Historial Clinico publico de una bici. No requiere sesion. */
export async function consultarHistorialPublico(
  token: string,
  signal?: AbortSignal
): Promise<HistorialRespuesta> {
  const res = await fetch(`/api/v1/historial/${encodeURIComponent(token)}`, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (res.ok) {
    const historial = (await res.json()) as HistorialPublico
    return { ok: true, historial }
  }
  const error = (await res.json().catch(() => ({
    error: 'ERROR',
    message: 'No pudimos cargar este historial.',
  }))) as HistorialError
  return { ok: false, status: res.status, error }
}
