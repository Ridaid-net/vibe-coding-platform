export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireStaff } from '@/lib/marketplace'

export async function GET(req: Request) {
  try {
    const pool = getPool()
    const url = new URL(req.url)
    const soloActivas = url.searchParams.get('activas') === 'true'
    const result = await pool.query(
      `SELECT id, titulo, resumen, url, fuente, tipo, activa, orden, created_at
       FROM noticias_rodaid
       ${soloActivas ? "WHERE activa = true" : ""}
       ORDER BY orden ASC, created_at DESC
       LIMIT 20`
    )
    return NextResponse.json({ ok: true, noticias: result.rows })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireStaff(req, 'admin')
    const body = await req.json()
    const { titulo, resumen, url, fuente, tipo, orden } = body
    if (!titulo || !resumen) {
      return NextResponse.json({ error: 'titulo y resumen son obligatorios.' }, { status: 400 })
    }
    const pool = getPool()
    const result = await pool.query(
      `INSERT INTO noticias_rodaid (titulo, resumen, url, fuente, tipo, orden)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [titulo, resumen, url ?? null, fuente ?? 'RODAID', tipo ?? 'noticia', orden ?? 0]
    )
    return NextResponse.json({ ok: true, noticia: result.rows[0] })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
