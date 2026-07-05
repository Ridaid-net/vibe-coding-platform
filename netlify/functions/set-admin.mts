import type { Config } from '@netlify/functions'

export default async (req: Request) => {
  try {
    const dbUrl = process.env.DATABASE_URL ?? ''
    
    // Extraer credenciales de la URL de conexión
    const url = new URL(dbUrl)
    const host = url.hostname
    const user = url.username
    const pass = url.password
    const db = url.pathname.slice(1)
    
    // Usar Neon HTTP API directamente
    const neonApiUrl = `https://${host}/sql`
    const response = await fetch(neonApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${user}:${pass}`)}`,
        'Neon-Connection-String': dbUrl,
      },
      body: JSON.stringify({
        query: "UPDATE usuarios SET rol = 'admin', updated_at = NOW() WHERE lower(email) = 'federicodegeaceo@rodaid.net' RETURNING id, email, rol",
        params: []
      })
    })
    
    const data = await response.json()
    return new Response(JSON.stringify({ ok: true, data }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ ok: false, error: msg }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    })
  }
}

export const config: Config = { path: '/api/set-admin' }
