export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

/**
 * GET /api/v1/noticias — lectura publica de noticias (widget del Garaje,
 * /prensa, pagina de noticia completa). Sin auth: NO vive bajo /api/v1/admin/*
 * a proposito, porque esa ruta la intercepta netlify/edge-functions/auth-admin.ts
 * y exige un JWT de staff (admin/inspector) para CUALQUIER sub-path, sin
 * excepciones — un ciclista comun (o un visitante sin sesion) nunca hubiera
 * podido leer esto si hubiera quedado ahi. Confirmado en produccion: el mismo
 * GET bajo /api/v1/admin/noticias devolvia 401 AUTH_REQUIRED sin sesion de
 * staff, por eso el widget "a veces no cargaba" (en realidad, nunca cargaba
 * para un usuario no-staff).
 *
 * La listado COMPLETO para el editor (incluye inactivas, sin filtro) sigue en
 * GET /api/v1/admin/noticias, protegido por el borde — ahi si corresponde.
 */
export async function GET(req: Request) {
  try {
    const pool = getPool()
    const url = new URL(req.url)
    const soloActivas = url.searchParams.get('activas') === 'true'
    const soloPrensa = url.searchParams.get('prensa') === 'true'
    const condiciones: string[] = []
    if (soloActivas) condiciones.push('activa = true')
    if (soloPrensa) condiciones.push('es_comunicado_prensa = true')
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''
    const result = await pool.query(
      `SELECT id, titulo, resumen, url, imagen_url, video_url, fuente, tipo, activa, es_comunicado_prensa, orden, created_at
       FROM noticias_rodaid
       ${where}
       ORDER BY orden ASC, created_at DESC
       LIMIT ${soloPrensa ? 50 : 20}`
    )
    return NextResponse.json({ ok: true, noticias: result.rows })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
