export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireStaff, jsonError } from '@/lib/marketplace'
import { StorageError, subirImagenNoticia } from '@/src/services/storage.service'
import { extraerEmbedSeguro } from '@/lib/noticias-embed'
import { parseNoticiaBody } from '../_shared'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff(req, 'admin')
    const { id } = await params
    const { data, imagen } = await parseNoticiaBody(req)
    const { titulo, resumen, url, fuente, tipo, orden, video_url, es_comunicado_prensa, activa } = data

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
      `UPDATE noticias_rodaid SET
        titulo = COALESCE($1, titulo),
        resumen = COALESCE($2, resumen),
        url = COALESCE($3, url),
        imagen_url = COALESCE($4, imagen_url),
        video_url = COALESCE($5, video_url),
        fuente = COALESCE($6, fuente),
        tipo = COALESCE($7, tipo),
        activa = COALESCE($8, activa),
        orden = COALESCE($9, orden),
        es_comunicado_prensa = COALESCE($10, es_comunicado_prensa),
        updated_at = NOW()
       WHERE id = $11 RETURNING *`,
      [titulo, resumen, url, imagenUrl, video_url, fuente, tipo, activa, orden, es_comunicado_prensa, id]
    )
    return NextResponse.json({ ok: true, noticia: result.rows[0] })
  } catch (e: unknown) {
    return jsonError(e)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff(req, 'admin')
    const { id } = await params
    const pool = getPool()
    await pool.query('DELETE FROM noticias_rodaid WHERE id = $1', [id])
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return jsonError(e)
  }
}
