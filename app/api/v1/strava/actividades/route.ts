export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireUser } from '@/lib/marketplace'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const pool = getPool()

    // Obtener token Strava desde oauth_connections
    const tokenResult = await pool.query(
      `SELECT access_token, refresh_token, expires_at 
       FROM oauth_connections 
       WHERE user_id = $1 AND provider = 'strava' 
       LIMIT 1`,
      [user.id]
    )

    const row = tokenResult.rows[0]
    if (!row) {
      return NextResponse.json({ ok: false, conectado: false, mensaje: 'Cuenta Strava no conectada.' })
    }

    // Verificar y refrescar token si es necesario
    let token = row.access_token
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      try {
        const refresh = await fetch('https://www.strava.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            refresh_token: row.refresh_token,
            grant_type: 'refresh_token'
          })
        }).then(r => r.json())

        if (refresh.access_token) {
          token = refresh.access_token
          await pool.query(
            `UPDATE oauth_connections 
             SET access_token = $1, refresh_token = $2, expires_at = to_timestamp($3)
             WHERE user_id = $4 AND provider = 'strava'`,
            [refresh.access_token, refresh.refresh_token, refresh.expires_at, user.id]
          ).catch(() => undefined)
        }
      } catch { /* continuar con token viejo */ }
    }

    // Obtener actividades recientes
    const res = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=10&page=1',
      { headers: { 'Authorization': `Bearer ${token}` } }
    )

    if (!res.ok) {
      return NextResponse.json({ ok: false, conectado: true, error: 'Error obteniendo actividades de Strava.' })
    }

    const actividades = await res.json()

    if (!Array.isArray(actividades)) {
      return NextResponse.json({ ok: false, conectado: true, error: 'Respuesta inválida de Strava.' })
    }

    return NextResponse.json({
      ok: true,
      conectado: true,
      actividades: actividades
        .filter((a: {type: string}) => a.type === 'Ride' || a.type === 'VirtualRide' || a.type === 'EBikeRide')
        .map((a: {id: number; name: string; distance: number; moving_time: number; start_date: string; average_speed: number; total_elevation_gain: number}) => ({
          id: a.id,
          nombre: a.name,
          distancia_km: Math.round(a.distance / 100) / 10,
          tiempo_min: Math.round(a.moving_time / 60),
          fecha: a.start_date,
          velocidad_avg: Math.round(a.average_speed * 3.6 * 10) / 10,
          elevacion_m: Math.round(a.total_elevation_gain),
        }))
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
