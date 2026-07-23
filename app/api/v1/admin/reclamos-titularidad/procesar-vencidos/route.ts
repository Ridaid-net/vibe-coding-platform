import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { procesarReclamosVencidos } from '@/src/services/reclamos-titularidad.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/reclamos-titularidad/procesar-vencidos — barrido de
 * reclamos de titularidad sin respuesta del dueño en 48hs: corre el cruce
 * contra la base de robadas del Ministerio (clasificarNivelCIT()) y pasa a
 * EN_REVISION_HUMANA. Pensado para ejecutarse como tarea programada
 * (requiere x-admin-token).
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await procesarReclamosVencidos()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
