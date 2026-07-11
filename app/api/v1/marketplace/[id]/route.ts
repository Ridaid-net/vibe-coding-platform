import { NextResponse } from 'next/server'
import {
  ApiError,
  getPool,
  jsonError,
  mapPublicacion,
  requireUser,
  type PublicacionRow,
} from '@/lib/marketplace'
import { obtenerMiReservaActiva } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/marketplace/:id — detalle de una publicacion.
 *
 * Devuelve la publicacion con los datos de la bicicleta asociada para la
 * pantalla de detalle/compra. Incrementa el contador de vistas (best-effort)
 * cuando la publicacion esta activa. Si el request trae una sesion valida,
 * ademas devuelve miReserva -- la reserva CIT Completo activa del viewer
 * sobre ESTA publicacion, si tiene una. Nunca se expone a otros viewers.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const pool = getPool()

    const res = await pool.query<PublicacionRow>(
      `
        SELECT
          mp.*,
          b.marca,
          b.modelo,
          b.anio,
          b.tipo,
          b.numero_serie,
          b.rodado,
          b.talle_cuadro
        FROM marketplace_publicaciones mp
        INNER JOIN bicicletas b ON b.id = mp.bicicleta_id
        WHERE mp.id = $1
      `,
      [id]
    )

    const row = res.rows[0]
    if (!row) {
      throw new ApiError(404, 'PUBLICACION_NOT_FOUND', 'La publicacion no existe.')
    }

    // Contador de vistas: no debe bloquear ni romper la respuesta.
    if (row.estado === 'ACTIVA') {
      pool
        .query(
          `UPDATE marketplace_publicaciones SET vistas = vistas + 1 WHERE id = $1`,
          [id]
        )
        .catch(() => undefined)
    }

    let miReserva = null
    try {
      const user = await requireUser(req)
      miReserva = await obtenerMiReservaActiva(id, user.id)
    } catch {
      // Sin sesion o token invalido: la publicacion sigue siendo publica.
    }

    return NextResponse.json({ publicacion: mapPublicacion(row), miReserva })
  } catch (error) {
    return jsonError(error)
  }
}
