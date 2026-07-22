import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { listarTalleresAprobados } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/aliados/publicos — Listado publico de Aliados aprobados (sin
 * geolocalizacion, MVP de "Reservar CIT" del Garaje Digital). Sin auth.
 */
export async function GET() {
  try {
    const talleres = await listarTalleresAprobados()
    return NextResponse.json({ talleres })
  } catch (error) {
    return jsonError(error)
  }
}
