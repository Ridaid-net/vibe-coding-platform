import { NextResponse } from 'next/server'
import { jsonError, optionalText, requireUser } from '@/lib/marketplace'
import { cancelarTransaccion } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

interface Body {
  motivo?: unknown
}

/**
 * POST /api/v1/transacciones/:id/cancelar — cancela la transaccion y, si habia
 * fondos retenidos, emite el reembolso real contra MercadoPago.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Body

    const resultado = await cancelarTransaccion({
      transaccionId: id,
      actorId: user.id,
      motivo: optionalText(body.motivo),
    })

    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
