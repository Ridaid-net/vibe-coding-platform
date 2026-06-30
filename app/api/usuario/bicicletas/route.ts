import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerActivosUsuario } from '@/src/services/garaje.service'

export const runtime = 'nodejs'

/**
 * GET /api/usuario/bicicletas — Hito 14: Garaje Digital.
 *
 * Devuelve el estado CONSOLIDADO de cada rodado del usuario autenticado: CIT,
 * huella SHA-256 anclada en la BFA, estado de verificacion, estado en vivo del
 * pipeline de 72hs y las actas de inspeccion firmadas. Es la fuente del dashboard
 * y del polling de tiempo real (la UI se refresca cuando el CIT pasa a APROBADO o
 * BLOQUEADO).
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const activos = await obtenerActivosUsuario(user.id)
    return NextResponse.json(
      {
        activos,
        // Atajo: si hay algun activo todavia en el pipeline, el cliente sabe que
        // debe seguir refrescando (polling).
        hayPendientes: activos.some((a) => a.estado === 'pendiente'),
      },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
