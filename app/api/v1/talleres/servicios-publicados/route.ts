export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { obtenerServiciosPublicadosRanking } from '@/src/services/talleres-desempeno.service'

/**
 * GET /api/v1/talleres/servicios-publicados — lectura publica y ya ordenada
 * por desempeño, consumida por app/servicios/page.tsx. Fuera de
 * /api/v1/admin/* a proposito (ver nota en talleres-desempeno.service.ts /
 * servicio-publicado/route.ts).
 */
export async function GET() {
  try {
    const servicios = await obtenerServiciosPublicadosRanking()
    return NextResponse.json({ ok: true, servicios })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
