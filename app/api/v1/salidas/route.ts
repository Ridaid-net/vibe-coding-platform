export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'
import { requireAuth } from '@/lib/auth'

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req)
    const pool = getPool()
    const result = await pool.query(`
      SELECT sg.*, 
        COUNT(DISTINCT sp.id) as participantes_count,
        COUNT(DISTINCT sf.id) as fotos_count,
        COUNT(DISTINCT sc.id) as comentarios_count
      FROM salidas_grupales sg
      LEFT JOIN salidas_participantes sp ON sp.salida_id = sg.id
      LEFT JOIN salidas_fotos sf ON sf.salida_id = sg.id
      LEFT JOIN salidas_comentarios sc ON sc.salida_id = sg.id
      WHERE sg.organizador_id = $1
        AND (sg.estado != 'archivada' OR sg.updated_at > NOW() - INTERVAL '6 months')
      GROUP BY sg.id
      ORDER BY sg.fecha DESC
    `, [user.id])
    return NextResponse.json({ salidas: result.rows })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req)
    const body = await req.json()
    const pool = getPool()
    const result = await pool.query(`
      INSERT INTO salidas_grupales 
        (organizador_id, titulo, descripcion, fecha, hora, lugar_encuentro, km_recorrido, nivel, mapa_link, strava_link, garmin_link, trailforks_link, wikilok_link)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      user.id,
      body.titulo ?? `Salida ${body.fecha}`,
      body.descripcion,
      body.fecha,
      body.hora,
      body.lugar,
      body.km ?? null,
      body.nivel ?? 'moderado',
      body.mapLink ?? null,
      body.stravaLink ?? null,
      body.garminLink ?? null,
      body.trailforksLink ?? null,
      body.wikilokLink ?? null,
    ])
    return NextResponse.json({ salida: result.rows[0] })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
