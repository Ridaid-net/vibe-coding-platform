import { NextResponse } from 'next/server'
import { jsonError, requireStaff } from '@/lib/marketplace'
import { listarLiquidacionesListasParaPago } from '@/src/services/compensaciones.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/pagos/liquidaciones — Cola de Pagos: liquidaciones
 * LISTA_PARA_PAGO con su destino ya congelado (cbu_destino/alias_destino/
 * titular_destino), para que un empleado de cuentas ejecute la transferencia
 * real por fuera del sistema. Admin-only: es una operación interna de
 * finanzas, no algo que un aliado deba ver sobre otros beneficiarios.
 */
export async function GET(req: Request) {
  try {
    await requireStaff(req, 'admin')
    const liquidaciones = await listarLiquidacionesListasParaPago()
    return NextResponse.json({ liquidaciones })
  } catch (error) {
    return jsonError(error)
  }
}
