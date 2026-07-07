/**
 * RODAID · Sistema de Valoraciones
 * POST /api/v1/valoraciones — Crear valoración
 * GET  /api/v1/valoraciones?usuarioId=XX — Ver valoraciones de un usuario
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireUser } from '@/lib/marketplace'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const usuarioId = url.searchParams.get('usuarioId')
    if (!usuarioId) return NextResponse.json({ error: 'usuarioId requerido.' }, { status: 400 })

    const pool = getPool()
    const result = await pool.query(`
      SELECT v.id, v.puntuacion, v.comentario, v.tipo, v.created_at,
        u.datos_perfil->>'nombre' as autor_nombre
      FROM valoraciones v
      JOIN usuarios u ON u.id = v.autor_id
      WHERE v.destinatario_id = $1
      ORDER BY v.created_at DESC
      LIMIT 50
    `, [usuarioId])

    const promedio = result.rows.length > 0
      ? result.rows.reduce((a: number, r: {puntuacion: number}) => a + r.puntuacion, 0) / result.rows.length
      : null

    return NextResponse.json({
      ok: true,
      valoraciones: result.rows,
      resumen: { total: result.rows.length, promedio: promedio ? Math.round(promedio * 10) / 10 : null }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json()
    const { destinatarioId, puntuacion, comentario, tipo, publicacionId } = body

    if (!destinatarioId || !puntuacion) {
      return NextResponse.json({ error: 'destinatarioId y puntuacion son obligatorios.' }, { status: 400 })
    }
    if (puntuacion < 1 || puntuacion > 5) {
      return NextResponse.json({ error: 'La puntuación debe ser entre 1 y 5.' }, { status: 400 })
    }
    if (destinatarioId === user.id) {
      return NextResponse.json({ error: 'No podés valorarte a vos mismo.' }, { status: 400 })
    }

    const pool = getPool()
    const result = await pool.query(`
      INSERT INTO valoraciones (autor_id, destinatario_id, puntuacion, comentario, tipo, publicacion_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (autor_id, destinatario_id, publicacion_id) DO UPDATE
        SET puntuacion = $3, comentario = $4, updated_at = NOW()
      RETURNING id, puntuacion, comentario, tipo, created_at
    `, [user.id, destinatarioId, puntuacion, comentario ?? null, tipo ?? 'comprador', publicacionId ?? null])

    return NextResponse.json({ ok: true, valoracion: result.rows[0] })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
