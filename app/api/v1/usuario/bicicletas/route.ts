import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { listarGaraje } from '@/src/services/garaje.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/usuario/bicicletas — Garaje Digital del usuario autenticado:
 * rodados propios con su CIT más reciente y un resumen del garaje.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const data = await listarGaraje(user.id)
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return jsonError(error)
  }
}
