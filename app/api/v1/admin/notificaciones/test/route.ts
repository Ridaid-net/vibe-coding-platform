export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireStaff } from '@/lib/marketplace'

export async function POST(req: Request) {
  try {
    await requireStaff(req, 'admin')
    const body = await req.json()
    const { usuario_id, tipo, titulo, cuerpo, cta_url } = body

    const pool = getPool()
    const result = await pool.query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, cta_url)
       VALUES ($1, $2::notif_tipo, $3, $4, $5)
       RETURNING id, titulo`,
      [
        usuario_id,
        tipo ?? 'CIT_APROBADO',
        titulo ?? 'Notificación de prueba RODAID',
        cuerpo ?? 'Esta es una notificación de prueba.',
        cta_url ?? '/garaje'
      ]
    )
    return NextResponse.json({ ok: true, notificacion: result.rows[0] })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
