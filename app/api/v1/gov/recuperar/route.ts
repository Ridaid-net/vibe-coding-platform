// v2
/**
 * RODAID · API Gubernamental — Recuperación de Bicicleta
 * POST /api/v1/gov/recuperar
 * Desbloquea una bici recuperada por el organismo
 * Compatible con EDI X-Road · Ley 25.326
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getTenantFromHeader, auditTenant } from '@/lib/tenant'
import { dispatchGovWebhook, notificarEventoGov } from '@/lib/gov-webhook-dispatcher'
import { getPool } from '@/lib/marketplace'
import { checkRateLimit, rateLimitHeaders } from '@/lib/gov-rate-limit'

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const govToken = req.headers.get('x-gov-token')
  if (!govToken || govToken !== process.env.GOV_API_TOKEN) {
    return NextResponse.json({ error: 'NO_AUTORIZADO' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { numero_serie, motivo_recuperacion, numero_expediente } = body

    if (!numero_serie) {
      return NextResponse.json({ error: 'PARAMETRO_REQUERIDO', message: 'numero_serie es obligatorio.' }, { status: 400 })
    }

    const tenantSlug = getTenantFromHeader(req)
    const pool = getPool()

    // Buscar bicicleta
    const biciResult = await pool.query(
      'SELECT id, numero_serie, marca, modelo FROM bicicletas WHERE lower(numero_serie) = lower($1) LIMIT 1',
      [numero_serie]
    )

    if (!biciResult.rows[0]) {
      return NextResponse.json({ ok: false, message: 'Bicicleta no encontrada en la red RODAID.' }, { status: 404 })
    }

    const bici = biciResult.rows[0]

    // Anular denuncia activa
    const resultado = await pool.query(`
      UPDATE denuncias_mpf 
      SET estado = 'ANULADA', 
          actualizado_en = NOW(),
          metadata = metadata || $1::jsonb
      WHERE bicicleta_id = $2 AND estado = 'DENUNCIA_JUDICIAL_ACTIVA'
      RETURNING id, actualizado_en
    `, [
      JSON.stringify({ recuperado_por: tenantSlug, motivo: motivo_recuperacion, expediente: numero_expediente, ip }),
      bici.id
    ])

    if (resultado.rows.length === 0) {
      return NextResponse.json({
        ok: false,
        message: 'No se encontró denuncia activa para esta bicicleta.',
        numero_serie,
      }, { status: 404 })
    }

    // Disparar webhook BICI_RECUPERADA
    dispatchGovWebhook('BICI_RECUPERADA', {
      bicicleta: { id: bici.id, numero_serie: bici.numero_serie, marca: bici.marca, modelo: bici.modelo },
      datos: { motivo: motivo_recuperacion, expediente: numero_expediente, organismo: tenantSlug }
    }).catch(() => undefined)
    notificarEventoGov({ evento: 'BICI_RECUPERADA', numeroSerie: numero_serie, marca: bici.marca, modelo: bici.modelo, expediente: numero_expediente, organismo: tenantSlug }).catch(() => undefined)

    await auditTenant({
      tenantSlug,
      accion: 'GOV_RECUPERAR',
      tabla: 'denuncias_mpf',
      ipOrigen: ip,
      metadata: { numero_serie, motivo_recuperacion, bicicleta_id: bici.id }
    })

    return NextResponse.json({
      ok: true,
      recuperacion: {
        bicicleta: { id: bici.id, numero_serie: bici.numero_serie, marca: bici.marca, modelo: bici.modelo },
        estado_anterior: 'DENUNCIA_JUDICIAL_ACTIVA',
        estado_nuevo: 'ANULADA',
        recuperado_en: resultado.rows[0].actualizado_en,
        tenant: tenantSlug,
        mensaje: 'Bicicleta desbloqueada en la red RODAID. Los talleres aliados podrán emitir un nuevo CIT.'
      }
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'ERROR_INTERNO', message: String(e) }, { status: 500 })
  }
}
