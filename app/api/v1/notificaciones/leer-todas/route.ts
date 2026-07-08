export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireUser } from '@/lib/marketplace'

export async function PATCH(req: Request) {
  try {
    const user = await requireUser(req)
    const pool = getPool()
    await pool.query(
      'UPDATE notificaciones SET leida = true, leida_en = NOW() WHERE usuario_id = $1 AND leida = false',
      [user.id]
    )
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
