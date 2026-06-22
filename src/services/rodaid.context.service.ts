// ─── RODAID · Context Builder para System Prompt ──────────
//
// Construye el bloque de contexto dinámico del usuario
// que se inyecta en el system prompt de RODAID-GPT.
//
// ══ DATOS INCLUIDOS ═══════════════════════════════════════
//
//   USUARIO:     nombre, zona GPS inferida, score de salud
//   BICICLETAS:  marca/modelo, km odómetro, km auditados,
//                km para próxima inspección, días desde última
//   CIT:         número, estado efectivo, puntaje, fechas,
//                tasa pendiente, NFT pendiente, días vigencia
//   HISTORIAL:   últimas 6 inspecciones con fecha y km
//   MARKETPLACE: publicaciones activas, vendidas, cobrado
//   ALIADO:      plan (PIONERO/CONSTRUCTOR/ESCALADOR),
//                porcentaje, CITs retribuidos, cobrado ARS
//
// ══ ZONA GPS ══════════════════════════════════════════════
//
//   San Martín:  lat -33.05 a -33.08, lng -68.44 a -68.50
//   Rivadavia:   lat -33.08 a -33.14
//   Junín:       lng < -68.50
//   Defecto:     San Martín
//
// ══ SCORE DE SALUD ════════════════════════════════════════
//
//   (puntajePromedio / 20) × 80 + bonusFrecuencia(20)
//   bonusFrecuencia = 20 si diasEntreCITs < 365

import { query, queryOne } from '../config/database'

const UMBRAL_KM_INSPECCION = 1_500   // km recomendado entre inspecciones

// ══════════════════════════════════════════════════════════
// QUERY PRINCIPAL — todo en una sola llamada a la DB
// ══════════════════════════════════════════════════════════

