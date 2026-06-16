'use client'

/**
 * Cliente del Verificador Publico (Hito 7).
 *
 * Tipos del veredicto y helpers para consultar el endpoint abierto
 * `GET /api/v1/verificar/:serial` (sin autenticacion) y para extraer el termino
 * util de un QR del sticker CIT (que puede ser una URL o un texto plano).
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
  tipoBusqueda: 'serial' | 'cit'
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

export interface VerificacionError {
  error: string
  message: string
  retryAfter?: number
}

export type VerificacionRespuesta =
  | { ok: true; veredicto: VerificacionVeredicto }
  | { ok: false; status: number; error: VerificacionError }

/** Normaliza el termino igual que el backend (mayusculas, sin espacios). */
export function normalizarTermino(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

/**
 * Extrae el termino util de un QR escaneado. Algunos stickers codifican una URL
 * (.../verificar/SERIAL); otros, el serial o el codigo CIT en texto plano.
 */
export function extraerTerminoDeQR(texto: string): string {
  const limpio = texto.trim()
  try {
    const url = new URL(limpio)
    const segmentos = url.pathname.split('/').filter(Boolean)
    const ultimo = segmentos[segmentos.length - 1]
    if (ultimo) return decodeURIComponent(ultimo)
    const q = url.searchParams.get('serial') ?? url.searchParams.get('q')
    if (q) return q
  } catch {
    // No es una URL.
  }
  return limpio
}

/** Consulta el verificador publico. No requiere sesion. */
export async function verificarSerial(
  termino: string,
  signal?: AbortSignal
): Promise<VerificacionRespuesta> {
  const limpio = normalizarTermino(termino)
  const res = await fetch(`/api/v1/verificar/${encodeURIComponent(limpio)}`, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (res.ok) {
    const veredicto = (await res.json()) as VerificacionVeredicto
    return { ok: true, veredicto }
  }
  const error = (await res.json().catch(() => ({
    error: 'ERROR',
    message: 'No pudimos completar la verificacion.',
  }))) as VerificacionError
  return { ok: false, status: res.status, error }
}
