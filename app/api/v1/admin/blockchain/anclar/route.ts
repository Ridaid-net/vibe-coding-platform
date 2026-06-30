import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { anclarPendientes } from '@/src/services/blockchain.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/blockchain/anclar — Reintento del anclaje en la BFA.
 *
 * Barre los CITs aprobados cuyo anclaje on-chain quedó pendiente (la red BFA
 * estaba caída o con latencia al aprobar) y reintenta mintear su NFT. Pensado
 * para una Netlify Scheduled Function (requiere x-admin-token). Best-effort e
 * idempotente: un CIT ya anclado no se vuelve a mintear.
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await anclarPendientes()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
