import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAdmin } from '@/lib/marketplace'
import { COLAS, esColaValida, limpiarFallidos } from '@/src/services/queue.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/queue/limpiar/:cola — elimina los trabajos fallidos de la
 * cola indicada. Requiere x-admin-token.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ cola: string }> }
) {
  try {
    requireAdmin(req)
    const { cola } = await params
    if (!esColaValida(cola)) {
      throw new ApiError(
        400,
        'COLA_INVALIDA',
        `Cola desconocida. Colas validas: ${COLAS.join(', ')}.`
      )
    }
    const eliminados = await limpiarFallidos(cola)
    return NextResponse.json({ ok: true, data: { cola, eliminados } })
  } catch (error) {
    return jsonError(error)
  }
}
