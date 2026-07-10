import { NextResponse } from 'next/server'
import { jsonError, requireStaff } from '@/lib/marketplace'
import { evaluarIndexacionPrecios } from '@/src/services/indexacion-pricing.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/pricing/evaluar-indexacion — corre un ciclo diario del
 * mecanismo de indexacion de precios al dolar oficial BNA. Pensado para
 * ejecutarse como tarea programada (x-admin-token) o desde el back-office
 * (rol admin).
 */
export async function POST(req: Request) {
  try {
    await requireStaff(req, 'admin')
    const resultado = await evaluarIndexacionPrecios()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
