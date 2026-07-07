/**
 * RODAID · Búsqueda global de bicicletas
 * GET /api/v1/buscar?q=raleigh&tipo=MTB&marca=Trek&min=50000&max=200000
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const tipo = url.searchParams.get('tipo')
    const marca = url.searchParams.get('marca')
    const min = url.searchParams.get('min')
    const max = url.searchParams.get('max')
    const pagina = parseInt(url.searchParams.get('pagina') ?? '1')
    const limite = Math.min(parseInt(url.searchParams.get('limite') ?? '20'), 50)
    const offset = (pagina - 1) * limite

    const pool = getPool()

    const condiciones: string[] = ['p.estado = \'activa\'', 'c.estado = \'activo\'']
    const valores: unknown[] = []
    let idx = 1

    if (q) {
      condiciones.push(`(
        lower(b.marca) LIKE lower($${idx}) OR
        lower(b.modelo) LIKE lower($${idx}) OR
        lower(b.numero_serie) LIKE lower($${idx}) OR
        lower(p.titulo) LIKE lower($${idx})
      )`)
      valores.push(`%${q}%`)
      idx++
    }
    if (tipo) { condiciones.push(`lower(b.tipo) = lower($${idx})`); valores.push(tipo); idx++ }
    if (marca) { condiciones.push(`lower(b.marca) = lower($${idx})`); valores.push(marca); idx++ }
    if (min) { condiciones.push(`p.precio >= $${idx}`); valores.push(parseInt(min)); idx++ }
    if (max) { condiciones.push(`p.precio <= $${idx}`); valores.push(parseInt(max)); idx++ }

    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : ''

    const [resultados, total] = await Promise.all([
      pool.query(`
        SELECT
          b.id, b.marca, b.modelo, b.anio, b.tipo, b.color, b.numero_serie,
          p.id as publicacion_id, p.titulo, p.precio, p.moneda, p.descripcion,
          p.foto_urls, p.created_at as publicado_en,
          c.codigo_cit, c.estado::text as cit_estado
        FROM publicaciones p
        JOIN bicicletas b ON b.id = p.bicicleta_id
        JOIN cits c ON c.bicicleta_id = b.id AND c.estado = 'activo'
        ${where}
        ORDER BY p.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...valores, limite, offset]),
      pool.query(`
        SELECT COUNT(*) as total
        FROM publicaciones p
        JOIN bicicletas b ON b.id = p.bicicleta_id
        JOIN cits c ON c.bicicleta_id = b.id AND c.estado = 'activo'
        ${where}
      `, valores)
    ])

    return NextResponse.json({
      ok: true,
      resultados: resultados.rows,
      paginacion: {
        total: parseInt(total.rows[0]?.total ?? '0'),
        pagina,
        limite,
        paginas: Math.ceil(parseInt(total.rows[0]?.total ?? '0') / limite)
      },
      filtros: { q, tipo, marca, min, max }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
