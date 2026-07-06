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
  const url = new URL(req.url)
  const serie = url.searchParams.get('serie')
  if (!serie) return NextResponse.json({ error: 'PARAMETRO_REQUERIDO', message: 'serie es obligatorio.' }, { status: 400 })

  try {
    const tenantSlug = getTenantFromHeader(req)
    const pool = getPool()

    const [bici, cits, denuncias, audit] = await Promise.all([
      pool.query('SELECT id, numero_serie, marca, modelo, anio, tipo, color, created_at FROM bicicletas WHERE lower(numero_serie) = lower($1) LIMIT 1', [serie]),
      pool.query('SELECT codigo_cit, estado::text, created_at, fecha_vencimiento, hash_sha256 FROM cits WHERE bicicleta_id = (SELECT id FROM bicicletas WHERE lower(numero_serie) = lower($1)) ORDER BY created_at DESC', [serie]),
      pool.query('SELECT estado, numero_expediente, creado_en, actualizado_en, metadata FROM denuncias_mpf WHERE bicicleta_id = (SELECT id FROM bicicletas WHERE lower(numero_serie) = lower($1)) ORDER BY creado_en DESC', [serie]),
      pool.query(`SELECT accion, created_at, metadata FROM tenant_audit_log WHERE tenant_id = (SELECT id FROM tenants WHERE slug = $1) AND metadata::text LIKE $2 ORDER BY created_at DESC LIMIT 20`, [tenantSlug, `%${serie}%`])
    ])

    if (!bici.rows[0]) return NextResponse.json({ error: 'NO_ENCONTRADO', message: 'Bicicleta no encontrada.' }, { status: 404 })

    await auditTenant({ tenantSlug, accion: 'GOV_HISTORIAL', tabla: 'bicicletas', ipOrigen: req.headers.get('x-forwarded-for') ?? 'unknown', metadata: { serie } })

    return NextResponse.json({
      ok: true,
      tenant: tenantSlug,
      consultado_en: new Date().toISOString(),
      historial: {
        bicicleta: bici.rows[0],
        cits: cits.rows,
        denuncias: denuncias.rows,
        consultas_organismo: audit.rows,
      }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'ERROR_INTERNO', message: String(e) }, { status: 500 })
  }
}
