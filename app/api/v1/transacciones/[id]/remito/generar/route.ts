import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { generarRemito } from '@/src/services/remito.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/transacciones/:id/remito/generar — el VENDEDOR dispara la
 * orden de trabajo de embalaje hacia el Taller Aliado (Fase 6b, CIT Completo).
 * Accion explicita: sin este POST el Taller no tiene forma de enterarse de
 * que debe embalar la bici. generarRemito() valida ownership (solo el
 * vendedor de esta venta), que sea CIT Completo (aliado_id) y que el saldo
 * ya este confirmado (FONDOS_RETENIDOS).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const { remito } = await generarRemito({ transaccionId: id, vendedorId: user.id })

    // TODO(siguiente pieza): notificar al Taller (in-app + email con el PDF)
    // -- requiere notif_tipo REMITO_GENERADO, deployado por separado
    // (20260712000002_notif_tipo_remitos.sql).

    return NextResponse.json({ remito })
  } catch (error) {
    return jsonError(error)
  }
}
