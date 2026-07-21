import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, getPool, jsonError, mapPublicacion, requireUser, type PublicacionRow } from '@/lib/marketplace'
import { ESTADOS_PUBLICACION_SIN_OPERACION_VIVA } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/marketplace/:id/editar
 *
 * El vendedor edita el contenido de su propia publicacion (titulo,
 * descripcion, precio) -- alcance confirmado con Federico: sin fotos por
 * ahora, eso queda para una pasada aparte.
 *
 * Mismo gate de estados que retirarPublicacion() (ESTADOS_PUBLICACION_
 * SIN_OPERACION_VIVA, exportado de escrow.service.ts para no duplicar la
 * lista) -- si hay un comprador comprometido con plata en juego, tampoco
 * tiene sentido dejar cambiar el precio o la descripcion de lo que esta
 * comprando. No toca `bicicletas` ni `cits`, ni el slug (que se deriva de
 * marca/modelo/anio/bicicleta_id, no del titulo de la publicacion).
 */

const editarSchema = z.object({
  titulo: z
    .string({ required_error: 'titulo es obligatorio.' })
    .trim()
    .min(5, 'El titulo debe tener al menos 5 caracteres.')
    .max(120, 'El titulo no puede superar 120 caracteres.'),
  descripcion: z
    .string({ required_error: 'descripcion es obligatoria.' })
    .trim()
    .min(20, 'La descripcion debe tener al menos 20 caracteres.')
    .max(5000, 'La descripcion no puede superar 5000 caracteres.'),
  precioARS: z
    .number({
      required_error: 'precio_ars es obligatorio.',
      invalid_type_error: 'precio_ars debe ser un numero.',
    })
    .positive('precio_ars debe ser mayor a cero.')
    .max(1_000_000_000, 'precio_ars excede el maximo permitido.'),
  precioUSD: z
    .number({ invalid_type_error: 'precio_usd debe ser un numero.' })
    .positive('precio_usd debe ser mayor a cero.')
    .max(100_000_000, 'precio_usd excede el maximo permitido.')
    .nullable()
    .optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const pool = getPool()
  const client = await pool.connect()

  try {
    const { id } = await params
    const [user, body] = await Promise.all([requireUser(req), req.json()])

    const result = editarSchema.safeParse({
      titulo: body?.titulo,
      descripcion: body?.descripcion,
      precioARS: body?.precioARS ?? body?.precio_ars,
      precioUSD: body?.precioUSD ?? body?.precio_usd,
    })
    if (!result.success) {
      const issue = result.error.issues[0]
      throw new ApiError(400, 'VALIDATION_ERROR', issue?.message ?? 'Datos invalidos.')
    }
    const data = result.data

    await client.query('BEGIN')

    const pubResult = await client.query<{ id: string; vendedor_id: string; estado: string }>(
      `SELECT id, vendedor_id, estado FROM marketplace_publicaciones WHERE id = $1 FOR UPDATE`,
      [id]
    )
    const pub = pubResult.rows[0]
    if (!pub) {
      throw new ApiError(404, 'PUBLICACION_NOT_FOUND', 'La publicacion no existe.')
    }
    if (pub.vendedor_id !== user.id) {
      throw new ApiError(403, 'NOT_OWNER', 'No sos el vendedor de esta publicacion.')
    }
    if (!ESTADOS_PUBLICACION_SIN_OPERACION_VIVA.has(pub.estado)) {
      throw new ApiError(
        409,
        'PUBLICACION_NO_EDITABLE',
        'Esta publicacion tiene una operacion en curso (seña o pago de un comprador) y no se puede editar.'
      )
    }

    const updated = await client.query<PublicacionRow>(
      `
        UPDATE marketplace_publicaciones
        SET titulo = $2, descripcion = $3, precio_ars = $4, precio_usd = $5
        WHERE id = $1
        RETURNING *
      `,
      [pub.id, data.titulo, data.descripcion, data.precioARS, data.precioUSD ?? null]
    )

    await client.query('COMMIT')

    return NextResponse.json({ publicacion: mapPublicacion(updated.rows[0]) })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return jsonError(error)
  } finally {
    client.release()
  }
}
