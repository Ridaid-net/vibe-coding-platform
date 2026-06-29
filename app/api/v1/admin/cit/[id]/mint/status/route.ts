import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { obtenerEstadoMint } from '@/src/services/cit.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/cit/:id/mint/status — estado de la acunacion del NFT en BFA de un
 * certificado (mint_estado, intentos, ultimo error, token y transaccion). Endpoint de
 * sistema (requiere x-admin-token). Mapea la consigna GET /admin/cit/:id/mint/status.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    requireAdmin(req)
    const estado = await obtenerEstadoMint(id)
    return NextResponse.json(estado)
  } catch (error) {
    return jsonError(error)
  }
}
