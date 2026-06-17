import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireUser } from '@/lib/marketplace'
import {
  crearPagoTasaCit,
  getModoPagosMxm,
  listarTasasDeUsuario,
} from '@/src/services/tasa-cit.service'

export const runtime = 'nodejs'

/**
 * POST /api/mxm/pagos — inicia el pago de la Tasa CIT oficial por el canal del
 * Gobierno (Mendoza por Mi, pasarela estatal). Devuelve la tasa creada
 * (PENDIENTE) con la URL de checkout. La confirmacion del pago llega de forma
 * ASINCRONA por el webhook de la pasarela (POST /api/mxm/pagos/webhook).
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as {
      citId?: unknown
      bicicletaId?: unknown
      externalUid?: unknown
    }

    const citId = optionalText(body.citId)
    const bicicletaId = optionalText(body.bicicletaId)
    if (!citId && !bicicletaId) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Indica el CIT o la bicicleta a la que corresponde la tasa.'
      )
    }

    const resultado = await crearPagoTasaCit({
      solicitanteId: user.id,
      citId,
      bicicletaId,
      externalUid: optionalText(body.externalUid),
    })

    return NextResponse.json(resultado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}

/** GET /api/mxm/pagos — lista las tasas iniciadas por el usuario autenticado. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const tasas = await listarTasasDeUsuario(user.id)
    return NextResponse.json({ modo: getModoPagosMxm(), tasas })
  } catch (error) {
    return jsonError(error)
  }
}