export async function buildContextoRico(
  usuarioId:    string,
  tipoConsulta?: string
): Promise<string> {
  const [usuario, bicicletas, historial, marketplace, aliado] = await Promise.all([

    // 1. Perfil + zona GPS + resumen global
    queryOne<any>(`
      SELECT
        u.nombre,
        CASE
          WHEN AVG(c.insp_geo_lat) BETWEEN -33.08 AND -33.04
           AND AVG(c.insp_geo_lng) BETWEEN -68.50 AND -68.44 THEN 'San Martín'
          WHEN AVG(c.insp_geo_lat) BETWEEN -33.14 AND -33.08 THEN 'Rivadavia'
          WHEN AVG(c.insp_geo_lng) < -68.50                   THEN 'Junín'
          ELSE 'San Martín'
        END AS zona,
        COUNT(DISTINCT c.id)::int AS total_cits,
        COUNT(DISTINCT c.id) FILTER(WHERE c.estado='ACTIVO')::int AS cits_activos,
        ROUND(AVG(c.puntos_total)::numeric,1) AS puntaje_global,
        COALESCE(SUM(c.km_desde_ultimo),0)::int AS km_auditados_total,
        MIN(c.fecha_emision)::text AS primera_inspeccion,
        MAX(c.fecha_emision)::text AS ultima_inspeccion,
        CASE
          WHEN COUNT(c.id) FILTER(WHERE c.fecha_emision IS NOT NULL) >= 2 THEN
            ROUND(
              EXTRACT(DAY FROM
                MAX(c.fecha_emision) FILTER(WHERE c.fecha_emision IS NOT NULL)
                - MIN(c.fecha_emision) FILTER(WHERE c.fecha_emision IS NOT NULL))
              / NULLIF(COUNT(c.id) FILTER(WHERE c.fecha_emision IS NOT NULL) - 1, 0)
            )::int
          ELSE NULL
        END AS frecuencia_dias
      FROM usuarios u
      JOIN  bicicletas b ON b.propietario_id = u.id
      LEFT JOIN cits c ON c.bicicleta_id = b.id
      WHERE u.id = $1::uuid
      GROUP BY u.id, u.nombre
    `, [usuarioId]),

    // 2. Bicicletas con CIT, km e historial de inspecciones
    query<any>(`
      SELECT
        b.marca, b.modelo, b.numero_serie,
        c_last.numero_cit,
        c_last.estado          AS cit_estado,
        c_last.puntos_total,
        c_last.tasa_pagada,
        c_last.nft_token_id,
        c_last.fecha_emision::text   AS cit_emision,
        c_last.fecha_vencimiento::text AS cit_vencimiento,
        EXTRACT(DAY FROM c_last.fecha_vencimiento - NOW())::int AS dias_vigencia,
        COALESCE(c_last.km_odometro,0)::int    AS km_odometro,
        COALESCE(SUM(c_all.km_desde_ultimo),0)::int AS km_auditados,
        COUNT(c_all.id)::int                   AS total_inspecciones,
        ROUND(AVG(c_all.puntos_total)::numeric,1) AS puntaje_promedio,
        EXTRACT(DAY FROM NOW() - MAX(c_all.fecha_emision))::int AS dias_desde_ultima
      FROM bicicletas b
      LEFT JOIN LATERAL (
        SELECT * FROM cits WHERE bicicleta_id=b.id ORDER BY creado_en DESC LIMIT 1
      ) c_last ON TRUE
      LEFT JOIN cits c_all ON c_all.bicicleta_id = b.id
      WHERE b.propietario_id = $1::uuid
      GROUP BY b.id, b.marca, b.modelo, b.numero_serie,
        c_last.numero_cit, c_last.estado, c_last.puntos_total,
        c_last.tasa_pagada, c_last.nft_token_id,
        c_last.fecha_emision, c_last.fecha_vencimiento, c_last.km_odometro
      ORDER BY total_inspecciones DESC, b.creado_en DESC
      LIMIT 5
    `, [usuarioId]),

    // 3. Historial de inspecciones con fecha y km
    query<any>(`
      SELECT c.numero_cit,
             b.marca||' '||b.modelo AS bici,
             c.estado, c.puntos_total,
             c.fecha_emision::text,
             c.km_desde_ultimo
      FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
      WHERE b.propietario_id=$1::uuid
        AND c.fecha_emision IS NOT NULL
      ORDER BY c.fecha_emision DESC
      LIMIT 6
    `, [usuarioId]),

    // 4. Marketplace
    queryOne<any>(`
      SELECT
        COUNT(*) FILTER(WHERE estado='ACTIVA')::int           AS activas,
        COUNT(*) FILTER(WHERE estado='PAUSADA')::int          AS pausadas,
        COUNT(*) FILTER(WHERE estado='VENDIDA')::int          AS vendidas,
        COALESCE(SUM(precio_final_ars) FILTER(WHERE estado='VENDIDA'),0)::int AS cobrado_ars,
        COALESCE(SUM(vistas),0)::int                          AS total_vistas
      FROM marketplace_publicaciones WHERE propietario_id=$1::uuid
    `, [usuarioId]),

    // 5. Rol aliado (si tiene taller)
    queryOne<any>(`
      SELECT ta.nombre, ta.plan_aliado,
        CASE ta.plan_aliado WHEN 'PIONERO' THEN 35 WHEN 'CONSTRUCTOR' THEN 40 ELSE 45 END AS porcentaje,
        COUNT(ra.id)::int AS cits_retribuidos,
        COALESCE(SUM(ra.monto_aliado_ars) FILTER(WHERE ra.estado='PAGADO'),0)::int AS cobrado_ars
      FROM talleres_aliados ta
      LEFT JOIN retribuciones_aliado ra ON ra.taller_id=ta.id
      WHERE ta.propietario_id=$1::uuid AND ta.habilitado=TRUE
      GROUP BY ta.id, ta.nombre, ta.plan_aliado
      LIMIT 1
    `, [usuarioId]),
  ])

  return renderContexto({
    usuario, bicicletas: bicicletas ?? [],
    historial: historial ?? [],
    marketplace, aliado, tipoConsulta,
  })
}

