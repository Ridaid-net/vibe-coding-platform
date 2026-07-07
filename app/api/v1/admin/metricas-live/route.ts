/**
 * RODAID · Métricas en tiempo real para el panel admin
 * GET /api/v1/admin/metricas-live
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireStaff } from '@/lib/marketplace'

export async function GET(req: Request) {
  try {
    await requireStaff(req, 'admin')
    const pool = getPool()

    const [
      usuarios, bicicletas, cits, denuncias,
      publicaciones, salidas, actividad, govConsultas
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL \'24h\') as hoy FROM usuarios'),
      pool.query('SELECT COUNT(*) as total FROM bicicletas'),
      pool.query('SELECT estado::text, COUNT(*) as total FROM cits GROUP BY estado'),
      pool.query('SELECT estado, COUNT(*) as total FROM denuncias_mpf GROUP BY estado'),
      pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE estado = \'activa\') as activas FROM publicaciones'),
      pool.query('SELECT COUNT(*) as total FROM salidas_grupales'),
      pool.query(`
        SELECT DATE_TRUNC('hour', created_at) as hora, COUNT(*) as acciones
        FROM tenant_audit_log
        WHERE created_at > NOW() - INTERVAL '24h'
        GROUP BY hora ORDER BY hora ASC
      `),
      pool.query('SELECT COUNT(*) as total FROM tenant_audit_log WHERE created_at > NOW() - INTERVAL \'24h\''),
    ])

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      metricas: {
        usuarios: {
          total: parseInt(usuarios.rows[0]?.total ?? '0'),
          nuevos_hoy: parseInt(usuarios.rows[0]?.hoy ?? '0'),
        },
        bicicletas: { total: parseInt(bicicletas.rows[0]?.total ?? '0') },
        cits: cits.rows.reduce((acc: Record<string, number>, r: { estado: string; total: string }) => {
          acc[r.estado] = parseInt(r.total); return acc
        }, {}),
        denuncias: denuncias.rows.reduce((acc: Record<string, number>, r: { estado: string; total: string }) => {
          acc[r.estado] = parseInt(r.total); return acc
        }, {}),
        publicaciones: {
          total: parseInt(publicaciones.rows[0]?.total ?? '0'),
          activas: parseInt(publicaciones.rows[0]?.activas ?? '0'),
        },
        salidas: { total: parseInt(salidas.rows[0]?.total ?? '0') },
        gov_consultas_24h: parseInt(govConsultas.rows[0]?.total ?? '0'),
        actividad_horaria: actividad.rows,
      }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
