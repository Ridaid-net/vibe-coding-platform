export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const pool = getPool()
  const result = await pool.query('SELECT * FROM salidas_fotos WHERE salida_id = $1 ORDER BY created_at DESC', [(await params).id])
  return NextResponse.json({ fotos: result.rows })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await req.json()
    const pool = getPool()
    const result = await pool.query(
      'INSERT INTO salidas_fotos (salida_id, foto_url, caption, nombre_autor) VALUES ($1,$2,$3,$4) RETURNING *',
      [(await params).id, body.foto_url, body.caption ?? null, body.nombre_autor ?? 'Invitado']
    )
    return NextResponse.json({ foto: result.rows[0] })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
