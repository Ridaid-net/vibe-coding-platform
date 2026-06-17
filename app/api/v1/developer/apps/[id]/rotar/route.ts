import { NextResponse } from 'next/server'
import { jsonError, requireAuth } from '@/lib/marketplace'
import { rotarCredenciales } from '@/src/services/developer.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/developer/apps/[id]/rotar — Rota el client_secret y la API Key.
 *
 * Devuelve los nuevos secretos EN CLARO una sola vez y revoca los access tokens
 * vivos de la app (las credenciales anteriores dejan de servir de inmediato).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { id } = await params
    const resultado = await rotarCredenciales(id, user.id)
    return NextResponse.json(resultado, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return jsonError(error)
  }
}
