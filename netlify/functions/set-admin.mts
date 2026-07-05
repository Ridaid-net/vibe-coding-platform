import type { Config } from '@netlify/functions'

export default async (req: Request) => {
  try {
    const dbUrl = process.env.DATABASE_URL ?? ''
    
    // Usar el cliente HTTP de Neon serverless directamente
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(dbUrl)
    
    const rows = await sql('UPDATE usuarios SET rol = $1, updated_at = NOW() WHERE lower(email) = $2 RETURNING id, email, rol', ['admin', 'federicodegeaceo@rodaid.net'])
    
    const body = JSON.stringify({ ok: true, row: rows[0] ?? null })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export const config: Config = { path: '/api/set-admin' }
