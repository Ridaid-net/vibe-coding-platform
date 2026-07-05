export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const pool = getPool()
  const result = await pool.query('SELECT * FROM salidas_fotos WHERE salida_id = $1 ORDER BY created_at DESC', [id])
  return NextResponse.json({ fotos: result.rows })
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const body = await req.json()
    const pool = getPool()
    const result = await pool.query(
      'INSERT INTO salidas_fotos (salida_id, foto_url, caption, nombre_autor) VALUES ($1,$2,$3,$4) RETURNING *',
      [id, body.foto_url, body.caption ?? null, body.nombre_autor ?? 'Invitado']
    )
    return NextResponse.json({ foto: result.rows[0] })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
