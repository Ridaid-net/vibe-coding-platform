// ─── RODAID · Motor de Cotización de Seguros ─────────────
//
// Conecta el Certificado de Asegurabilidad con las aseguradoras
// y genera cotizaciones en tiempo real con tarifas preferenciales.
//
// ══ LÓGICA DE DESCUENTO RODAID ════════════════════════════
//
//   El usuario con CIT verificado tiene riesgo de fraude = 0
//   porque:
//     · Identidad acreditada (MxM nivel 2)
//     · Serial físico verificado in-situ por inspector aliado
//     · Hash SHA-256 anclado en BFA (inmutable, no falsificable)
//     · 20 puntos técnicos inspeccionados
//
//   La aseguradora aplica descuentos escalonados:
//
//     Base: dto_cit_verificado     15% (CIT activo en RODAID)
//     +     dto_nft_bfa             5% (NFT acuñado en BFA)
//     +     dto_identidad_mxm       5% (MxM nivel 2 verificado)
//     +     dto_score_excelente    10% (score aseg. ≥ 90)
//     ────────────────────────────────────────────────────
//     Máx.  35% de descuento sobre prima base
//
// ══ FLUJO ═════════════════════════════════════════════════
//
//   POST /seguros/cotizar
//     ↓
//   1. Cargar CIT + certificado_asegurabilidad + bicicleta
//   2. Calcular eligibilidad y descuentos por aseguradora
//   3. Para cada aseguradora activa → calcular prima_final
//   4. Persistir cotizacion con número COT-YYYY-NNNNN
//   5. Retornar array de cotizaciones ordenadas por precio
//
//   POST /seguros/contratar
//     ↓
//   1. Validar cotizacion no expirada
//   2. Crear suscripción MP (débito automático mensual)
//   3. Emitir póliza RODAID con número POL-YYYY-NNNNN
//   4. (futuro) Anclar hash póliza en BFA
//   5. Notificar al usuario + enviar póliza PDF

import { query, queryOne } from '../config/database'
import { getRedis }        from '../config/redis'
import crypto              from 'crypto'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface SolicitudCotizacion {
  usuarioId:   string
  bicicletaId: string
  citId:       string
  tipoBici:    'URBANA' | 'MTB' | 'RUTA' | 'ELECTRICA' | 'GRAVEL'
  tipoCobVert: 'ROBO' | 'COMBINADO'   // qué tipo de cobertura busca
}

export interface CotizacionLinea {
  aseguradoraId:    string
  aseguradoraNombre:string
  aseguradoraCodigo:string
  productoCodigo:   string
  productoNombre:   string
  tipo:             string
  // Prima
  primaBase:        number   // centavos/mes
  primaFinal:       number   // centavos/mes (con descuentos)
  primaFinalARS:    string   // formateado "$1.250"
  descuentoTotal:   number   // porcentaje total
  // Desglose descuentos
  descuentos: {
    cit:    number
    nft:    number
    mxm:    number
    score:  number
  }
  // Cobertura
  sumaAsegurada:    number
  sumaAseguradaARS: string
  coberturas:       string[]
  vigenciaMeses:    number
  franquiciaPct:    number
  // Comisión RODAID (para fee statement)
  comisionRodaid:   number
  comisionRodaidARS:string
  // Meta
  ahorro:           number   // vs. precio sin RODAID
  ahorroARS:        string
  recomendado:      boolean
}

export interface ResultadoCotizacion {
  numero:       string
  cotizacionId: string
  bicicleta:    { marca: string; modelo: string; serial: string; tipo: string }
  score:        number
  nivel:        string
  cotizaciones: CotizacionLinea[]
  expiraEn:     string
  generadoEn:   string
}

export interface SolicitudContratacion {
  cotizacionId:       string
  aseguradoraCodigo:  string
  productoCodigo:     string
  usuarioId:          string
  mpPaymentMethodId?: string   // ID del método de pago en MP
  inicioVigencia?:    Date
}

// ══════════════════════════════════════════════════════════
// MOTOR DE COTIZACIÓN
// ══════════════════════════════════════════════════════════

