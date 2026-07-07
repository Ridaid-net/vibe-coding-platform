export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireUser } from '@/lib/marketplace'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const pool = getPool()

    // Obtener token Strava del usuario
    const tokenResult = await pool.query(
      'SELECT strava_access_token, strava_refresh_token, strava_token_expiry FROM usuarios WHERE id = $1',
      [user.id]
    ).catch(() => ({ rows: [] }))

    const row = tokenResult.rows[0]
    if (!row?.strava_access_token) {
      return NextResponse.json({ ok: false, conectado: false, mensaje: 'Cuenta Strava no conectada.' })
    }

    // Verificar y refrescar token si es necesario
    let token = row.strava_access_token
    if (row.strava_token_expiry && new Date(row.strava_token_expiry) < new Date()) {
      const refresh = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.STRAVA_CLIENT_ID,
          client_secret: process.env.STRAVA_CLIENT_SECRET,
          refresh_token: row.strava_refresh_token,
          grant_type: 'refresh_token'
        })
      }).then(r => r.json())
      
      if (refresh.access_token) {
        token = refresh.access_token
        await pool.query(
          'UPDATE usuarios SET strava_access_token = $1, strava_token_expiry = to_timestamp($2) WHERE id = $3',
          [refresh.access_token, refresh.expires_at, user.id]
        ).catch(() => undefined)
      }
    }

    // Obtener actividades recientes
    const actividades = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=10&page=1',
      { headers: { 'Authorization': `Bearer ${token}` } }
    ).then(r => r.json())

    if (!Array.isArray(actividades)) {
      return NextResponse.json({ ok: false, conectado: true, error: 'Error obteniendo actividades.' })
    }

    return NextResponse.json({
      ok: true,
      conectado: true,
      actividades: actividades
        .filter((a: {type: string}) => a.type === 'Ride' || a.type === 'VirtualRide')
        .map((a: {id: number; name: string; distance: number; moving_time: number; start_date: string; average_speed: number}) => ({
          id: a.id,
          nombre: a.name,
          distancia_km: Math.round(a.distance / 100) / 10,
          tiempo_min: Math.round(a.moving_time / 60),
          fecha: a.start_date,
          velocidad_avg: Math.round(a.average_speed * 3.6 * 10) / 10,
        }))
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
