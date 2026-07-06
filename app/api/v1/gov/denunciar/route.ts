/**
 * RODAID · API Gubernamental — Denuncia de Hurto
 * POST /api/v1/gov/denunciar
 * Compatible con EDI X-Road · Ley 25.326 · RLS Neon
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getTenantFromHeader, auditTenant } from '@/lib/tenant'
import { getPool } from '@/lib/marketplace'
import { dispatchGovWebhook, notificarEventoGov } from '@/lib/gov-webhook-dispatcher'

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'

  const govToken = req.headers.get('x-gov-token')
  if (!govToken || govToken !== process.env.GOV_API_TOKEN) {
    return NextResponse.json({ error: 'NO_AUTORIZADO', message: 'Token gubernamental requerido.' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { numero_serie, numero_expediente, motivo, organismo_denunciante } = body

    if (!numero_serie) {
      return NextResponse.json({ error: 'PARAMETRO_REQUERIDO', message: 'numero_serie es obligatorio.' }, { status: 400 })
    }

    const tenantSlug = getTenantFromHeader(req)
    const pool = getPool()

    // Buscar la bicicleta
    const biciResult = await pool.query(
      'SELECT id, numero_serie, marca, modelo FROM bicicletas WHERE lower(numero_serie) = lower($1) LIMIT 1',
      [numero_serie]
    )

    if (!biciResult.rows[0]) {
      return NextResponse.json({ ok: false, message: 'Bicicleta no encontrada en la red RODAID.', numero_serie }, { status: 404 })
    }

    const bici = biciResult.rows[0]
    const sistemaUserId = '00000000-0000-0000-0000-000000000001'
    const serialNorm = numero_serie.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')

    const denunciaResult = await pool.query(`
      INSERT INTO denuncias_mpf (
        bicicleta_id, usuario_id, serial_normalizado, numero_expediente,
        estado, pdf_blob_key, pdf_sha256, pdf_bytes,
        estructura_valida, titular_coincide, validacion, metadata
      ) VALUES ($1, $2, $3, $4, 'DENUNCIA_JUDICIAL_ACTIVA', $5, $6, 0, false, false, '{}', $7)
      ON CONFLICT (bicicleta_id) WHERE estado = 'DENUNCIA_JUDICIAL_ACTIVA' DO NOTHING
      RETURNING id, creado_en
    `, [
      bici.id,
      sistemaUserId,
      serialNorm,
      numero_expediente ?? null,
      'GOV-API-' + Date.now(),
      'gov-api-no-pdf',
      JSON.stringify({ organismo: organismo_denunciante ?? tenantSlug, ip, motivo: motivo ?? 'Hurto reportado via API gubernamental' })
    ])

    // Disparar webhook a organismos suscritos
    dispatchGovWebhook("DENUNCIA_ACTIVA", {
      bicicleta: { id: bici.id, numero_serie: bici.numero_serie, marca: bici.marca, modelo: bici.modelo },
      datos: { expediente: numero_expediente, organismo: organismo_denunciante ?? tenantSlug }
    }).catch(() => undefined)
    notificarEventoGov({ evento: 'DENUNCIA_ACTIVA', numeroSerie: numero_serie, marca: bici.marca, modelo: bici.modelo, expediente: numero_expediente, organismo: organismo_denunciante ?? tenantSlug }).catch(() => undefined)
    await auditTenant({
      tenantSlug,
      accion: 'GOV_DENUNCIAR',
      tabla: 'denuncias_mpf',
      ipOrigen: ip,
      metadata: { numero_serie, numero_expediente, bicicleta_id: bici.id }
    })

    return NextResponse.json({
      ok: true,
      denuncia: {
        id: denunciaResult.rows[0]?.id ?? null,
        bicicleta: { id: bici.id, numero_serie: bici.numero_serie, marca: bici.marca, modelo: bici.modelo },
        estado: 'DENUNCIA_JUDICIAL_ACTIVA',
        numero_expediente: numero_expediente ?? null,
        registrado_en: denunciaResult.rows[0]?.creado_en ?? new Date().toISOString(),
        tenant: tenantSlug,
        mensaje: 'La bicicleta queda bloqueada en toda la red RODAID. Ningún taller podrá emitir un nuevo CIT para este rodado.',
      }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'ERROR_INTERNO', message: String(e) }, { status: 500 })
  }
}
