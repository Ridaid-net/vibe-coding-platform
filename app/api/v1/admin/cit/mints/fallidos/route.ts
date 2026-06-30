import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { listarAcunacionesFallidas } from '@/src/services/cit.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/cit/mints/fallidos — certificados ACTIVOS cuya acunacion del
 * NFT en BFA no quedo confirmada. Endpoint de sistema (requiere x-admin-token).
 *
 *   por defecto      -> solo FALLIDO (error fatal; necesita re-acunacion manual).
 *   ?transitorios=1  -> incluye tambien ERROR (transitorio; lo reintenta el barrido).
 *
 * La re-acunacion se dispara con POST /api/v1/cit/:id/acunar (sin txHash).
 */
export async function GET(req: Request) {
  try {
    requireAdmin(req)
    const url = new URL(req.url)
    const incluirTransitorios =
      url.searchParams.get('transitorios') === '1' ||
      url.searchParams.get('transitorios') === 'true'
    const items = await listarAcunacionesFallidas({ incluirTransitorios })
    return NextResponse.json({ total: items.length, items })
  } catch (error) {
    return jsonError(error)
  }
}
