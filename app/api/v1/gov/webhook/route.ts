/**
 * RODAID · Webhook de Alertas Gubernamentales
 * POST /api/v1/gov/webhook — Registrar endpoint de notificación
 * GET  /api/v1/gov/webhook — Listar webhooks registrados
 * Compatible con EDI X-Road · Ley 25.326
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getTenantFromHeader, auditTenant } from '@/lib/tenant'
import { getPool } from '@/lib/marketplace'

export async function GET(req: Request) {
  const govToken = req.headers.get('x-gov-token')
  if (!govToken || govToken !== process.env.GOV_API_TOKEN) {
    return NextResponse.json({ error: 'NO_AUTORIZADO' }, { status: 401 })
  }
  try {
    const tenantSlug = getTenantFromHeader(req)
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, url, eventos, activo, created_at 
       FROM gov_webhooks 
       WHERE tenant_slug = $1 ORDER BY created_at DESC`,
      [tenantSlug]
    )
    return NextResponse.json({ webhooks: result.rows, tenant: tenantSlug })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const govToken = req.headers.get('x-gov-token')
  if (!govToken || govToken !== process.env.GOV_API_TOKEN) {
    return NextResponse.json({ error: 'NO_AUTORIZADO' }, { status: 401 })
  }
  try {
    const tenantSlug = getTenantFromHeader(req)
    const body = await req.json()
    const { url, eventos, secret } = body

    if (!url) {
      return NextResponse.json({ error: 'PARAMETRO_REQUERIDO', message: 'url es obligatorio.' }, { status: 400 })
    }

    const pool = getPool()
    const result = await pool.query(
      `INSERT INTO gov_webhooks (tenant_slug, url, eventos, secret, activo)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (tenant_slug, url) DO UPDATE SET eventos = $3, activo = true, updated_at = NOW()
       RETURNING id, url, eventos, activo, created_at`,
      [
        tenantSlug,
        url,
        eventos ?? ['DENUNCIA_ACTIVA', 'CIT_BLOQUEADO', 'BICI_RECUPERADA'],
        secret ?? null
      ]
    )

    await auditTenant({
      tenantSlug,
      accion: 'GOV_WEBHOOK_REGISTRAR',
      tabla: 'gov_webhooks',
      ipOrigen: req.headers.get('x-forwarded-for') ?? 'unknown',
      metadata: { url, eventos }
    })

    return NextResponse.json({
      ok: true,
      webhook: result.rows[0],
      tenant: tenantSlug,
      mensaje: 'Webhook registrado. Recibirás notificaciones cuando ocurran los eventos configurados.'
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
