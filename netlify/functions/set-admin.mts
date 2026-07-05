import type { Config } from '@netlify/functions'
import { neon } from '@neondatabase/serverless'

export default async (req: Request) => {
  try {
    const sql = neon(process.env.DATABASE_URL!)
    const result = await sql`
      UPDATE usuarios SET rol = 'admin', updated_at = NOW() 
      WHERE lower(email) = 'federicodegeaceo@rodaid.net' 
      RETURNING id, email, rol
    `
    return new Response(JSON.stringify(result[0] ?? { msg: 'no rows updated' }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
}

export const config: Config = { path: '/api/set-admin' }
