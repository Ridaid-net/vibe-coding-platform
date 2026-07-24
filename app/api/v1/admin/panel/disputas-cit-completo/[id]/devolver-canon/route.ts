import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { requireAdminPanel, devolverCanonDisputaCit } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/panel/disputas-cit-completo/:id/devolver-canon —
 * devuelve el canon retenido al comprador. Siempre una acción manual del
 * admin (confirmado 2026-07-24) -- ninguna resolución de la disputa la
 * dispara sola. Solo `moderacion:accion` (superadmin/soporte).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdminPanel(req, 'moderacion:accion')
    const { id } = await params
    const resultado = await devolverCanonDisputaCit(ctx, id)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
