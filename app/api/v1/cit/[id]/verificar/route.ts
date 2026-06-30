import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { verificarIntegridad } from '@/src/services/cit.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/cit/:id/verificar — verificacion publica de integridad.
 * Recalcula la huella desde el snapshot sellado y revalida la firma HMAC,
 * detectando cualquier alteracion de los datos certificados.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const resultado = await verificarIntegridad(id)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
