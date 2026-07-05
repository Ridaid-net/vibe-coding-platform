import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const dbUrl = process.env.NETLIFY_DB_URL ?? process.env.DATABASE_URL ?? ''
    if (!dbUrl) return NextResponse.json({ ok: false, error: 'No DB URL found', env: Object.keys(process.env).filter(k => k.includes('DB') || k.includes('DATABASE')) })
    
    const url = new URL(dbUrl)
    const response = await fetch(`https://${url.hostname}/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${url.username}:${url.password}`)}`,
      },
      body: JSON.stringify({
        query: "UPDATE usuarios SET rol = 'admin', updated_at = NOW() WHERE lower(email) = 'federicodegeaceo@rodaid.net' RETURNING id, email, rol",
        params: []
      })
    })
    const data = await response.json()
    return NextResponse.json({ ok: true, data })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
