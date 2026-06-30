import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerUbicacionTiempoReal } from '@/src/services/iot.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/iot/bicicletas/[id]/telemetria — Ubicacion en Tiempo Real.
 *
 * Devuelve la posicion PRECISA (descifrada E2E) de la bici, SOLO para su
 * propietario y SOLO si la transmision esta activa. Si no hay sensor activo o no
 * es el dueño, responde `ubicacion: null` (la capa de tiempo real no se muestra).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser(req)
    const { id } = await params
    const ubicacion = await obtenerUbicacionTiempoReal(user.id, id)
    return NextResponse.json(
      { ubicacion },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
