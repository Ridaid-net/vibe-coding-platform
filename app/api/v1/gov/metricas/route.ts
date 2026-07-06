/**
 * RODAID · API Gubernamental — Métricas por Tenant
 * GET /api/v1/gov/metricas
 * Compatible con EDI X-Road · Ley 25.326
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getTenantFromHeader, auditTenant } from '@/lib/tenant'
import { getPool } from '@/lib/marketplace'
import { checkRateLimit, rateLimitHeaders } from '@/lib/gov-rate-limit'

export async function GET(req: Request) {
  const govToken = req.headers.get('x-gov-token')
  if (!govToken || govToken !== process.env.GOV_API_TOKEN) {
    return NextResponse.json({ error: 'NO_AUTORIZADO' }, { status: 401 })
  }

  try {
    const tenantSlug = getTenantFromHeader(req)
    const pool = getPool()
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown'

    const [bicicletas, cits, denuncias, auditoria] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM bicicletas'),
      pool.query(`SELECT estado::text, COUNT(*) as total FROM cits GROUP BY estado`),
      pool.query(`SELECT estado, COUNT(*) as total FROM denuncias_mpf GROUP BY estado`),
      pool.query(`
        SELECT accion, COUNT(*) as total, MAX(created_at) as ultima
        FROM tenant_audit_log
        WHERE tenant_id = (SELECT id FROM tenants WHERE slug = $1)
        GROUP BY accion ORDER BY total DESC LIMIT 10
      `, [tenantSlug])
    ])

    await auditTenant({
      tenantSlug,
      accion: 'GOV_METRICAS',
      tabla: 'metricas',
      ipOrigen: ip,
      metadata: {}
    })

    return NextResponse.json({
      ok: true,
      tenant: tenantSlug,
      consultado_en: new Date().toISOString(),
      metricas: {
        bicicletas: {
          total: parseInt(bicicletas.rows[0]?.total ?? '0'),
        },
        cits: cits.rows.reduce(( acc: Record<string, number>, r: { estado: string; total: string }) => {
          acc[r.estado] = parseInt(r.total)
          return acc
        }, {}),
        denuncias: denuncias.rows.reduce(( acc: Record<string, number>, r: { estado: string; total: string }) => {
          acc[r.estado] = parseInt(r.total)
          return acc
        }, {}),
        auditoria_tenant: auditoria.rows,
      }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'ERROR_INTERNO', message: String(e) }, { status: 500 })
  }
}
