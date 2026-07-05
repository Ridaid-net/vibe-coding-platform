export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getDatabase } from '@netlify/database'

export async function POST() {
  try {
    const db = getDatabase()
    const result = await db.sql`
      UPDATE usuarios 
      SET rol = 'admin', updated_at = NOW() 
      WHERE lower(email) = 'federicodegeaceo@rodaid.net' 
      RETURNING id, email, rol
    `
    return NextResponse.json({ ok: true, rows: result })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