export async function cotizarSeguro(
  req: SolicitudCotizacion
): Promise<ResultadoCotizacion> {
  const redis = getRedis()

  // Cache 5 min por combinación bici+cit
  const cacheKey = `seguro:cotizacion:${req.bicicletaId}:${req.citId}:${req.tipoCobVert}`
  const cached   = await redis.get(cacheKey).catch(() => null)
  if (cached) return JSON.parse(cached)

  // ── 1. Cargar datos del CIT y certificado ────────────────
  const cit = await queryOne<any>(`
    SELECT c.id::text, c.estado, c.puntos_total, c.nft_token_id,
           c.hash_sha256,
           b.marca, b.modelo, b.numero_serie,
           ca.score, ca.nivel, ca.asegurable,
           u.id::text AS usuario_id
    FROM cits c
    JOIN bicicletas b   ON b.id   = c.bicicleta_id
    JOIN usuarios   u   ON u.id   = b.propietario_id
    LEFT JOIN certificados_asegurabilidad ca ON ca.cit_id = c.id
    WHERE c.id = $1::uuid AND c.estado = 'ACTIVO'
  `, [req.citId])

  if (!cit) throw new Error('CIT no encontrado o no activo')
  if (!(cit.asegurable ?? true)) throw new Error('Bicicleta no asegurable — CIT con score insuficiente')

  // ── 2. Verificar elegibilidad por descuentos ─────────────
  const nftOk  = !!cit.nft_token_id && cit.hash_sha256?.length === 64
  const mxmLvl = await queryOne<{ nivel: number }>(`
    SELECT nivel_verificacion AS nivel FROM mxm_tokens
    WHERE usuario_id = $1::uuid AND activo = TRUE
    ORDER BY actualizado_en DESC LIMIT 1
  `, [req.usuarioId]).then(r => r?.nivel ?? 0).catch(() => 0)

  const scoreVal = parseFloat(cit.score ?? '75')

  // ── 3. Traer aseguradoras y productos activos ────────────
  const aseguradoras = await query<any>(`
    SELECT a.*, p.id::text AS prod_id, p.codigo AS prod_codigo,
           p.nombre AS prod_nombre, p.tipo AS prod_tipo,
           p.prima_base_urbana, p.prima_base_mtb, p.prima_base_ruta, p.prima_base_electrica,
           p.cobertura_robo, p.cobertura_daños, p.cobertura_resp_civil, p.cobertura_asistencia,
           p.suma_asegurada_max, p.franquicia_pct, p.vigencia_meses
    FROM seguros_aseguradoras a
    JOIN seguros_productos p ON p.aseguradora_id = a.id
    WHERE a.activa = TRUE AND p.activo = TRUE
      AND p.tipo = $1
    ORDER BY a.nombre, p.tipo
  `, [req.tipoCobVert])

  // ── 4. Calcular cotizaciones ──────────────────────────────
  const cotizaciones: CotizacionLinea[] = []

  for (const row of aseguradoras) {
    // Prima base según tipo de bici
    const tipoKey = `prima_base_${(req.tipoBici || 'URBANA').toLowerCase()}`
    const primaBase: number = row[tipoKey] ?? row.prima_base_urbana

    // Descuentos aplicables
    const dtoCIT   = parseFloat(row.dto_cit_verificado   ?? 0)
    const dtoNFT   = nftOk  ? parseFloat(row.dto_nft_bfa        ?? 0) : 0
    const dtoMxM   = mxmLvl >= 2 ? parseFloat(row.dto_identidad_mxm ?? 0) : 0
    const dtoScore = scoreVal >= 90 ? parseFloat(row.dto_score_excelente ?? 0) : 0

    const descTotal   = Math.min(35, (dtoCIT||0) + (dtoNFT||0) + (dtoMxM||0) + (dtoScore||0))
    const primaFinal  = descTotal > 0 ? Math.round(Number(primaBase) * (1 - descTotal / 100)) : Number(primaBase)
    const comision    = Math.round(primaFinal * (row.comision_rodaid ?? 12) / 100)
    const ahorro      = Number(primaBase) - primaFinal

    const coberturas: string[] = []
    if (row.cobertura_robo)       coberturas.push('Robo total')
    if (row.cobertura_daños)      coberturas.push('Daños accidentales')
    if (row.cobertura_resp_civil) coberturas.push('Responsabilidad civil')
    if (row.cobertura_asistencia) coberturas.push('Asistencia mecánica 24h')

    cotizaciones.push({
      aseguradoraId:    row.id,
      aseguradoraNombre:row.nombre,
      aseguradoraCodigo:row.codigo,
      productoCodigo:   row.prod_codigo,
      productoNombre:   row.prod_nombre,
      tipo:             row.prod_tipo,
      primaBase,
      primaFinal,
      primaFinalARS:    formatARS(primaFinal),
      descuentoTotal:   descTotal,
      descuentos: { cit: dtoCIT, nft: dtoNFT, mxm: dtoMxM, score: dtoScore },
      sumaAsegurada:    row.suma_asegurada_max,
      sumaAseguradaARS: formatARS(row.suma_asegurada_max),
      coberturas,
      vigenciaMeses:    row.vigencia_meses,
      franquiciaPct:    parseFloat(row.franquicia_pct),
      comisionRodaid:   comision,
      comisionRodaidARS:formatARS(comision),
      ahorro,
      ahorroARS:        formatARS(ahorro),
      recomendado:      false,
    })
  }

  // Ordenar por precio → marcar el más barato como recomendado
  cotizaciones.sort((a, b) => a.primaFinal - b.primaFinal)
  if (cotizaciones.length > 0) cotizaciones[0].recomendado = true

  // ── 5. Persistir cotización ───────────────────────────────
  const numero = `COT-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`

  const certId = await queryOne<{id:string}>(
    `SELECT id::text FROM certificados_asegurabilidad WHERE cit_id=$1::uuid ORDER BY creado_en DESC LIMIT 1`,
    [req.citId]
  ).catch(() => null)

  await query(`
    INSERT INTO seguros_cotizaciones
      (numero, usuario_id, bicicleta_id, cit_id, certificado_aseg_id,
       score_asegurabilidad, nivel_asegurabilidad, identidad_mxm_nivel,
       nft_bfa_ok, cotizaciones_json, estado)
    VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,'RESPONDIDA')
  `, [
    numero, req.usuarioId, req.bicicletaId, req.citId,
    certId?.id ?? null,
    scoreVal, cit.nivel ?? 'BUENO',
    mxmLvl, nftOk,
    JSON.stringify(cotizaciones),
  ])

  const result: ResultadoCotizacion = {
    numero,
    cotizacionId: numero,
    bicicleta: {
      marca:  cit.marca,
      modelo: cit.modelo,
      serial: cit.numero_serie,
      tipo:   req.tipoBici,
    },
    score:       scoreVal,
    nivel:       cit.nivel ?? 'BUENO',
    cotizaciones,
    expiraEn:    new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    generadoEn:  new Date().toISOString(),
  }

  await redis.set(cacheKey, JSON.stringify(result), 'EX', '300').catch(() => {})
  return result
}

