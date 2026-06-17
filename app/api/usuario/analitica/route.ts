import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerAnaliticaPersonal } from '@/src/services/garaje.service'

export const runtime = 'nodejs'

/**
 * GET /api/usuario/analitica — Hito 14: Garaje Digital.
 *
 * Analitica PERSONAL del usuario: metricas de mantenimiento/uso de sus bicis y el
 * mapa de calor personal (donde fueron verificadas/auditadas), recortado a barrio
 * y agregado con k-anonimato. Nunca expone una coordenada exacta: la privacidad
 * del domicilio y las rutas del usuario es innegociable.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const analitica = await obtenerAnaliticaPersonal(user.id)
    return NextResponse.json(analitica, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
