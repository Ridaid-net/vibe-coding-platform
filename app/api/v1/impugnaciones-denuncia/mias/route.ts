import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { listarImpugnacionesPorUsuario } from '@/src/services/impugnaciones-denuncia.service'

export const runtime = 'nodejs'

/** GET /api/v1/impugnaciones-denuncia/mias — impugnaciones que inicié. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const impugnaciones = await listarImpugnacionesPorUsuario(user.id)
    return NextResponse.json({ impugnaciones })
  } catch (error) {
    return jsonError(error)
  }
}