// ══════════════════════════════════════════════════════════
// CONTRATAR SEGURO (emitir póliza)
// ══════════════════════════════════════════════════════════

export async function contratarSeguro(
  req: SolicitudContratacion
): Promise<{ polizaId: string; numeroPoliza: string; primaFinal: string; inicioVigencia: string }> {
  // Validar cotización
  const cot = await queryOne<any>(`
    SELECT sq.*, sq.id::text AS sq_id
    FROM seguros_cotizaciones sq
    WHERE sq.numero = $1 AND sq.estado IN ('RESPONDIDA','PENDIENTE')
      AND sq.expira_en > NOW()
  `, [req.cotizacionId])

  if (!cot) throw new Error('Cotización no encontrada, ya utilizada o expirada')

  // Encontrar la cotización específica en el JSON
  const cotizaciones: CotizacionLinea[] = typeof cot.cotizaciones_json === 'string' ? JSON.parse(cot.cotizaciones_json) : (cot.cotizaciones_json ?? [])
  const linea = cotizaciones.find(c => c.aseguradoraCodigo === req.aseguradoraCodigo)
  if (!linea) throw new Error(`Cotización para ${req.aseguradoraCodigo} no encontrada`)

  // IDs de aseguradora y producto
  const aseg = await queryOne<{id:string}>(`SELECT id::text FROM seguros_aseguradoras WHERE codigo=$1`, [req.aseguradoraCodigo])
  const prod = await queryOne<{id:string}>(`SELECT id::text FROM seguros_productos WHERE codigo=$1`, [linea.productoCodigo])
  if (!aseg || !prod) throw new Error('Aseguradora o producto no encontrado')

  const inicioVigencia = req.inicioVigencia ?? new Date()
  const finVigencia    = new Date(inicioVigencia)
  finVigencia.setMonth(finVigencia.getMonth() + linea.vigenciaMeses)

  const numeroPoliza = `POL-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`
  const hashPoliza   = crypto.createHash('sha256')
    .update(JSON.stringify({ numeroPoliza, linea, ts: Date.now() }))
    .digest('hex')

  const pol = await queryOne<{id:string}>(`
    INSERT INTO seguros_polizas
      (numero_poliza, cotizacion_id, aseguradora_id, producto_id,
       usuario_id, bicicleta_id,
       prima_base, descuento_total_pct, prima_final, comision_rodaid,
       dto_cit_pct, dto_nft_pct, dto_mxm_pct, dto_score_pct,
       suma_asegurada, inicio_vigencia, fin_vigencia,
       hash_poliza)
    VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,
            $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING id::text
  `, [
    numeroPoliza, cot.id, aseg.id, prod.id,
    req.usuarioId, cot.bicicleta_id,
    linea.primaBase, linea.descuentoTotal, linea.primaFinal, linea.comisionRodaid,
    linea.descuentos.cit, linea.descuentos.nft, linea.descuentos.mxm, linea.descuentos.score,
    linea.sumaAsegurada,
    inicioVigencia.toISOString().slice(0,10),
    finVigencia.toISOString().slice(0,10),
    hashPoliza,
  ])

  // Marcar cotización como contratada
  await query(`UPDATE seguros_cotizaciones SET estado='CONTRATADA' WHERE numero=$1`, [req.cotizacionId])

  return {
    polizaId:      pol!.id,
    numeroPoliza,
    primaFinal:    linea.primaFinalARS,
    inicioVigencia: inicioVigencia.toISOString().slice(0,10),
  }
}

