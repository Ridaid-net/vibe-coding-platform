export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const pool = getPool()
  const result = await pool.query('SELECT * FROM salidas_comentarios WHERE salida_id = $1 ORDER BY created_at ASC', [params.id])
  return NextResponse.json({ comentarios: result.rows })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    const pool = getPool()
    const result = await pool.query(
      'INSERT INTO salidas_comentarios (salida_id, contenido, nombre_autor) VALUES ($1,$2,$3) RETURNING *',
      [params.id, body.contenido, body.nombre_autor ?? 'Invitado']
    )
    return NextResponse.json({ comentario: result.rows[0] })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
