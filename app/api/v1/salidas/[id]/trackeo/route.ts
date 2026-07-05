export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const pool = getPool()
  const result = await pool.query('SELECT trackeo_url, trackeo_tipo, trackeo_nombre FROM salidas_grupales WHERE id = $1', [id])
  return NextResponse.json({ trackeo: result.rows[0] ?? null })
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const body = await req.json()
    const pool = getPool()
    await pool.query(
      'UPDATE salidas_grupales SET trackeo_url = $1, trackeo_tipo = $2, trackeo_nombre = $3, updated_at = NOW() WHERE id = $4',
      [body.trackeo_url, body.trackeo_tipo ?? 'gpx', body.trackeo_nombre ?? 'Trackeo', id]
    )
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
