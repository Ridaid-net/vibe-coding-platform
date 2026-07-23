import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { listarDisputasComoVendedor } from '@/src/services/disputas-cit-completo.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/disputas-cit-completo/mias — disputas donde el usuario
 * autenticado es el vendedor (Esquema 1 Caso B), para que pueda ver el
 * estado y subir contra-evidencia mientras el caso sigue abierto.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    return NextResponse.json({ disputas: await listarDisputasComoVendedor(user.id) })
  } catch (error) {
    return jsonError(error)
  }
}
