export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireStaff, jsonError } from '@/lib/marketplace'
import { StorageError, subirImagenNoticia } from '@/src/services/storage.service'
import { extraerEmbedSeguro } from '@/lib/noticias-embed'
import { parseNoticiaBody } from './_shared'

export async function GET(req: Request) {
  try {
    const pool = getPool()
    const url = new URL(req.url)
    const soloActivas = url.searchParams.get('activas') === 'true'
    const soloPrensa = url.searchParams.get('prensa') === 'true'
    const condiciones: string[] = []
    if (soloActivas) condiciones.push('activa = true')
    if (soloPrensa) condiciones.push('es_comunicado_prensa = true')
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''
    const result = await pool.query(
      `SELECT id, titulo, resumen, url, imagen_url, video_url, fuente, tipo, activa, es_comunicado_prensa, orden, created_at
       FROM noticias_rodaid
       ${where}
       ORDER BY orden ASC, created_at DESC
       LIMIT ${soloPrensa ? 50 : 20}`
    )
    return NextResponse.json({ ok: true, noticias: result.rows })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireStaff(req, 'admin')
    const { data, imagen } = await parseNoticiaBody(req)
    const { titulo, resumen, url, fuente, tipo, orden, video_url, es_comunicado_prensa } = data
    if (!titulo || !resumen) {
      return NextResponse.json({ error: 'titulo y resumen son obligatorios.' }, { status: 400 })
    }
    if (video_url && !extraerEmbedSeguro(video_url)) {
      return NextResponse.json(
        { error: 'El link de video debe ser un YouTube o Instagram valido.' },
        { status: 400 }
      )
    }

    let imagenUrl: string | null = null
    if (imagen) {
      try {
        imagenUrl = (await subirImagenNoticia(imagen)).url
      } catch (error) {
        if (error instanceof StorageError) {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
        throw error
      }
    }

    const pool = getPool()
    const result = await pool.query(
      `INSERT INTO noticias_rodaid (titulo, resumen, url, imagen_url, video_url, fuente, tipo, orden, es_comunicado_prensa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        titulo,
        resumen,
        url ?? null,
        imagenUrl,
        video_url ?? null,
        fuente ?? 'RODAID',
        tipo ?? 'noticia',
        orden ?? 0,
        es_comunicado_prensa ?? false,
      ]
    )
    return NextResponse.json({ ok: true, noticia: result.rows[0] })
  } catch (e: unknown) {
    return jsonError(e)
  }
}
