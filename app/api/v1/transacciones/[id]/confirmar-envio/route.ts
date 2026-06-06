import { NextResponse } from 'next/server'
import { jsonError, optionalText, requireUser } from '@/lib/marketplace'
import { confirmarEnvio } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

interface Body {
  trackingCode?: unknown
  tracking_code?: unknown
}

/** POST /api/v1/transacciones/:id/confirmar-envio — el vendedor marca EN_CAMINO. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Body

    const transaccion = await confirmarEnvio({
      transaccionId: id,
      vendedorId: user.id,
      trackingCode: optionalText(body.trackingCode ?? body.tracking_code),
    })

    return NextResponse.json({ transaccion })
  } catch (error) {
    return jsonError(error)
  }
}
