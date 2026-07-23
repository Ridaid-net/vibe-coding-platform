import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { requireAdminPanel } from '@/lib/admin-panel'
import { confirmarPagoDeudaTaller } from '@/src/services/disputas-cit-completo.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/panel/disputas-cit-completo/deudas-taller/:id/confirmar
 * — confirma a mano el cobro de una deuda de Taller Aliado (Esquema 2,
 * parte (a)). Mismo criterio que la deuda de vendedor: cobro real fuera del
 * sistema, confirmación manual de un empleado de cuentas. Solo `finanzas:accion`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminPanel(req, 'finanzas:accion')
    const { id } = await params
    await confirmarPagoDeudaTaller(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
