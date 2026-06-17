import { NextResponse } from 'next/server'
import { jsonError, requireStaff } from '@/lib/marketplace'
import { procesarLiquidacionesPendientes } from '@/src/services/compensaciones.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/pagos/liquidar — barrido de transferencias pendientes.
 *
 * Ejecuta las liquidaciones PENDIENTE (pagos al vendedor + retribuciones a
 * aliados). Si la transferencia a un vendedor falla, su escrow vuelve a DISPUTADA
 * para revision humana. Pensado para ejecutarse como tarea programada o desde el
 * back-office (requiere x-admin-token o rol admin).
 */
export async function POST(req: Request) {
  try {
    await requireStaff(req, 'admin')
    const resultado = await procesarLiquidacionesPendientes()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
