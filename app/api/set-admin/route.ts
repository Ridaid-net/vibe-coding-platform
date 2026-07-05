import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

export async function POST() {
  try {
    const pool = getPool()
    const client = await pool.connect()
    try {
      const result = await client.query(
        `UPDATE usuarios SET rol = 'admin', updated_at = NOW() WHERE lower(email) = 'federicodegeaceo@rodaid.net' RETURNING id, email, rol`
      )
      return NextResponse.json({ ok: true, rows: result.rows })
    } finally {
      client.release()
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
