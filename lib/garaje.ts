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
  citId: string | null
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

/**
 * Descarga el Certificado Digital de Propiedad y Verificacion (PDF firmado) de
 * una bici verificada y dispara la descarga en el navegador.
 *
 * El endpoint esta protegido (Bearer), por eso se baja con `authedFetch` y se
 * abre como blob — un `<a href>` plano no adjuntaria el token de sesion.
 */
export async function descargarCertificado(b: BicicletaGaraje): Promise<void> {
  // El endpoint acepta el id del CIT o, en su defecto, el de la bici.
  const id = b.citId ?? b.id
  const res = await authedFetch(`/api/v1/cit/${encodeURIComponent(id)}/certificado`)
  if (!res.ok) {
    const detalle = await res.json().catch(() => null)
    throw new Error(
      (detalle && (detalle.message as string)) ??
        'No pudimos generar el certificado.'
    )
  }

  const blob = await res.blob()
  const numero =
    res.headers.get('x-rodaid-cert-numero') ??
    `RODAID-CERT-${b.numeroSerie}`
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `${numero}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
