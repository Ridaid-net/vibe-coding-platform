import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const dbUrl = process.env.NETLIFY_DB_URL!
    const url = new URL(dbUrl)
    
    // Netlify DB usa el driver serverless de Neon con endpoint HTTP especifico
    const response = await fetch(`https://${url.hostname}/query`, {
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
    const text = await response.text()
    return NextResponse.json({ ok: true, status: response.status, body: text })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
