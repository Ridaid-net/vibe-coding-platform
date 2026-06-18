// ─── RODAID · Auditoría GPS — Detección de Anomalías ─────
// Ejecuta automáticamente después de cada inspección CIT y
// analiza la coherencia geográfica y temporal.
//
// Anomalías detectadas:
//
//  INSP_LEJOS_TALLER     inspector a > 50 km del taller habilitado
//  VELOCIDAD_IMPOSIBLE   > 200 km/h entre inspecciones consecutivas
//  RAFAGA_CITS           > 8 CITs en la última hora (imposible físicamente)
//  PROP_LEJOS_TALLER     propietario a > 100 km del taller
//  FUERA_HORARIO         inspección entre 23:00 y 06:00 UTC
//  PRIMER_CIT_INSPECTOR  primer CIT del inspector (riesgo base)
//  IP_INUSUAL            IP diferente a las últimas 10 inspecciones
//  DISPOSITIVO_NUEVO     device ID diferente al historial
//
// Score de riesgo (0-100):
//   INSP_LEJOS_TALLER     +30
//   VELOCIDAD_IMPOSIBLE   +40  (corte duro → CRITICO automático)
//   RAFAGA_CITS           +25
//   PROP_LEJOS_TALLER     +15
//   FUERA_HORARIO         +10
//   PRIMER_CIT_INSPECTOR  +5
//   IP_INUSUAL            +10
//   DISPOSITIVO_NUEVO     +5
//
// Niveles de riesgo:
//   0-20  → BAJO     (normal)
//   21-40 → MEDIO    (requiere atención)
//   41-70 → ALTO     (requiere revisión)
//   71+   → CRITICO  (CIT suspendido automáticamente)

import { query, queryOne } from '../config/database'
import { log }             from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════

const DISTANCIA_MAX_INSP_TALLER_KM = 50    // radio máximo taller ↔ inspector
const DISTANCIA_MAX_PROP_TALLER_KM = 100   // radio máximo propietario ↔ taller
const VELOCIDAD_MAX_KMPH           = 200   // velocidad humana imposible
const MAX_CITS_POR_HORA            = 8     // inspecciones máximas en 60 min
const HORA_INICIO_SILENCIO_UTC     = 23    // inspecciones inusuales
const HORA_FIN_SILENCIO_UTC        = 6

// Scores individuales por anomalía
const SCORES: Record<string, number> = {
  INSP_LEJOS_TALLER:    30,
  VELOCIDAD_IMPOSIBLE:  40,
  RAFAGA_CITS:          25,
  PROP_LEJOS_TALLER:    15,
  FUERA_HORARIO:        10,
  PRIMER_CIT_INSPECTOR:  5,
  IP_INUSUAL:           10,
  DISPOSITIVO_NUEVO:     5,
}

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface AuditoriaInput {
  citId:       string
  inspectorId: string
  tallerId:    string
  // GPS del inspector al momento de la inspección
  inspLat?:    number
  inspLng?:    number
  // GPS declarado por el propietario
  propLat?:    number
  propLng?:    number
  // Metadata del dispositivo
  deviceId?:   string
  ipAddress?:  string
}

export interface AnomaliaDetectada {
  codigo:      string
  descripcion: string
  score:       number
  detalle?:    string
}

export interface AuditoriaResult {
  auditoriaId:      string
  citId:            string
  riesgo:           'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO'
  scoreRiesgo:      number
  anomalias:        AnomaliaDetectada[]
  requiereRevision: boolean
  // Métricas calculadas
  distInspTallerKm?:  number
  distInspPropKm?:    number
  distPropTallerKm?:  number
  velocidadKmh?:      number
  citsUltimaHora:     number
  // Acción recomendada
  accion:           'APROBAR' | 'REVISAR' | 'SUSPENDER'
}

// ══════════════════════════════════════════════════════════
// HAVERSINE — distancia en km entre dos coordenadas
// ══════════════════════════════════════════════════════════

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R   = 6371          // radio de la Tierra en km
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a   = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toRad(deg: number): number { return deg * Math.PI / 180 }

// ══════════════════════════════════════════════════════════
// AUDITORÍA PRINCIPAL
// ══════════════════════════════════════════════════════════