// ══════════════════════════════════════════════════════════
// GET: pólizas del usuario
// ══════════════════════════════════════════════════════════

export async function getMisPolizas(usuarioId: string) {
  return query<any>(`
    SELECT p.id::text, p.numero_poliza, p.prima_final, p.descuento_total_pct,
           p.suma_asegurada, p.inicio_vigencia, p.fin_vigencia, p.estado,
           a.nombre AS aseguradora, a.codigo AS aseg_codigo,
           pr.nombre AS producto, pr.tipo,
           pr.cobertura_robo, pr.cobertura_daños, pr.cobertura_asistencia,
           b.marca, b.modelo, b.numero_serie,
           p.dto_cit_pct, p.dto_nft_pct, p.dto_mxm_pct, p.dto_score_pct
    FROM seguros_polizas p
    JOIN seguros_aseguradoras a ON a.id = p.aseguradora_id
    JOIN seguros_productos    pr ON pr.id = p.producto_id
    JOIN bicicletas           b  ON b.id = p.bicicleta_id
    WHERE p.usuario_id = $1::uuid
    ORDER BY p.creado_en DESC
  `, [usuarioId])
}

// ══════════════════════════════════════════════════════════
// HELPER
// ══════════════════════════════════════════════════════════

function formatARS(centavos: number): string {
  return `$${Math.round(centavos / 100).toLocaleString('es-AR')}`
}
