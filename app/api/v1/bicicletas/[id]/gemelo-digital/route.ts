import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerGemeloDigital } from '@/src/services/gemelo-digital.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/bicicletas/[id]/gemelo-digital — Gemelo Digital Interactivo
 * (puntos de calor). Requiere sesion y ser el propietario de la bici
 * (verificado dentro del servicio).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const gemelo = await obtenerGemeloDigital(id, user.id)
    return NextResponse.json(gemelo)
  } catch (error) {
    return jsonError(error)
  }
}
