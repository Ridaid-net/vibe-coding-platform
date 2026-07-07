export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const pool = getPool()

    const [bicicletas, cits, ventas, compras, valoraciones, salidas] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM bicicletas WHERE propietario_id = $1', [id]),
      pool.query("SELECT COUNT(*) as total FROM cits c JOIN bicicletas b ON b.id = c.bicicleta_id WHERE b.propietario_id = $1 AND c.estado = 'activo'", [id]),
      pool.query("SELECT COUNT(*) as total, COALESCE(SUM(p.precio),0) as monto FROM publicaciones p JOIN transacciones t ON t.publicacion_id = p.id WHERE p.vendedor_id = $1 AND t.estado = 'completada'", [id]).catch(() => ({ rows: [{ total: 0, monto: 0 }] })),
      pool.query("SELECT COUNT(*) as total FROM transacciones WHERE comprador_id = $1 AND estado = 'completada'", [id]).catch(() => ({ rows: [{ total: 0 }] })),
      pool.query('SELECT COUNT(*) as total, COALESCE(AVG(puntuacion),0) as promedio FROM valoraciones WHERE destinatario_id = $1', [id]),
      pool.query('SELECT COUNT(*) as total FROM salidas_grupales WHERE organizador_id = $1', [id]),
    ])

    return NextResponse.json({
      ok: true,
      estadisticas: {
        bicicletas: parseInt(bicicletas.rows[0]?.total ?? '0'),
        cits_activos: parseInt(cits.rows[0]?.total ?? '0'),
        ventas: {
          total: parseInt(ventas.rows[0]?.total ?? '0'),
          monto_total: parseFloat(ventas.rows[0]?.monto ?? '0'),
        },
        compras: parseInt(compras.rows[0]?.total ?? '0'),
        valoraciones: {
          total: parseInt(valoraciones.rows[0]?.total ?? '0'),
          promedio: Math.round(parseFloat(valoraciones.rows[0]?.promedio ?? '0') * 10) / 10,
        },
        salidas_organizadas: parseInt(salidas.rows[0]?.total ?? '0'),
      }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
