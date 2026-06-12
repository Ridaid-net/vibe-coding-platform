import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { getMiTaller } from '@/src/services/roles.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/aliado/mi-taller — taller aliado del que el usuario autenticado es
 * propietario (rol ALIADO), con su conteo de inspectores activos.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const taller = await getMiTaller(user.id)
    return NextResponse.json({ ok: true, data: taller })
  } catch (error) {
    return jsonError(error)
  }
}
