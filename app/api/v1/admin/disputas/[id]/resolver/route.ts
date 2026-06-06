import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireAdmin } from '@/lib/marketplace'
import { resolverDisputa } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

interface Body {
  aFavor?: unknown
  a_favor?: unknown
  nota?: unknown
}

/**
 * POST /api/v1/admin/disputas/:id/resolver — resolucion administrativa.
 * A favor del VENDEDOR libera los fondos; a favor del COMPRADOR reembolsa.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as Body

    const aFavorRaw = optionalText(body.aFavor ?? body.a_favor)?.toUpperCase()
    if (aFavorRaw !== 'COMPRADOR' && aFavorRaw !== 'VENDEDOR') {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'aFavor debe ser COMPRADOR o VENDEDOR.'
      )
    }

    const resultado = await resolverDisputa({
      transaccionId: id,
      adminId: admin.id,
      aFavor: aFavorRaw,
      nota: optionalText(body.nota),
    })

    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
