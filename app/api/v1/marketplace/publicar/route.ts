import { NextResponse } from 'next/server'
import {
  ApiError,
  getPool,
  jsonError,
  mapPublicacion,
  parsePositiveNumber,
  parseText,
  requireUser,
  slugify,
  type PublicacionRow,
} from '@/lib/marketplace'

interface PublicarBody {
  citId?: unknown
  cit_id?: unknown
  titulo?: unknown
  descripcion?: unknown
  precioARS?: unknown
  precio_ars?: unknown
  precioUSD?: unknown
  precio_usd?: unknown
  fotosUrls?: unknown
  fotos_urls?: unknown
}

export async function POST(req: Request) {
  const pool = getPool()
  const client = await pool.connect()

  try {
    const [user, body] = await Promise.all([
      requireUser(req),
      req.json() as Promise<PublicarBody>,
    ])

    const citId = parseText(body.citId ?? body.cit_id, 'cit_id')
    const titulo = parseText(body.titulo, 'titulo', 120)
    const descripcion = parseText(body.descripcion, 'descripcion')
    const precioARS = parsePositiveNumber(
      body.precioARS ?? body.precio_ars,
      'precio_ars'
    )
    const precioUSD = parsePositiveNumber(
      body.precioUSD ?? body.precio_usd,
      'precio_usd',
      false
    )
    const fotosInput = body.fotosUrls ?? body.fotos_urls ?? []
    const fotosUrls = Array.isArray(fotosInput)
      ? fotosInput.filter((url): url is string => typeof url === 'string')
      : []

    await client.query('BEGIN')

    const citResult = await client.query<{
      cit_id: string
      cit_estado: string
      fecha_vencimiento: string
      bicicleta_id: string
      propietario_id: string
      marca: string
      modelo: string
      anio: number | null
    }>(
      `
        SELECT
          c.id AS cit_id,
          c.estado AS cit_estado,
          c.fecha_vencimiento,
          b.id AS bicicleta_id,
          b.propietario_id,
          b.marca,
          b.modelo,
          b.anio
        FROM cits c
        INNER JOIN bicicletas b ON b.id = c.bicicleta_id
        WHERE c.id = $1
        FOR UPDATE
      `,
      [citId]
    )

    const cit = citResult.rows[0]
    if (!cit) {
      throw new ApiError(404, 'CIT_NOT_FOUND', 'El CIT indicado no existe.')
    }
    if (cit.propietario_id !== user.id) {
      throw new ApiError(
        403,
        'NOT_OWNER',
        'El vendedor no es el propietario del rodado.'
      )
    }
    if (cit.cit_estado !== 'activo') {
      throw new ApiError(422, 'CIT_NOT_ACTIVE', 'El CIT no esta activo.')
    }
    if (new Date(cit.fecha_vencimiento).getTime() <= Date.now()) {
      throw new ApiError(422, 'CIT_EXPIRED', 'El CIT se encuentra vencido.')
    }

    const duplicateResult = await client.query(
      `
        SELECT 1
        FROM marketplace_publicaciones
        WHERE cit_id = $1
          AND estado IN ('ACTIVA', 'PAUSADA')
        LIMIT 1
      `,
      [citId]
    )
    if (duplicateResult.rowCount) {
      throw new ApiError(
        409,
        'DUPLICATE_LISTING',
        'Ya existe una publicacion activa o pausada para este CIT.'
      )
    }

    const slugBase = slugify([cit.marca, cit.modelo, cit.anio])
    const slug = `${slugBase}-${cit.bicicleta_id.slice(0, 6)}`

    const insertResult = await client.query<PublicacionRow>(
      `
        INSERT INTO marketplace_publicaciones (
          cit_id,
          bicicleta_id,
          vendedor_id,
          titulo,
          descripcion,
          precio_ars,
          precio_usd,
          fotos_urls,
          slug
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [
        citId,
        cit.bicicleta_id,
        user.id,
        titulo,
        descripcion,
        precioARS,
        precioUSD,
        fotosUrls,
        slug,
      ]
    )

    await client.query('COMMIT')

    return NextResponse.json(
      { publicacion: mapPublicacion(insertResult.rows[0]) },
      { status: 201 }
    )
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return jsonError(error)
  } finally {
    client.release()
  }
}
