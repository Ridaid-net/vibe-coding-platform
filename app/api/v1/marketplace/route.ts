import { NextResponse } from 'next/server'
import {
  ApiError,
  buildSpanishTsQuery,
  getPool,
  jsonError,
  mapPublicacion,
  normalizeStringList,
  type PublicacionRow,
} from '@/lib/marketplace'

interface FacetaRow {
  valor: string
  conteo: string
}

interface RangoPrecioRow {
  etiqueta: string
  min: string
  max: string
  conteo: string
}

const ORDER_SQL = {
  precio_asc: 'mp.precio_ars ASC, mp.publicado_en DESC',
  precio_desc: 'mp.precio_ars DESC, mp.publicado_en DESC',
  recientes: 'mp.publicado_en DESC',
  vistas: 'mp.vistas DESC, mp.publicado_en DESC',
} as const

export async function GET(req: Request) {
  const startedAt = performance.now()

  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const tsQuery = q ? buildSpanishTsQuery(q) : ''
    const estado = url.searchParams.get('estado')?.trim() || 'ACTIVA'
    const marcas = normalizeStringList(
      url.searchParams.get('marca') ?? url.searchParams.get('marcas')
    )
    const tipo = url.searchParams.get('tipo')?.trim() || null
    const rodado = parseNumberParam(url.searchParams.get('rodado'))
    const talleCuadro = url.searchParams.get('talle_cuadro')?.trim() || url.searchParams.get('talleCuadro')?.trim() || null
    const precioMin = parseNumberParam(url.searchParams.get('precio_min') ?? url.searchParams.get('precioMin'))
    const precioMax = parseNumberParam(url.searchParams.get('precio_max') ?? url.searchParams.get('precioMax'))
    const anioMin = parseIntegerParam(url.searchParams.get('anio_min'))
    const anioMax = parseIntegerParam(url.searchParams.get('anio_max'))
    const pagina = clamp(parseIntegerParam(url.searchParams.get('pagina')) ?? 1, 1, 10000)
    const limite = clamp(parseIntegerParam(url.searchParams.get('limite')) ?? 12, 1, 50)
    const ordenParam = url.searchParams.get('orden') ?? (tsQuery ? 'relevancia' : 'recientes')
    const orden = isOrder(ordenParam) ? ordenParam : 'recientes'

    if (tsQuery.length === 0 && q.length > 0) {
      throw new ApiError(400, 'INVALID_QUERY', 'La busqueda no contiene lexemas validos.')
    }

    const offset = (pagina - 1) * limite
    const pool = getPool()
    const { whereSql, values, whereMeta } = buildWhere({
      estado,
      marcas,
      tipo,
      rodado,
      talleCuadro,
      precioMin,
      precioMax,
      anioMin,
      anioMax,
      tsQuery,
    })
    const orderSql =
      orden === 'relevancia' && tsQuery
        ? `ts_rank(mp.search_vector, to_tsquery(${
            whereMeta.tsConfigParam
          }, ${whereMeta.tsQueryParam})) DESC, mp.publicado_en DESC`
        : ORDER_SQL[orden === 'relevancia' ? 'recientes' : orden]

    const listValues = [...values, limite, offset]
    const listResult = await pool.query<PublicacionRow>(
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
        ${whereSql}
        ORDER BY ${orderSql}
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      listValues
    )

    const [countResult, marcasResult, tiposResult, rodadosResult, tallesResult, rangosResult, activasResult] =
      await Promise.all([
        pool.query<{ total: string }>(
          `
            SELECT COUNT(*)::text AS total
            FROM marketplace_publicaciones mp
            INNER JOIN bicicletas b ON b.id = mp.bicicleta_id
            ${whereSql}
          `,
          values
        ),
        pool.query<{ valor: string; conteo: string }>(
          `
            SELECT b.marca AS valor, COUNT(*)::text AS conteo
            FROM marketplace_publicaciones mp
            INNER JOIN bicicletas b ON b.id = mp.bicicleta_id
            WHERE mp.estado = $1
            GROUP BY b.marca
            ORDER BY COUNT(*) DESC, b.marca ASC
          `,
          [estado]
        ),
        pool.query<{ valor: string; conteo: string }>(
          `
            SELECT b.tipo AS valor, COUNT(*)::text AS conteo
            FROM marketplace_publicaciones mp
            INNER JOIN bicicletas b ON b.id = mp.bicicleta_id
            WHERE mp.estado = $1
            GROUP BY b.tipo
            ORDER BY COUNT(*) DESC, b.tipo ASC
          `,
          [estado]
        ),
        pool.query<{ valor: string; conteo: string }>(
          `
            SELECT b.rodado::text AS valor, COUNT(*)::text AS conteo
            FROM marketplace_publicaciones mp
            INNER JOIN bicicletas b ON b.id = mp.bicicleta_id
            WHERE mp.estado = $1 AND b.rodado IS NOT NULL
            GROUP BY b.rodado
            ORDER BY b.rodado ASC
          `,
          [estado]
        ),
        pool.query<{ valor: string; conteo: string }>(
          `
            SELECT b.talle_cuadro AS valor, COUNT(*)::text AS conteo
            FROM marketplace_publicaciones mp
            INNER JOIN bicicletas b ON b.id = mp.bicicleta_id
            WHERE mp.estado = $1 AND b.talle_cuadro IS NOT NULL
            GROUP BY b.talle_cuadro
            ORDER BY
              CASE b.talle_cuadro
                WHEN 'S' THEN 1 WHEN 'M' THEN 2 WHEN 'L' THEN 3 WHEN 'XL' THEN 4 ELSE 5
              END
          `,
          [estado]
        ),
        pool.query<{ etiqueta: string; min: string; max: string; conteo: string }>(
          `
            WITH rangos(etiqueta, min, max) AS (
              VALUES
                ('Hasta $200K', 0::numeric, 200000::numeric),
                ('$200K - $350K', 200000::numeric, 350000::numeric),
                ('$350K - $550K', 350000::numeric, 550000::numeric),
                ('Mas de $550K', 550000::numeric, 999999999::numeric)
            )
            SELECT
              r.etiqueta,
              r.min::text,
              r.max::text,
              COUNT(mp.id)::text AS conteo
            FROM rangos r
            LEFT JOIN marketplace_publicaciones mp
              ON mp.estado = $1
             AND mp.precio_ars >= r.min
             AND mp.precio_ars < r.max
            GROUP BY r.etiqueta, r.min, r.max
            ORDER BY r.min
          `,
          [estado]
        ),
        pool.query<{ total: string }>(
          `
            SELECT COUNT(*)::text AS total
            FROM marketplace_publicaciones
            WHERE estado = 'ACTIVA'
          `
        ),
      ])

    const total = Number(countResult.rows[0]?.total ?? 0)
    const paginas = Math.max(1, Math.ceil(total / limite))
    const tiempoMs = Math.round(performance.now() - startedAt)

    return NextResponse.json(
      {
        publicaciones: listResult.rows.map(mapPublicacion),
        total,
        pagina,
        paginas,
        tiempoMs,
        fromCache: false,
        facetas: {
          marcas: (marcasResult.rows as FacetaRow[]).map((row) => ({
            valor: row.valor,
            conteo: Number(row.conteo),
          })),
          tipos: (tiposResult.rows as FacetaRow[]).map((row) => ({
            valor: row.valor,
            conteo: Number(row.conteo),
          })),
          rodados: (rodadosResult.rows as FacetaRow[]).map((row) => ({
            valor: Number(row.valor),
            conteo: Number(row.conteo),
          })),
          talles: (tallesResult.rows as FacetaRow[]).map((row) => ({
            valor: row.valor,
            conteo: Number(row.conteo),
          })),
          rangosPrecio: (rangosResult.rows as RangoPrecioRow[]).map((row) => ({
            etiqueta: row.etiqueta,
            min: Number(row.min),
            max: Number(row.max),
            conteo: Number(row.conteo),
          })),
          totalActivas: Number(activasResult.rows[0]?.total ?? 0),
        },
        query: {
          q: q || null,
          filtros: {
            estado,
            marca: marcas.length ? marcas : null,
            tipo,
            rodado,
            talleCuadro,
            anioMin,
            anioMax,
            precioMin,
            precioMax,
            orden,
            pagina,
            limite,
          },
        },
      },
      {
        headers: {
          'X-Total-Count': String(total),
          'X-Page': String(pagina),
          'X-Pages': String(paginas),
          'X-Search-Ms': String(tiempoMs),
          'X-From-Cache': '0',
        },
      }
    )
  } catch (error) {
    return jsonError(error)
  }
}

