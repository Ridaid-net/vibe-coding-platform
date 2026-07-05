import type { Config } from '@netlify/functions'
import pg from 'pg'

export default async (req: Request) => {
  const { Pool } = pg
  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
  })
  
  try {
    const result = await pool.query(
      `UPDATE usuarios SET rol = 'admin', updated_at = NOW() 
       WHERE lower(email) = 'federicodegeaceo@rodaid.net' 
       RETURNING id, email, rol`,
      []
    )
    await pool.end()
    return new Response(JSON.stringify(result.rows[0] ?? { msg: 'no rows updated' }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    await pool.end()
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
}

export const config: Config = { path: '/api/set-admin' }
