export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireUser } from '@/lib/marketplace'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const pool = getPool()
    const url = new URL(req.url)
    const mes = url.searchParams.get('mes') // formato: 2026-07
    
    const condMes = mes ? `AND DATE_TRUNC('month', t.created_at) = DATE_TRUNC('month', '${mes}-01'::date)` : ''

    const [ventas, comisiones, suscripciones] = await Promise.all([
      pool.query(`
        SELECT t.id, t.monto, t.created_at, p.titulo, t.estado
        FROM transacciones t
        JOIN publicaciones p ON p.id = t.publicacion_id
        WHERE p.vendedor_id = $1 ${condMes}
        ORDER BY t.created_at DESC LIMIT 50
      `, [user.id]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT COALESCE(SUM(t.monto * 0.20), 0) as comision_rodaid,
               COALESCE(SUM(t.monto * 0.80), 0) as neto_vendedor,
               COUNT(*) as transacciones
        FROM transacciones t
        JOIN publicaciones p ON p.id = t.publicacion_id
        WHERE p.vendedor_id = $1 AND t.estado = 'completada' ${condMes}
      `, [user.id]).catch(() => ({ rows: [{ comision_rodaid: 0, neto_vendedor: 0, transacciones: 0 }] })),
      pool.query(`
        SELECT plan, monto, estado, created_at
        FROM suscripciones_aliado
        WHERE usuario_id = $1
        ORDER BY created_at DESC LIMIT 12
      `, [user.id]).catch(() => ({ rows: [] })),
    ])

    return NextResponse.json({
      ok: true,
      periodo: mes ?? 'todo',
      facturacion: {
        ventas: ventas.rows,
        resumen: {
          transacciones: parseInt(comisiones.rows[0]?.transacciones ?? '0'),
          bruto: parseFloat(comisiones.rows[0]?.neto_vendedor ?? '0') + parseFloat(comisiones.rows[0]?.comision_rodaid ?? '0'),
          neto_vendedor: parseFloat(comisiones.rows[0]?.neto_vendedor ?? '0'),
          comision_rodaid: parseFloat(comisiones.rows[0]?.comision_rodaid ?? '0'),
        },
        suscripciones: suscripciones.rows,
        nota: 'MercadoPago LIVE pendiente de activación — requiere RODAID SAS constituida.'
      }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