function buildWhere(filters: {
  estado: string
  marcas: string[]
  tipo: string | null
  rodado: number | null
  talleCuadro: string | null
  precioMin: number | null
  precioMax: number | null
  anioMin: number | null
  anioMax: number | null
  tsQuery: string
}) {
  const clauses = ['mp.estado = $1']
  const values: Array<string | number | string[]> = [filters.estado]

  if (filters.tsQuery) {
    values.push('spanish', filters.tsQuery)
    clauses.push(`mp.search_vector @@ to_tsquery($${values.length - 1}, $${values.length})`)
  }
  if (filters.marcas.length) {
    values.push(filters.marcas)
    clauses.push(`b.marca = ANY($${values.length}::text[])`)
  }
  if (filters.tipo) {
    values.push(filters.tipo)
    clauses.push(`b.tipo = $${values.length}`)
  }
  if (filters.rodado !== null) {
    values.push(filters.rodado)
    clauses.push(`b.rodado = $${values.length}`)
  }
  if (filters.talleCuadro) {
    values.push(filters.talleCuadro)
    clauses.push(`b.talle_cuadro = $${values.length}`)
  }
  if (filters.precioMin !== null) {
    values.push(filters.precioMin)
    clauses.push(`mp.precio_ars >= $${values.length}`)
  }
  if (filters.precioMax !== null) {
    values.push(filters.precioMax)
    clauses.push(`mp.precio_ars <= $${values.length}`)
  }
  if (filters.anioMin !== null) {
    values.push(filters.anioMin)
    clauses.push(`b.anio >= $${values.length}`)
  }
  if (filters.anioMax !== null) {
    values.push(filters.anioMax)
    clauses.push(`b.anio <= $${values.length}`)
  }

  return {
    whereSql: `WHERE ${clauses.join(' AND ')}`,
    values,
    whereMeta: {
      tsConfigParam: filters.tsQuery ? `$2` : null,
      tsQueryParam: filters.tsQuery ? `$3` : null,
    },
  }
}

function parseNumberParam(value: string | null) {
  if (!value) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseIntegerParam(value: string | null) {
  if (!value) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function isOrder(value: string): value is keyof typeof ORDER_SQL | 'relevancia' {
  return value === 'relevancia' || value in ORDER_SQL
}
