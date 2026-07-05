export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
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
      WHERE sg.id = $1
      GROUP BY sg.id
    `, [id])
    if (!result.rows[0]) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
    return NextResponse.json({ salida: result.rows[0] })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
