import { getStore } from '@netlify/blobs'

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  
  const authHeader = req.headers.get('x-admin-secret')
  if (authHeader !== process.env.ADMIN_TOKEN) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  
  try {
    const result = await pool.query(
      `UPDATE usuarios SET rol = 'admin', updated_at = NOW() WHERE lower(email) = lower($1) RETURNING id, email, rol`,
      ['federicodegeaceo@rodaid.net']
    )
    await pool.end()
    return new Response(JSON.stringify(result.rows[0]), { status: 200 })
  } catch (err) {
    await pool.end()
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
}

export const config = { path: '/api/set-admin' }
