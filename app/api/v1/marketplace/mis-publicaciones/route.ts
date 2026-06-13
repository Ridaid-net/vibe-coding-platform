import { NextResponse } from 'next/server'
import {
  ApiError,
  getPool,
  jsonError,
  mapPublicacion,
  requireUser,
  type PublicacionRow,
} from '@/lib/marketplace'

export const runtime = 'nodejs'

const ESTADOS_VALIDOS = ['ACTIVA', 'PAUSADA', 'VENDIDA', 'CANCELADA', 'RECHAZADA'] as const
type EstadoPublicacion = (typeof ESTADOS_VALIDOS)[number]

interface MisPublicacionesRow extends PublicacionRow {
  numero_cit: string | null
  cit_estado: string | null
  cit_puntos: number | null
  cit_hash: string | null
  cit_vencimiento: string | null
}

interface ResumenRow {
  total: string
  activas: string
  pausadas: string
  vendidas: string
  valor_activo: string
  cobrado: string
  total_vistas: string
  total_contactos: string
}

/**
 * GET /api/v1/marketplace/mis-publicaciones — listings del usuario autenticado,
 * con el CIT más reciente de cada rodado (LATERAL JOIN) y un resumen agregado de
 * toda su cartera. Acepta filtro por estado y paginación.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const url = new URL(req.url)

    const estadoParam = url.searchParams.get('estado')?.trim().toUpperCase()
    const estado = parseEstado(estadoParam)
    const pagina = clamp(parseIntParam(url.searchParams.get('pagina')) ?? 1, 1, 10_000)
    const porPagina = clamp(parseIntParam(url.searchParams.get('porPagina')) ?? 20, 1, 50)
    const offset = (pagina - 1) * porPagina

    const pool = getPool()
    const values: Array<string | number> = [user.id]
    let whereEstado = ''
    if (estado) {
      values.push(estado)
      whereEstado = `AND mp.estado = $${values.length}`
    }

    const listValues = [...values, porPagina, offset]
    const [listResult, resumenResult] = await Promise.all([
      pool.query<MisPublicacionesRow>(
        `
          SELECT mp.*,
                 b.marca, b.modelo, b.anio, b.tipo, b.numero_serie,
                 c.numero_cit        AS numero_cit,
                 c.estado            AS cit_estado,
                 c.puntos            AS cit_puntos,
                 c.hash_sha256       AS cit_hash,
                 c.fecha_vencimiento AS cit_vencimiento
            FROM marketplace_publicaciones mp
            JOIN bicicletas b ON b.id = mp.bicicleta_id
            LEFT JOIN LATERAL (
              SELECT numero_cit, estado, puntos, hash_sha256, fecha_vencimiento
                FROM cits
               WHERE bicicleta_id = b.id
               ORDER BY created_at DESC
               LIMIT 1
            ) c ON TRUE
           WHERE mp.vendedor_id = $1
           ${whereEstado}
           ORDER BY mp.publicado_en DESC
           LIMIT $${values.length + 1}
           OFFSET $${values.length + 2}
        `,
        listValues
      ),
      pool.query<ResumenRow>(
        `
          SELECT COUNT(*)::text AS total,
                 COUNT(*) FILTER (WHERE estado = 'ACTIVA')::text  AS activas,
                 COUNT(*) FILTER (WHERE estado = 'PAUSADA')::text AS pausadas,
                 COUNT(*) FILTER (WHERE estado = 'VENDIDA')::text AS vendidas,
                 COALESCE(SUM(precio_ars) FILTER (WHERE estado = 'ACTIVA'), 0)::text       AS valor_activo,
                 COALESCE(SUM(precio_final_ars) FILTER (WHERE estado = 'VENDIDA'), 0)::text AS cobrado,
                 COALESCE(SUM(vistas), 0)::text    AS total_vistas,
                 COALESCE(SUM(contactos), 0)::text AS total_contactos
            FROM marketplace_publicaciones
           WHERE vendedor_id = $1
        `,
        [user.id]
      ),
    ])

    const r = resumenResult.rows[0]
    const totalCartera = Number(r?.total ?? 0)
    const totalFiltrado = estado
      ? estado === 'ACTIVA'
        ? Number(r?.activas ?? 0)
        : estado === 'PAUSADA'
          ? Number(r?.pausadas ?? 0)
          : estado === 'VENDIDA'
            ? Number(r?.vendidas ?? 0)
            : await contarPorEstado(user.id, estado)
      : totalCartera
    const paginas = Math.max(1, Math.ceil(totalFiltrado / porPagina))

    return NextResponse.json({
      ok: true,
      data: {
        publicaciones: listResult.rows.map(mapMisPublicacion),
        resumen: {
          total: totalCartera,
          activas: Number(r?.activas ?? 0),
          pausadas: Number(r?.pausadas ?? 0),
          vendidas: Number(r?.vendidas ?? 0),
          valorActivoARS: Number(r?.valor_activo ?? 0),
          cobradoARS: Number(r?.cobrado ?? 0),
          totalVistas: Number(r?.total_vistas ?? 0),
          totalContactos: Number(r?.total_contactos ?? 0),
        },
        filtro: { estado: estado ?? null },
        pagina,
        porPagina,
        total: totalFiltrado,
        paginas,
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}

function mapMisPublicacion(row: MisPublicacionesRow) {
  return {
    ...mapPublicacion(row),
    cit: row.numero_cit || row.cit_estado
      ? {
          numeroCIT: row.numero_cit,
          estado: row.cit_estado,
          puntosTotal: row.cit_puntos,
          hashSHA256: row.cit_hash,
          fechaVencimiento: row.cit_vencimiento,
        }
      : null,
  }
}

async function contarPorEstado(vendedorId: string, estado: EstadoPublicacion): Promise<number> {
  const pool = getPool()
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM marketplace_publicaciones
      WHERE vendedor_id = $1 AND estado = $2`,
    [vendedorId, estado]
  )
  return Number(rows[0]?.total ?? 0)
}

function parseEstado(value: string | undefined): EstadoPublicacion | null {
  if (!value) {
    return null
  }
  if (!ESTADOS_VALIDOS.includes(value as EstadoPublicacion)) {
    throw new ApiError(
      400,
      'ESTADO_INVALIDO',
      `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}.`
    )
  }
  return value as EstadoPublicacion
}

function parseIntParam(value: string | null): number | null {
  if (!value) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
