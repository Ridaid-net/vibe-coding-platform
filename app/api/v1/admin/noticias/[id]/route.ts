export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireStaff } from '@/lib/marketplace'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff(req, 'admin')
    const { id } = await params
    const body = await req.json()
    const { titulo, resumen, url, fuente, tipo, activa, orden } = body
    const pool = getPool()
    const result = await pool.query(
      `UPDATE noticias_rodaid SET
        titulo = COALESCE($1, titulo),
        resumen = COALESCE($2, resumen),
        url = COALESCE($3, url),
        fuente = COALESCE($4, fuente),
        tipo = COALESCE($5, tipo),
        activa = COALESCE($6, activa),
        orden = COALESCE($7, orden),
        updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [titulo, resumen, url, fuente, tipo, activa, orden, id]
    )
    return NextResponse.json({ ok: true, noticia: result.rows[0] })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
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
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
