import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { procesarReintentosNft } from '@/src/services/nft.transfer.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/nft/reintentos — barrido de reintentos de la cola de
 * transferencias de NFT. Reprocesa las transferencias cuyo backoff vencio y las
 * que quedaron colgadas. Pensado como tarea programada (requiere x-admin-token).
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await procesarReintentosNft()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
