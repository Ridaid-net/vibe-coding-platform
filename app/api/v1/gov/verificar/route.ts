/**
 * RODAID · API Gubernamental de Verificación
 * GET /api/v1/gov/verificar?serie=XXXXXX
 * 
 * Endpoint para organismos gubernamentales de Mendoza.
 * Requiere header X-Tenant-ID y X-Gov-Token para autenticación.
 * Compatible con EDI X-Road · Ley 25.326 · RLS Neon
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { withTenant, getTenantFromHeader, auditTenant, TenantSlug } from '@/lib/tenant'
import { getPool } from '@/lib/marketplace'
import { checkRateLimit, rateLimitHeaders } from '@/lib/gov-rate-limit'
import { contarAutorizados, listarAutorizadosCompleto } from '@/src/services/autorizados.service'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const serie = url.searchParams.get('serie')
  const numeroCit = url.searchParams.get('cit')
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'

  // Validar token gubernamental
  const govToken = req.headers.get('x-gov-token')
  if (!govToken || govToken !== process.env.GOV_API_TOKEN) {
    return NextResponse.json(
      { error: 'NO_AUTORIZADO', message: 'Token gubernamental requerido.' },
      { status: 401 }
    )
  }

  if (!serie && !numeroCit) {
    return NextResponse.json(
      { error: 'PARAMETRO_REQUERIDO', message: 'Se requiere serie o cit.' },
      { status: 400 }
    )
  }

  try {
    const tenantSlug = getTenantFromHeader(req)

    // Consulta directa — verificación es pública entre tenants
    const pool = getPool()
    // Bypass RLS para verificacion publica inter-tenant
    await pool.query("SET app.bypass_rls = true").catch(() => undefined)
    const result = await pool.query(`
      SELECT
        a.id AS bici_id,
        a.numero_serie,
        a.marca,
        a.modelo,
        a.anio,
        a.tipo,
        a.color,
        c.codigo_cit as cit_codigo,
        c.estado::text as cit_estado,
        c.created_at as emitido_en,
        c.fecha_vencimiento as vence_en,
        c.hash_sha256,
        c.bfa_estado,
        c.bfa_modo,
        c.bfa_tx_hash,
        CASE WHEN d.id IS NOT NULL THEN true ELSE false END as tiene_denuncia_activa
      FROM bicicletas a
      LEFT JOIN cits c ON c.bicicleta_id = a.id AND c.estado = 'activo'
      LEFT JOIN denuncias_mpf d ON d.bicicleta_id = a.id AND d.estado = 'DENUNCIA_JUDICIAL_ACTIVA'
      WHERE ($1::text IS NULL OR lower(a.numero_serie) = lower($1))
        AND ($2::text IS NULL OR c.codigo_cit = $2)
      LIMIT 1
    `, [serie ?? null, numeroCit ?? null])

    // Registrar auditoría para cumplimiento EDI
    await auditTenant({
      tenantSlug,
      accion: 'GOV_VERIFICAR',
      tabla: 'activos',
      ipOrigen: ip,
      metadata: { serie, numeroCit, encontrado: result.rows.length > 0 }
    })

    if (!result.rows[0]) {
      return NextResponse.json({
        encontrado: false,
        message: 'No se encontró ninguna bicicleta con esos datos en la red RODAID.',
        consultado_en: new Date().toISOString(),
        tenant: tenantSlug,
      })
    }

    const bici = result.rows[0]

    // "Uso autorizado": booleano/cantidad para TODOS los tenants (comparten
    // un unico token, GOV_API_TOKEN) -- el array completo (nombre/DNI/
    // direccion/telefono, descifrado) SOLO para Ministerio de Seguridad.
    // MPF y municipios ven lo mismo que el verificador publico.
    const cantidadAutorizados = await contarAutorizados(bici.bici_id)
    const usoAutorizado: {
      autorizado: boolean
      cantidad: number
      personas?: Array<{ nombre_completo: string; dni: string; direccion: string; telefono: string | null }>
    } = {
      autorizado: cantidadAutorizados > 0,
      cantidad: cantidadAutorizados,
    }
    if (tenantSlug === 'ministerio_seguridad' && cantidadAutorizados > 0) {
      const personas = await listarAutorizadosCompleto(bici.bici_id)
      usoAutorizado.personas = personas.map((p) => ({
        nombre_completo: p.nombreCompleto,
        dni: p.dni,
        direccion: p.direccion,
        telefono: p.telefono,
      }))
    }

    return NextResponse.json({
      encontrado: true,
      bicicleta: {
        numero_serie: bici.numero_serie,
        marca: bici.marca,
        modelo: bici.modelo,
        anio: bici.anio,
        tipo: bici.tipo,
        color: bici.color,
      },
      cit: bici.cit_codigo ? {
        codigo: bici.cit_codigo,
        estado: bici.cit_estado,
        emitido_en: bici.emitido_en,
        vence_en: bici.vence_en,
        hash_identidad: bici.hash_sha256,
        anclaje_bfa: bici.bfa_estado === 'ACUNADO'
          ? {
              estado: bici.bfa_modo === 'ONCHAIN' ? 'ANCLADO_ONCHAIN' : 'REGISTRO_INTERNO',
              tx_hash: bici.bfa_modo === 'ONCHAIN' ? bici.bfa_tx_hash : null,
              detalle: bici.bfa_modo === 'ONCHAIN'
                ? 'Anclado on-chain en la Blockchain Federal Argentina.'
                : 'Identidad registrada en RODAID. El anclaje en la Blockchain Federal Argentina está en proceso de habilitación institucional.',
            }
          : { estado: 'PENDIENTE', tx_hash: null, detalle: 'Anclaje pendiente.' },
        taller: null
      } : null,
      alerta: bici.tiene_denuncia_activa ? {
        tipo: 'DENUNCIA_ACTIVA',
        message: 'Esta bicicleta tiene una denuncia de hurto activa en la red RODAID.',
      } : null,
      uso_autorizado: usoAutorizado,
      consultado_en: new Date().toISOString(),
      tenant: tenantSlug,
      fuente: 'RODAID · Registro Digital de Identidad de Bicicletas · Ley Provincial N° 9.556',
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: 'ERROR_INTERNO', message: String(e) },
      { status: 500 }
    )
  }
}
