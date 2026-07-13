import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  ApiError,
  getPool,
  jsonError,
  mapPublicacion,
  requireUser,
  slugify,
  type PublicacionRow,
} from '@/lib/marketplace'
import { StorageError, subirFotoBicicleta } from '@/src/services/storage.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/marketplace/publicar — Flujo de publicacion (Hito 2).
 *
 * Reglas de negocio:
 *  1. El usuario autenticado (req.user via JWT) debe ser el propietario de la
 *     `bicicleta_id`.
 *  2. La bicicleta debe tener un CIT con estado 'activo' (identidad verificada).
 *     Si no, se responde 403.
 *  3. Se registra la publicacion en `marketplace_publicaciones`.
 *
 * Acepta `application/json` o `multipart/form-data`. En multipart puede incluir
 * un archivo `foto` que se sube a Netlify Blobs; su URL publica se guarda en
 * `bicicletas.foto_url` y se usa como primera foto de la publicacion.
 */

// Zod valida el formato esperado antes de tocar la base: precio positivo y con
// tope, descripcion y titulo dentro de longitudes razonables.
const publicarSchema = z.object({
  bicicletaId: z
    .string({ required_error: 'bicicleta_id es obligatorio.' })
    .uuid('bicicleta_id debe ser un UUID valido.'),
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
  fotosUrls: z
    .array(z.string().url('Cada foto debe ser una URL valida.'))
    .max(12, 'No se pueden adjuntar mas de 12 fotos.')
    .optional(),
})

type PublicarData = z.infer<typeof publicarSchema>

/** Convierte un valor de formulario/JSON a numero, o `undefined` si esta vacio. */
function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isNaN(parsed) ? (value as number) : parsed
}

/** Normaliza la lista de URLs de fotos venga como array (JSON) o repetida (form). */
function toUrlList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const arr = Array.isArray(value) ? value : [value]
  const urls = arr.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  )
  return urls.length > 0 ? urls : undefined
}

interface ParsedRequest {
  data: PublicarData
  foto: File | null
}

/** Lee el cuerpo (JSON o multipart), normaliza y valida con Zod. */
async function parseRequest(req: Request): Promise<ParsedRequest> {
  const contentType = req.headers.get('content-type') ?? ''
  let raw: Record<string, unknown>
  let foto: File | null = null

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const fotoEntry = form.get('foto')
    foto = fotoEntry instanceof File && fotoEntry.size > 0 ? fotoEntry : null
    raw = {
      bicicletaId: form.get('bicicletaId') ?? form.get('bicicleta_id') ?? undefined,
      titulo: form.get('titulo') ?? undefined,
      descripcion: form.get('descripcion') ?? undefined,
      precioARS: toNumberOrUndefined(form.get('precioARS') ?? form.get('precio_ars')),
      precioUSD: toNumberOrUndefined(form.get('precioUSD') ?? form.get('precio_usd')),
      fotosUrls: toUrlList(
        form.getAll('fotosUrls').length
          ? form.getAll('fotosUrls')
          : form.getAll('fotos_urls')
      ),
    }
  } else {
    const body = (await req.json().catch(() => {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON valido.')
    })) as Record<string, unknown>
    raw = {
      bicicletaId: body.bicicletaId ?? body.bicicleta_id,
      titulo: body.titulo,
      descripcion: body.descripcion,
      precioARS: toNumberOrUndefined(body.precioARS ?? body.precio_ars),
      precioUSD: toNumberOrUndefined(body.precioUSD ?? body.precio_usd),
      fotosUrls: toUrlList(body.fotosUrls ?? body.fotos_urls),
    }
  }

  const result = publicarSchema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new ApiError(400, 'VALIDATION_ERROR', issue?.message ?? 'Datos invalidos.')
  }

  return { data: result.data, foto }
}

export async function POST(req: Request) {
  const pool = getPool()
  const client = await pool.connect()

  try {
    const [user, { data, foto }] = await Promise.all([
      requireUser(req),
      parseRequest(req),
    ])

    await client.query('BEGIN')

    // 1. La bicicleta debe existir y pertenecer al usuario autenticado.
    const biciResult = await client.query<{
      id: string
      propietario_id: string
      marca: string
      modelo: string
      anio: number | null
      foto_url: string | null
    }>(
      `
        SELECT id, propietario_id, marca, modelo, anio, foto_url
        FROM bicicletas
        WHERE id = $1
        FOR UPDATE
      `,
      [data.bicicletaId]
    )

    const bici = biciResult.rows[0]
    if (!bici) {
      throw new ApiError(
        404,
        'BICICLETA_NOT_FOUND',
        'La bicicleta indicada no existe.'
      )
    }
    if (bici.propietario_id !== user.id) {
      throw new ApiError(
        403,
        'NOT_OWNER',
        'No sos el propietario de esta bicicleta.'
      )
    }

    // 2. Identidad verificada: la bicicleta debe tener un CIT 'activo'. Sin el,
    //    no puede publicarse (403).
    const citResult = await client.query<{
      id: string
      fecha_vencimiento: string
    }>(
      `
        SELECT id, fecha_vencimiento
        FROM cits
        WHERE bicicleta_id = $1
          AND estado = 'activo'
        ORDER BY acunado_en DESC
        LIMIT 1
        FOR UPDATE
      `,
      [bici.id]
    )

    const cit = citResult.rows[0]
    if (!cit) {
      throw new ApiError(
        403,
        'CIT_NOT_ACTIVE',
        'La bicicleta no esta verificada con un CIT activo.'
      )
    }
    if (new Date(cit.fecha_vencimiento).getTime() <= Date.now()) {
      throw new ApiError(
        403,
        'CIT_EXPIRED',
        'El CIT de la bicicleta esta vencido.'
      )
    }

    // 3. Una sola publicacion activa/pausada por CIT (respaldado por indice unico).
    const duplicateResult = await client.query(
      `
        SELECT 1
        FROM marketplace_publicaciones
        WHERE cit_id = $1
          AND estado IN ('ACTIVA', 'PAUSADA')
        LIMIT 1
      `,
      [cit.id]
    )
    if (duplicateResult.rowCount) {
      throw new ApiError(
        409,
        'DUPLICATE_LISTING',
        'Ya existe una publicacion activa o pausada para esta bicicleta.'
      )
    }

    // 4. Foto opcional -> Netlify Blobs. Su URL publica se guarda en
    //    bicicletas.foto_url y encabeza las fotos de la publicacion.
    const fotosUrls = [...(data.fotosUrls ?? [])]
    if (foto) {
      let subida
      try {
        subida = await subirFotoBicicleta(bici.id, foto)
      } catch (error) {
        if (error instanceof StorageError) {
          throw new ApiError(400, error.code, error.message)
        }
        throw error
      }
      await client.query(
        `UPDATE bicicletas SET foto_url = $1, updated_at = NOW() WHERE id = $2`,
        [subida.url, bici.id]
      )
      fotosUrls.unshift(subida.url)
    } else if (fotosUrls.length === 0 && bici.foto_url) {
      // Sin foto nueva ni URLs: reutiliza la foto ya cargada en la bicicleta.
      fotosUrls.push(bici.foto_url)
    }

    // 5. Registrar la publicacion.
    const slugBase = slugify([bici.marca, bici.modelo, bici.anio])
    const slug = `${slugBase}-${bici.id.slice(0, 6)}`

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
        cit.id,
        bici.id,
        user.id,
        data.titulo,
        data.descripcion,
        data.precioARS,
        data.precioUSD ?? null,
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
