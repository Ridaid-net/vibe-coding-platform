export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireUser } from '@/lib/marketplace'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const url = new URL(req.url)
    const limite = parseInt(url.searchParams.get('limite') ?? '20')
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, tipo, titulo, cuerpo as mensaje, leida, cta_url as url, created_at
       FROM notificaciones
       WHERE usuario_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [user.id, limite]
    )
    return NextResponse.json({ ok: true, notificaciones: result.rows })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
