import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { procesarAutoReleases } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/escrow/auto-release — barrido de auto-release.
 * Libera las transacciones EN_CAMINO sin confirmacion del comprador tras 5 dias.
 * Pensado para ejecutarse como tarea programada (requiere x-admin-token).
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await procesarAutoReleases()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
