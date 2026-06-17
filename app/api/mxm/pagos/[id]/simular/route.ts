import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { getPagoTasa, simularPagoTasa } from '@/src/services/tasa-cit.service'

export const runtime = 'nodejs'

/**
 * POST /api/mxm/pagos/:id/simular — simula la confirmacion de la pasarela estatal
 * para una tasa (solo fuera de modo LIVE). Permite ejercitar el flujo de
 * confirmacion asincrona de punta a punta en los entornos de preview.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)

    const tasa = await getPagoTasa(id)
    if (!tasa) {
      throw new ApiError(404, 'TASA_NOT_FOUND', 'No encontramos la tasa indicada.')
    }
    if (tasa.solicitanteId && tasa.solicitanteId !== user.id) {
      throw new ApiError(403, 'NOT_OWNER', 'Esta tasa no te pertenece.')
    }
    if (!tasa.referenciaExterna) {
      throw new ApiError(409, 'SIN_REFERENCIA', 'La tasa no tiene una referencia de pasarela.')
    }

    const resultado = await simularPagoTasa(tasa.referenciaExterna)
    return NextResponse.json({ resultado, tasa: await getPagoTasa(id) })
  } catch (error) {
    return jsonError(error)
  }
}