export async function auditarInspeccionGPS(input: AuditoriaInput): Promise<AuditoriaResult> {
  const inicio = Date.now()
  const anomalias: AnomaliaDetectada[] = []
  let scoreRiesgo = 0

  // ── Cargar datos necesarios ──────────────────────────
  const [taller, ultimaInsp, citsHora, historialIPs, historialDevices] = await Promise.all([
    queryOne<{ lat: number | null; lng: number | null; nombre: string }>(
      `SELECT lat, lng, nombre FROM talleres_aliados WHERE id=$1`, [input.tallerId]
    ),
    queryOne<{
      insp_lat: number | null; insp_lng: number | null
      auditado_en: Date; cit_id: string
    }>(
      `SELECT insp_lat, insp_lng, auditado_en, cit_id
       FROM auditoria_cit WHERE inspector_id=$1 AND insp_lat IS NOT NULL
       ORDER BY auditado_en DESC LIMIT 1`,
      [input.inspectorId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM auditoria_cit
       WHERE inspector_id=$1 AND auditado_en > NOW() - INTERVAL '1 hour'`,
      [input.inspectorId]
    ),
    query<{ ip: string }>(
      `SELECT ip_address::text AS ip FROM cits
       WHERE inspector_id=(SELECT usuario_id FROM inspectores WHERE id=$1)
         AND insp_ip IS NOT NULL
       GROUP BY ip_address ORDER BY MAX(creado_en) DESC LIMIT 10`,
      [input.inspectorId]
    ),
    query<{ device_id: string }>(
      `SELECT insp_device_id AS device_id FROM cits
       WHERE inspector_id=(SELECT usuario_id FROM inspectores WHERE id=$1)
         AND insp_device_id IS NOT NULL
       GROUP BY insp_device_id ORDER BY MAX(creado_en) DESC LIMIT 10`,
      [input.inspectorId]
    ),
  ])

  const citsEnUltimaHora = parseInt(citsHora?.count ?? '0')
  const tallerLat = taller?.lat ?? null
  const tallerLng = taller?.lng ?? null
  const ahora     = new Date()

  // ── CHK-1: INSPECTOR LEJOS DEL TALLER ──────────────
  let distInspTallerKm: number | undefined
  if (input.inspLat != null && input.inspLng != null && tallerLat != null && tallerLng != null) {
    distInspTallerKm = haversineKm(input.inspLat, input.inspLng, tallerLat, tallerLng)
    if (distInspTallerKm > DISTANCIA_MAX_INSP_TALLER_KM) {
      anomalias.push({
        codigo:      'INSP_LEJOS_TALLER',
        descripcion: `Inspector a ${distInspTallerKm.toFixed(1)} km del taller (máx ${DISTANCIA_MAX_INSP_TALLER_KM} km)`,
        score:       SCORES.INSP_LEJOS_TALLER,
        detalle:     `Taller: ${taller?.nombre} | Inspector: (${input.inspLat.toFixed(4)}, ${input.inspLng.toFixed(4)})`,
      })
      scoreRiesgo += SCORES.INSP_LEJOS_TALLER
    }
  }

  // ── CHK-2: VELOCIDAD IMPOSIBLE ──────────────────────
  let velocidadKmh: number | undefined
  if (ultimaInsp?.insp_lat != null && ultimaInsp?.insp_lng != null &&
      input.inspLat != null && input.inspLng != null) {
    const distDesdeUltima = haversineKm(
      ultimaInsp.insp_lat, ultimaInsp.insp_lng, input.inspLat, input.inspLng
    )
    const segundosDesde   = (ahora.getTime() - new Date(ultimaInsp.auditado_en).getTime()) / 1000
    if (segundosDesde > 0 && distDesdeUltima > 0) {
      velocidadKmh = (distDesdeUltima / segundosDesde) * 3600
      if (velocidadKmh > VELOCIDAD_MAX_KMPH) {
        anomalias.push({
          codigo:      'VELOCIDAD_IMPOSIBLE',
          descripcion: `Velocidad implícita ${velocidadKmh.toFixed(0)} km/h entre inspecciones`,
          score:       SCORES.VELOCIDAD_IMPOSIBLE,
          detalle:     `Distancia: ${distDesdeUltima.toFixed(1)} km en ${Math.round(segundosDesde / 60)} min`,
        })
        scoreRiesgo += SCORES.VELOCIDAD_IMPOSIBLE
        // Velocidad imposible → CRITICO directo
        scoreRiesgo = Math.max(scoreRiesgo, 71)
      }
    }
  }

  // ── CHK-3: RÁFAGA DE CITs ───────────────────────────
  if (citsEnUltimaHora >= MAX_CITS_POR_HORA) {
    anomalias.push({
      codigo:      'RAFAGA_CITS',
      descripcion: `${citsEnUltimaHora} CITs en la última hora (máximo esperado: ${MAX_CITS_POR_HORA})`,
      score:       SCORES.RAFAGA_CITS,
      detalle:     `Inspector emitió ${citsEnUltimaHora} certificados en < 60 min`,
    })
    scoreRiesgo += SCORES.RAFAGA_CITS
  }

  // ── CHK-4: PROPIETARIO LEJOS DEL TALLER ────────────
  let distPropTallerKm: number | undefined
  if (input.propLat != null && input.propLng != null && tallerLat != null && tallerLng != null) {
    distPropTallerKm = haversineKm(input.propLat, input.propLng, tallerLat, tallerLng)
    if (distPropTallerKm > DISTANCIA_MAX_PROP_TALLER_KM) {
      anomalias.push({
        codigo:      'PROP_LEJOS_TALLER',
        descripcion: `Propietario a ${distPropTallerKm.toFixed(1)} km del taller (máx ${DISTANCIA_MAX_PROP_TALLER_KM} km)`,
        score:       SCORES.PROP_LEJOS_TALLER,
        detalle:     `Propietario: (${input.propLat.toFixed(4)}, ${input.propLng.toFixed(4)})`,
      })
      scoreRiesgo += SCORES.PROP_LEJOS_TALLER
    }
  }

  // ── CHK-5: FUERA DE HORARIO ─────────────────────────
  const horaUTC = ahora.getUTCHours()
  const fueraHorario = horaUTC >= HORA_INICIO_SILENCIO_UTC || horaUTC < HORA_FIN_SILENCIO_UTC
  if (fueraHorario) {
    anomalias.push({
      codigo:      'FUERA_HORARIO',
      descripcion: `Inspección a las ${horaUTC.toString().padStart(2, '0')}:00 UTC (horario inusual)`,
      score:       SCORES.FUERA_HORARIO,
      detalle:     `Rango sospechoso: ${HORA_INICIO_SILENCIO_UTC}:00–${HORA_FIN_SILENCIO_UTC}:00 UTC`,
    })
    scoreRiesgo += SCORES.FUERA_HORARIO
  }

  // ── CHK-6: PRIMER CIT DEL INSPECTOR ────────────────
  const esPrimerCIT = !ultimaInsp
  if (esPrimerCIT) {
    anomalias.push({
      codigo:      'PRIMER_CIT_INSPECTOR',
      descripcion: 'Primer CIT emitido por este inspector',
      score:       SCORES.PRIMER_CIT_INSPECTOR,
    })
    scoreRiesgo += SCORES.PRIMER_CIT_INSPECTOR
  }

  // ── CHK-7: IP INUSUAL ───────────────────────────────
  if (input.ipAddress && historialIPs.length >= 3) {
    const ipsConocidas = new Set(historialIPs.map(r => r.ip))
    if (!ipsConocidas.has(input.ipAddress)) {
      anomalias.push({
        codigo:      'IP_INUSUAL',
        descripcion: 'IP no registrada en el historial del inspector',
        score:       SCORES.IP_INUSUAL,
        detalle:     `IP actual: ${input.ipAddress} | IPs conocidas: ${historialIPs.slice(0, 3).map(r => r.ip).join(', ')}`,
      })
      scoreRiesgo += SCORES.IP_INUSUAL
    }
  }

  // ── CHK-8: DISPOSITIVO NUEVO ────────────────────────
  if (input.deviceId && historialDevices.length >= 2) {
    const devicesConocidos = new Set(historialDevices.map(r => r.device_id))
    if (!devicesConocidos.has(input.deviceId)) {
      anomalias.push({
        codigo:      'DISPOSITIVO_NUEVO',
        descripcion: 'Device ID no registrado en el historial del inspector',
        score:       SCORES.DISPOSITIVO_NUEVO,
      })
      scoreRiesgo += SCORES.DISPOSITIVO_NUEVO
    }
  }

  // ── Score final y nivel de riesgo ──────────────────
  scoreRiesgo = Math.min(100, scoreRiesgo)
  const riesgo = scoreRiesgo >= 71 ? 'CRITICO'
    : scoreRiesgo >= 41 ? 'ALTO'
    : scoreRiesgo >= 21 ? 'MEDIO'
    : 'BAJO'

  const requiereRevision = riesgo === 'ALTO' || riesgo === 'CRITICO'
  const accion: AuditoriaResult['accion'] = riesgo === 'CRITICO' ? 'SUSPENDER'
    : requiereRevision ? 'REVISAR' : 'APROBAR'

  // ── Distancia inspector ↔ propietario ──────────────
  let distInspPropKm: number | undefined
  if (input.inspLat != null && input.inspLng != null &&
      input.propLat != null && input.propLng != null) {
    distInspPropKm = haversineKm(input.inspLat, input.inspLng, input.propLat, input.propLng)
  }

  // ── Persistir en DB ─────────────────────────────────
  const row = await queryOne<{ id: string }>(
    `INSERT INTO auditoria_cit
       (cit_id, inspector_id, taller_id,
        insp_lat, insp_lng, taller_lat, taller_lng, prop_lat, prop_lng,
        dist_insp_taller_km, dist_insp_prop_km, dist_prop_taller_km,
        velocidad_kmh, hora_inspeccion, dia_semana, cits_ultima_hora,
        anomalias, riesgo, score_riesgo, requiere_revision)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::text[],$18,$19,$20)
     RETURNING id`,
    [
      input.citId, input.inspectorId, input.tallerId,
      input.inspLat ?? null, input.inspLng ?? null, tallerLat, tallerLng,
      input.propLat ?? null, input.propLng ?? null,
      distInspTallerKm ?? null, distInspPropKm ?? null, distPropTallerKm ?? null,
      velocidadKmh ?? null, horaUTC, ahora.getUTCDay(), citsEnUltimaHora,
      anomalias.map(a => a.codigo),
      riesgo, scoreRiesgo, requiereRevision,
    ]
  )

  const auditoriaId = row!.id

  // Suspender CIT si es CRITICO
  if (riesgo === 'CRITICO') {
    await query(
      `UPDATE cits SET estado='BLOQUEADO', actualizado_en=NOW() WHERE id=$1 AND estado='PENDIENTE'`,
      [input.citId]
    ).catch(() => {})
    log.gps.error({
      citId:    input.citId.slice(0, 8),
      inspId:   input.inspectorId.slice(0, 8),
      score:    scoreRiesgo,
      anomalias:anomalias.map(a => a.codigo),
    }, '🚨 CIT SUSPENDIDO por anomalía GPS CRITICA')
  } else if (requiereRevision) {
    log.gps.warn({
      citId:    input.citId.slice(0, 8),
      riesgo,   score: scoreRiesgo,
      anomalias:anomalias.map(a => a.codigo),
    }, `⚠ Anomalía GPS ${riesgo} — requiere revisión`)
  } else {
    log.gps.info({
      citId:  input.citId.slice(0, 8),
      score:  scoreRiesgo,
      ms:     Date.now() - inicio,
    }, `✓ Auditoría GPS OK (score ${scoreRiesgo})`)
  }

  return {
    auditoriaId, citId: input.citId, riesgo, scoreRiesgo,
    anomalias, requiereRevision, accion,
    distInspTallerKm, distInspPropKm, distPropTallerKm,
    velocidadKmh, citsUltimaHora: citsEnUltimaHora,
  }
}

// ══════════════════════════════════════════════════════════
// PANEL ADMIN — Listado y estadísticas
// ══════════════════════════════════════════════════════════

export async function getAnomaliasPendientes(opts?: {
  riesgo?: string; tallerId?: string; pagina?: number; porPagina?: number
}): Promise<{ items: any[]; total: number }> {
  const pagina    = Math.max(1, opts?.pagina ?? 1)
  const porPagina = Math.min(100, opts?.porPagina ?? 25)
  const offset    = (pagina - 1) * porPagina

  const conds: string[] = ['a.requiere_revision=TRUE', 'a.revisado_en IS NULL']
  const params: unknown[] = []
  let idx = 1

  if (opts?.riesgo) { conds.push(`a.riesgo=$${idx++}`); params.push(opts.riesgo) }
  if (opts?.tallerId) { conds.push(`a.taller_id=$${idx++}`); params.push(opts.tallerId) }

  const where = conds.join(' AND ')
  const [items, count] = await Promise.all([
    query<any>(
      `SELECT a.id, a.cit_id, a.riesgo, a.score_riesgo, a.anomalias,
              a.dist_insp_taller_km, a.velocidad_kmh, a.cits_ultima_hora,
              a.auditado_en,
              c.numero_cit, c.estado AS cit_estado,
              u.nombre AS inspector_nombre, u.apellido AS inspector_apellido,
              ta.nombre AS taller_nombre
       FROM auditoria_cit a
       JOIN cits c          ON c.id=a.cit_id
       JOIN inspectores i   ON i.id=a.inspector_id
       JOIN usuarios u      ON u.id=i.usuario_id
       JOIN talleres_aliados ta ON ta.id=a.taller_id
       WHERE ${where}
       ORDER BY a.score_riesgo DESC, a.auditado_en DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, porPagina, offset]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM auditoria_cit a WHERE ${where}`,
      params
    ),
  ])

  return { items, total: parseInt(count?.count ?? '0') }
}

export async function resolverAnomalia(auditoriaId: string, opts: {
  resolucion: 'OK' | 'FRAUDE' | 'FALSO_POSITIVO'
  revisadoPor: string
  notas?:      string
}): Promise<void> {
  await query(
    `UPDATE auditoria_cit SET
       resolucion=$2, revisado_por=$3::uuid, revisado_en=NOW(), requiere_revision=FALSE
     WHERE id=$1`,
    [auditoriaId, opts.resolucion, opts.revisadoPor]
  )
  // Si es FRAUDE → bloquear CIT
  if (opts.resolucion === 'FRAUDE') {
    const citId = await queryOne<{ cit_id: string }>(
      `SELECT cit_id FROM auditoria_cit WHERE id=$1`, [auditoriaId]
    )
    if (citId) {
      await query(`UPDATE cits SET estado='BLOQUEADO', actualizado_en=NOW() WHERE id=$1`, [citId.cit_id])
    }
  }
}

export async function getEstadisticasAuditoria(dias = 30) {
  const [resumen, porRiesgo, topAnomalias] = await Promise.all([
    queryOne<any>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER(WHERE riesgo='CRITICO')::int AS criticos,
              COUNT(*) FILTER(WHERE riesgo='ALTO')::int    AS altos,
              COUNT(*) FILTER(WHERE riesgo='MEDIO')::int   AS medios,
              COUNT(*) FILTER(WHERE riesgo='BAJO')::int    AS bajos,
              COUNT(*) FILTER(WHERE requiere_revision AND revisado_en IS NULL)::int AS pendientes,
              AVG(score_riesgo)::numeric(5,1) AS score_promedio
       FROM auditoria_cit WHERE auditado_en > NOW()-($1||' days')::interval`, [dias]
    ),
    query<any>(
      `SELECT riesgo, COUNT(*)::int AS count
       FROM auditoria_cit WHERE auditado_en > NOW()-($1||' days')::interval
       GROUP BY riesgo ORDER BY count DESC`, [dias]
    ),
    query<any>(
      `SELECT UNNEST(anomalias) AS codigo, COUNT(*)::int AS count
       FROM auditoria_cit WHERE auditado_en > NOW()-($1||' days')::interval
       GROUP BY codigo ORDER BY count DESC LIMIT 8`, [dias]
    ),
  ])
  return { resumen, porRiesgo, topAnomalias }
}

export async function getHistorialAuditoriaInspector(inspectorId: string, limite = 20) {
  return query<any>(
    `SELECT id, cit_id, riesgo, score_riesgo, anomalias,
            dist_insp_taller_km, velocidad_kmh, cits_ultima_hora,
            hora_inspeccion, requiere_revision, resolucion, auditado_en
     FROM auditoria_cit WHERE inspector_id=$1
     ORDER BY auditado_en DESC LIMIT $2`,
    [inspectorId, limite]
  )
}
