/**
 * RODAID · Estadísticas Agregadas Multi-Tenant
 * GET /api/v1/gov/estadisticas
 * Solo disponible para Ministerio de Seguridad y RODAID admin
 * Compatible con EDI X-Road · Ley 25.326
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getTenantFromHeader, auditTenant } from '@/lib/tenant'
import { checkRateLimit, rateLimitHeaders } from '@/lib/gov-rate-limit'
import { getPool } from '@/lib/marketplace'

const TENANTS_AUTORIZADOS = ['ministerio_seguridad', 'rodaid']

export async function GET(req: Request) {
  const govToken = req.headers.get('x-gov-token')
  if (!govToken || govToken !== process.env.GOV_API_TOKEN) {
    return NextResponse.json({ error: 'NO_AUTORIZADO' }, { status: 401 })
  }
  const rateLimit = checkRateLimit(govToken)
  if (!rateLimit.ok) {
    return NextResponse.json({ error: 'RATE_LIMIT' }, { status: 429, headers: rateLimitHeaders(rateLimit) })
  }

  const tenantSlug = getTenantFromHeader(req)
  if (!TENANTS_AUTORIZADOS.includes(tenantSlug)) {
    return NextResponse.json({ error: 'ACCESO_DENEGADO', message: 'Solo el Ministerio de Seguridad puede acceder a estadísticas agregadas.' }, { status: 403 })
  }

  try {
    const pool = getPool()
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown'

    const [
      totalBicicletas,
      citsPorEstado,
      denunciasPorEstado,
      consultasPorTenant,
      eventosRecientes,
      tendencia,
    ] = await Promise.all([
      // Total bicicletas en la red
      pool.query('SELECT COUNT(*) as total FROM bicicletas'),

      // CITs por estado
      pool.query('SELECT estado::text, COUNT(*) as total FROM cits GROUP BY estado ORDER BY total DESC'),

      // Denuncias por estado
      pool.query('SELECT estado, COUNT(*) as total FROM denuncias_mpf GROUP BY estado ORDER BY total DESC'),

      // Consultas por organismo (últimas 24hs)
      pool.query(`
        SELECT t.slug, t.nombre, COUNT(al.id) as consultas_24h
        FROM tenants t
        LEFT JOIN tenant_audit_log al ON al.tenant_id = t.id 
          AND al.created_at > NOW() - INTERVAL '24 hours'
        WHERE t.tipo != 'plataforma'
        GROUP BY t.slug, t.nombre
        ORDER BY consultas_24h DESC
      `),

      // Eventos recientes (últimas 48hs)
      pool.query(`
        SELECT al.accion, al.created_at, t.slug as tenant, al.metadata
        FROM tenant_audit_log al
        JOIN tenants t ON t.id = al.tenant_id
        WHERE al.created_at > NOW() - INTERVAL '48 hours'
          AND al.accion IN ('GOV_DENUNCIAR', 'GOV_RECUPERAR', 'GOV_CERTIFICADO')
        ORDER BY al.created_at DESC
        LIMIT 20
      `),

      // Tendencia semanal de consultas
      pool.query(`
        SELECT 
          DATE_TRUNC('day', created_at) as dia,
          COUNT(*) as consultas
        FROM tenant_audit_log
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY dia
        ORDER BY dia ASC
      `)
    ])

    await auditTenant({
      tenantSlug,
      accion: 'GOV_ESTADISTICAS',
      tabla: 'estadisticas',
      ipOrigen: ip,
      metadata: {}
    })

    return NextResponse.json({
      ok: true,
      tenant: tenantSlug,
      consultado_en: new Date().toISOString(),
      estadisticas: {
        resumen: {
          total_bicicletas: parseInt(totalBicicletas.rows[0]?.total ?? '0'),
          cits: citsPorEstado.rows.reduce((acc: Record<string, number>, r: { estado: string; total: string }) => {
            acc[r.estado] = parseInt(r.total); return acc
          }, {}),
          denuncias: denunciasPorEstado.rows.reduce((acc: Record<string, number>, r: { estado: string; total: string }) => {
            acc[r.estado] = parseInt(r.total); return acc
          }, {}),
        },
        actividad_organismos: consultasPorTenant.rows.map((r: { slug: string; nombre: string; consultas_24h: string }) => ({
          slug: r.slug,
          nombre: r.nombre,
          consultas_24h: parseInt(r.consultas_24h),
        })),
        eventos_recientes: eventosRecientes.rows,
        tendencia_semanal: tendencia.rows.map((r: { dia: string; consultas: string }) => ({
          dia: r.dia,
          consultas: parseInt(r.consultas),
        })),
      }
    }, { headers: rateLimitHeaders(rateLimit) })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'ERROR_INTERNO', message: String(e) }, { status: 500 })
  }
}