// ══════════════════════════════════════════════════════════
// RENDER — transforma los datos en texto para el system prompt
// ══════════════════════════════════════════════════════════

function renderContexto(d: {
  usuario:      any
  bicicletas:   any[]
  historial:    any[]
  marketplace:  any
  aliado:       any
  tipoConsulta?: string
}): string {
  const L: string[] = []
  const u = d.usuario

  // Score de salud
  const puntGlobal = parseFloat(u?.puntaje_global ?? '0')
  const activos    = u?.cits_activos ?? 0
  const scoreBase  = activos > 0 ? Math.round(puntGlobal / 20 * 80) : 0
  const bonusFrec  = u?.frecuencia_dias && u.frecuencia_dias < 365 ? 20 : 0
  const score      = Math.min(100, scoreBase + bonusFrec)
  const nivel      = score >= 80 ? 'EXCELENTE' : score >= 60 ? 'BUENO' : score >= 40 ? 'REGULAR' : 'NECESITA ATENCIÓN'

  // ── Encabezado ────────────────────────────────────────
  L.push(`USUARIO: ${u?.nombre ?? 'Usuario'}`)
  L.push(`ZONA: ${u?.zona ?? 'San Martín'} — Mendoza, Argentina`)
  L.push(`SCORE DE SALUD: ${score}/100 (${nivel})`)

  if ((u?.km_auditados_total ?? 0) > 0)
    L.push(`KM AUDITADOS (total plataforma): ${u.km_auditados_total.toLocaleString('es-AR')} km`)
  if (u?.frecuencia_dias)
    L.push(`FRECUENCIA DE MANTENIMIENTO: cada ~${u.frecuencia_dias} días entre inspecciones`)
  if (u?.primera_inspeccion)
    L.push(`HISTORIAL EN RODAID: desde ${u.primera_inspeccion.slice(0,10)} · última ${u.ultima_inspeccion?.slice(0,10)}`)

  L.push('')

  // ── Bicicletas ────────────────────────────────────────
  L.push(`BICICLETAS REGISTRADAS (${d.bicicletas.length}):`)

  for (const b of d.bicicletas) {
    L.push('')
    L.push(`  ▸ ${b.marca} ${b.modelo} — serie: ${b.numero_serie}`)

    // Km
    const kmAud = parseInt(b.km_auditados ?? '0')
    const kmOdo = parseInt(b.km_odometro ?? '0')
    const kmFal = Math.max(0, UMBRAL_KM_INSPECCION - kmAud)
    L.push(`    Odómetro: ${kmOdo.toLocaleString('es-AR')} km`)
    L.push(`    Km auditados desde última inspección: ${kmAud.toLocaleString('es-AR')} km`)
    if (kmFal > 0)
      L.push(`    Próxima inspección recomendada en: ~${kmFal.toLocaleString('es-AR')} km más`)
    else
      L.push(`    ⚠ Umbral de 1.500 km alcanzado — inspección recomendada ya`)
    if (b.dias_desde_ultima > 0)
      L.push(`    Días desde última inspección: ${b.dias_desde_ultima} días`)
    L.push(`    Inspecciones totales: ${b.total_inspecciones} (puntaje promedio ${b.puntaje_promedio}/20)`)

    // CIT
    if (b.numero_cit) {
      const dv = b.dias_vigencia
      const estadoIcon =
        b.cit_estado === 'ACTIVO'   ? '✅ ACTIVO' :
        b.cit_estado === 'BORRADOR' ? '⚠ BORRADOR (incompleto)' :
                                      `❌ ${b.cit_estado}`
      L.push(`    CIT: ${b.numero_cit} — ${estadoIcon} — ${b.puntos_total}/20 pts`)
      if (b.cit_emision)     L.push(`         Emitido: ${b.cit_emision.slice(0,10)}`)
      if (b.cit_vencimiento) {
        if (dv !== null && dv < 0)
          L.push(`         ❌ VENCIDO hace ${Math.abs(dv)} días`)
        else if (dv !== null && dv < 60)
          L.push(`         ⚠ Vence: ${b.cit_vencimiento.slice(0,10)} — en ${dv} días (renovar pronto)`)
        else
          L.push(`         Vence: ${b.cit_vencimiento.slice(0,10)}${dv ? ` (${dv} días restantes)` : ''}`)
      }
      if (!b.tasa_pagada)   L.push(`         ⚠ Tasa MxM pendiente ($3.000 ARS) → acción: POST /cit/pago`)
      if (!b.nft_token_id)  L.push(`         ⚠ NFT BFA pendiente de mint → acción: POST /bfa/mint/:id`)
    } else {
      L.push(`    Sin CIT registrado → iniciar inspección`)
    }
  }

  // ── Historial de inspecciones ─────────────────────────
  if (d.historial.length > 0) {
    L.push('')
    L.push(`HISTORIAL DE INSPECCIONES (${d.historial.length} con fecha):`)
    for (const h of d.historial) {
      const km  = h.km_desde_ultimo ? ` · ${h.km_desde_ultimo} km recorridos` : ''
      const pts = `${h.puntos_total}/20 pts`
      L.push(`  ${h.fecha_emision.slice(0,10)} | ${h.numero_cit} | ${h.bici} | ${pts}${km}`)
    }
  }

  // ── Marketplace ───────────────────────────────────────
  const mp = d.marketplace
  if ((mp?.activas ?? 0) > 0 || (mp?.vendidas ?? 0) > 0) {
    L.push('')
    L.push(`MARKETPLACE:`)
    if (mp.activas   > 0) L.push(`  · ${mp.activas} publicaciones activas`)
    if (mp.pausadas  > 0) L.push(`  · ${mp.pausadas} pausadas`)
    if (mp.vendidas  > 0) L.push(`  · ${mp.vendidas} bicicletas vendidas ($${mp.cobrado_ars.toLocaleString('es-AR')} ARS cobrados)`)
    if (mp.total_vistas > 0) L.push(`  · ${mp.total_vistas} vistas acumuladas`)
  }

  // ── Aliado ────────────────────────────────────────────
  if (d.aliado) {
    const al = d.aliado
    const porCIT = Math.round(3000 * al.porcentaje / 100)
    L.push('')
    L.push(`ROL ALIADO — ${al.nombre ?? 'Taller'}:`)
    L.push(`  · Plan ${al.plan_aliado}: ${al.porcentaje}% por CIT = $${porCIT.toLocaleString('es-AR')} ARS/CIT`)
    L.push(`  · CITs retribuidos: ${al.cits_retribuidos}`)
    L.push(`  · Total cobrado: $${al.cobrado_ars.toLocaleString('es-AR')} ARS`)
  }

  // ── Foco por tipo de consulta ─────────────────────────
  const FOCOS: Record<string, string> = {
    cit_consulta: '\nFOCO: El usuario pregunta sobre su CIT. Mencioná siempre el número de CIT concreto y los próximos pasos exactos.',
    marketplace:  '\nFOCO: Marketplace. Referite a sus publicaciones activas. Explicá el escrow y el split 97.5%/2.5% si aplica.',
    aliado:       '\nFOCO: Rol aliado. Detallá el plan, el porcentaje de retribución por CIT emitido y cómo cobrar vía MercadoPago.',
    legal:        '\nFOCO: Legal/normativa. Citá artículos específicos de la Ley 9556 cuando sea relevante (Arts. 11, 12, 17, 18).',
  }
  if (d.tipoConsulta && FOCOS[d.tipoConsulta]) L.push(FOCOS[d.tipoConsulta])

  return L.join('\n')
}
