import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { reclamarNft } from '@/src/services/nft.transfer.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/cit/:id/reclamar-nft — el comprador reclama el NFT que RODAID
 * mantiene en custodia (entrega custodial). Requiere una direccion EVM vinculada
 * al usuario; reencola la transferencia on-chain contra la BFA y devuelve el
 * estado resultante.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)

    const resultado = await reclamarNft({ citId: id, usuarioId: user.id })

    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
