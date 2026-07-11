/**
 * RODAID · Certificado Gubernamental de Verificación
 * GET /api/v1/gov/certificado?serie=XX
 * Genera un HTML imprimible como certificado oficial
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getTenantFromHeader, auditTenant } from '@/lib/tenant'
import { checkRateLimit, rateLimitHeaders } from '@/lib/gov-rate-limit'
import { getPool } from '@/lib/marketplace'

const TENANT_NOMBRES: Record<string, string> = {
  ministerio_seguridad: 'Ministerio de Seguridad de Mendoza',
  mpf_mendoza: 'Ministerio Público Fiscal de Mendoza',
  municipio_san_martin: 'Municipalidad de San Martín',
  municipio_junin: 'Municipalidad de Junín',
  municipio_rivadavia: 'Municipalidad de Rivadavia',
  rodaid: 'RODAID — Plataforma Principal',
}

export async function GET(req: Request) {
  const govToken = req.headers.get('x-gov-token')
  if (!govToken || govToken !== process.env.GOV_API_TOKEN) {
    return NextResponse.json({ error: 'NO_AUTORIZADO' }, { status: 401 })
  }
  const rateLimit = checkRateLimit(govToken)
  if (!rateLimit.ok) {
    return NextResponse.json({ error: 'RATE_LIMIT' }, { status: 429, headers: rateLimitHeaders(rateLimit) })
  }

  const url = new URL(req.url)
  const serie = url.searchParams.get('serie')
  if (!serie) return NextResponse.json({ error: 'PARAMETRO_REQUERIDO' }, { status: 400 })

  try {
    const tenantSlug = getTenantFromHeader(req)
    const pool = getPool()

    const result = await pool.query(`
      SELECT a.numero_serie, a.marca, a.modelo, a.anio, a.tipo, a.color,
        c.codigo_cit, c.estado::text as cit_estado, c.created_at as emitido_en,
        c.fecha_vencimiento, c.hash_sha256, c.bfa_estado, c.bfa_modo,
        CASE WHEN d.id IS NOT NULL THEN true ELSE false END as tiene_denuncia
      FROM bicicletas a
      LEFT JOIN cits c ON c.bicicleta_id = a.id AND c.estado = 'activo'
      LEFT JOIN denuncias_mpf d ON d.bicicleta_id = a.id AND d.estado = 'DENUNCIA_JUDICIAL_ACTIVA'
      WHERE lower(a.numero_serie) = lower($1) LIMIT 1
    `, [serie])

    if (!result.rows[0]) {
      return NextResponse.json({ error: 'NO_ENCONTRADO' }, { status: 404 })
    }

    const b = result.rows[0]
    const organismo = TENANT_NOMBRES[tenantSlug] ?? tenantSlug
    const ahora = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
    const estadoColor = b.tiene_denuncia ? '#dc2626' : b.cit_estado === 'activo' ? '#16a34a' : '#F47B20'
    const estadoTexto = b.tiene_denuncia ? '⚠️ DENUNCIA JUDICIAL ACTIVA' : b.cit_estado === 'activo' ? '✅ CIT ACTIVO — VERIFICADO' : '⏳ SIN CIT ACTIVO'
    // Honestidad de estado (auditoria 2026-07-11): la BFA_RPC_URL/BFA_PRIVATE_KEY/
    // BFA_CIT_CONTRACT no estan configuradas en produccion, asi que ningun CIT
    // tiene todavia un anclaje ONCHAIN real -- solo mostrar el rotulo "Blockchain
    // Federal Argentina" cuando bfa_modo lo confirme.
    const anclajeOnchain = b.bfa_estado === 'anclado' && b.bfa_modo === 'ONCHAIN'

    await auditTenant({
      tenantSlug,
      accion: 'GOV_CERTIFICADO',
      tabla: 'bicicletas',
      ipOrigen: req.headers.get('x-forwarded-for') ?? 'unknown',
      metadata: { serie }
    })

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Certificado RODAID — ${serie}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #f7f6f3; padding: 40px; color: #0F1E35; }
    .cert { background: white; max-width: 800px; margin: 0 auto; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    .header { background: #0F1E35; padding: 32px; text-align: center; }
    .header h1 { color: white; font-size: 32px; font-weight: 900; letter-spacing: -1px; }
    .header p { color: #2BBCB8; margin-top: 6px; font-size: 14px; }
    .badge { display: inline-block; background: ${estadoColor}; color: white; padding: 8px 20px; border-radius: 999px; font-size: 13px; font-weight: 700; margin: 24px auto; }
    .body { padding: 32px; }
    .section-title { font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .field { background: #f7f6f3; padding: 12px 16px; border-radius: 10px; }
    .field label { font-size: 11px; color: #888; font-weight: 600; display: block; margin-bottom: 4px; }
    .field span { font-size: 15px; font-weight: 700; color: #0F1E35; }
    .hash { background: #f0fafa; border: 1px solid #2BBCB8; padding: 12px 16px; border-radius: 10px; margin-bottom: 24px; word-break: break-all; font-size: 12px; font-family: monospace; color: #0F1E35; }
    .alert { background: #fef2f2; border: 2px solid #dc2626; padding: 16px; border-radius: 10px; margin-bottom: 24px; }
    .alert p { color: #dc2626; font-weight: 700; }
    .footer-cert { background: #f7f6f3; padding: 20px 32px; border-top: 1px solid #e5e7eb; }
    .footer-cert p { font-size: 11px; color: #888; line-height: 1.6; }
    .organismo { font-weight: 700; color: #0F1E35; }
    .timestamp { font-size: 12px; color: #888; margin-top: 8px; }
    @media print { body { padding: 0; background: white; } .cert { box-shadow: none; } }
  </style>
</head>
<body>
  <div class="cert">
    <div class="header">
      <h1>RODAID</h1>
      <p>Certificado Oficial de Verificación de Identidad · Ley Provincial N° 9.556</p>
      <div class="badge">${estadoTexto}</div>
    </div>
    <div class="body">
      <p class="section-title">Datos de la Bicicleta</p>
      <div class="grid">
        <div class="field"><label>Número de Serie</label><span>${b.numero_serie}</span></div>
        <div class="field"><label>Marca</label><span>${b.marca ?? '-'}</span></div>
        <div class="field"><label>Modelo</label><span>${b.modelo ?? '-'}</span></div>
        <div class="field"><label>Año</label><span>${b.anio ?? '-'}</span></div>
        <div class="field"><label>Tipo</label><span>${b.tipo ?? '-'}</span></div>
        <div class="field"><label>Color</label><span>${b.color ?? '-'}</span></div>
      </div>
      ${b.tiene_denuncia ? `<div class="alert"><p>⚠️ ALERTA: Esta bicicleta tiene una Denuncia Judicial Activa en la red RODAID. No puede ser certificada hasta que la denuncia sea resuelta.</p></div>` : ''}
      ${b.codigo_cit ? `
      <p class="section-title">Certificado de Identidad Técnica (CIT)</p>
      <div class="grid">
        <div class="field"><label>Código CIT</label><span>${b.codigo_cit}</span></div>
        <div class="field"><label>Estado</label><span style="color:${estadoColor}">${b.cit_estado?.toUpperCase()}</span></div>
        <div class="field"><label>Emitido</label><span>${new Date(b.emitido_en).toLocaleDateString('es-AR')}</span></div>
        <div class="field"><label>Vence</label><span>${new Date(b.fecha_vencimiento).toLocaleDateString('es-AR')}</span></div>
      </div>
      <p class="section-title">${anclajeOnchain ? 'Hash Anclado en Blockchain Federal Argentina (SHA-256)' : 'Huella de Identidad (SHA-256)'}</p>
      <div class="hash">${b.hash_sha256 ?? 'Pendiente de anclaje'}</div>
      ${!anclajeOnchain ? '<p class="timestamp">El anclaje en la Blockchain Federal Argentina está en proceso de habilitación institucional.</p>' : ''}
      ` : ''}
    </div>
    <div class="footer-cert">
      <p>Certificado emitido por: <span class="organismo">${organismo}</span> vía API Gubernamental RODAID</p>
      <p>Verificación pública disponible en: <strong>https://rodaid.net/verificar</strong></p>
      <p>Este certificado tiene validez oficial bajo la Ley Provincial N° 9.556 y la Ley Nacional 25.326.</p>
      <p class="timestamp">Generado: ${ahora} (hora Argentina)</p>
    </div>
  </div>
</body>
</html>`

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="certificado-rodaid-${serie}.html"`,
        ...rateLimitHeaders(rateLimit),
      }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'ERROR_INTERNO', message: String(e) }, { status: 500 })
  }
}
// refreshed
