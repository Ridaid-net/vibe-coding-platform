import { NextResponse } from 'next/server'
import {
  ApiError,
  getPool,
  jsonError,
  mapPublicacion,
  type PublicacionRow,
} from '@/lib/marketplace'

export const runtime = 'nodejs'

/**
 * GET /api/v1/marketplace/:id — detalle de una publicacion.
 *
 * Devuelve la publicacion con los datos de la bicicleta asociada para la
 * pantalla de detalle/compra. Incrementa el contador de vistas (best-effort)
 * cuando la publicacion esta activa.
 */
export async function GET(
  _req: Request,
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

    return NextResponse.json({ publicacion: mapPublicacion(row) })
  } catch (error) {
    return jsonError(error)
  }
}
