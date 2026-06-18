// ─── RODAID · Validación CIT en Tiempo Real ───────────────
//
// Emite el estado de validación del CIT en tiempo real
// usando Server-Sent Events (SSE) y Redis Pub/Sub.
//
// ══ ARQUITECTURA ══════════════════════════════════════════
//
//   Cliente                 API                      Redis
//     │                      │                         │
//     │── GET /cit/:id/rt ──►│                         │
//     │                      │── SUBSCRIBE cit:{id} ──►│
//     │◄── SSE stream ───────│                         │
//     │                      │                         │
//     │   (evento en DB)     │                         │
//     │                      │◄── PUBLISH cit:{id} ────│
//     │◄── data: {...} ──────│                         │
//     │                      │                         │
//     │── GET /cit/:id/poll ─►│  (polling fallback)
//     │◄── JSON snapshot ────│
//
// ══ CANAL REDIS ═══════════════════════════════════════════
//
//   cit:validacion:{citId}   → eventos del CIT específico
//   cit:validacion:global    → todos los CITs (admin dashboard)
//
// ══ EVENTO SSE ════════════════════════════════════════════
//
//   event: cit_validacion
//   data: {
//     citId, numeroCIT, fase, progresoPct,
//     diasRestantes, horasRestantes, minutosRestantes,
//     fases: { fotos, puntuacion, firma, tasa, bfa },
//     alerta?: { tipo, mensaje },
//     timestamp
//   }
//
// ══ FASES Y PROGRESO ══════════════════════════════════════
//
//   INICIADA         0%   → inspector creó el CIT
//   FOTOS_OK        20%   → fotos subidas y verificadas
//   PUNTUACION_OK   40%   → inspección ≥ 16/20 puntos
//   FIRMA_PENDIENTE 50%   → payload firmado con PKCS#12
//   TASA_PENDIENTE  60%   → pendiente de pago MxM
//   BFA_PENDING     80%   → pago aprobado, mint en progreso
//   COMPLETADA     100%   → NFT minteado, CIT vigente
//   RECHAZADA        —    → inspector rechazó o tasa falló
//
// ══ POLLING FALLBACK ══════════════════════════════════════
//
//   GET /cit/:id/poll    → snapshot JSON instantáneo
//   Recomendado: 10s interval, exponential backoff en error

import crypto              from 'crypto'
import type { Response }   from 'express'
import { query, queryOne } from '../config/database'
import { getRedis }        from '../config/redis'
import { log }             from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface ValidacionSnapshot {
  citId:           string
  numeroCIT:       string
  fase:            string
  progresoPct:     number
  vigente:         boolean
  // Tiempo restante en la ventana de 72h
  deadline72h:     string
  diasRestantes:   number
  horasRestantes:  number
  minutosRestantes:number
  porcentajeTiempo:number    // % del deadline consumido (0–100)
  // Fases completadas
  fases: {
    iniciada:    FaseEstado
    fotos:       FaseEstado
    puntuacion:  FaseEstado
    firma:       FaseEstado
    tasa:        FaseEstado
    bfa:         FaseEstado
  }
  // Info del CIT
  cit: {
    estadoBase:   string
    puntosTotal:  number
    fotosCount:   number
    hashSHA256:   string | null
    nftTokenId:   string | null
    tasaPagada:   boolean
  }
  // Alerta si aplica
  alerta?: {
    tipo:    'DEADLINE_PROXIMO' | 'DEADLINE_VENCIDO' | 'RECHAZADO' | 'BLOQUEADO'
    mensaje: string
    urgente: boolean
  }
  timestamp: string
}

export interface FaseEstado {
  completada:  boolean
  ts?:         string
  label:       string
  descripcion: string
}

const CANAL_CIT    = (citId: string) => `cit:validacion:${citId}`
const CANAL_GLOBAL = 'cit:validacion:global'

// ══════════════════════════════════════════════════════════
// SNAPSHOT — estado completo en un instante
// ══════════════════════════════════════════════════════════

export async function getValidacionSnapshot(
  citIdOrNumero: string
): Promise<ValidacionSnapshot | null> {

  const isUUID = /^[0-9a-f-]{36}$/i.test(citIdOrNumero)

  const row = await queryOne<any>(`
    SELECT
      v.id::text AS val_id,
      v.fase, v.progreso_pct,
      v.ts_iniciada::text, v.ts_fotos_ok::text,
      v.ts_puntuacion::text, v.ts_firma::text,
      v.ts_tasa::text, v.ts_bfa::text,
      v.ts_completada::text,
      v.deadline_72h::text,
      -- CIT
      c.id::text AS cit_id,
      c.numero_cit,
      c.estado    AS cit_estado,
      c.puntos_total,
      c.fotos_count,
      c.hash_sha256,
      c.nft_token_id,
      c.tasa_pagada
    FROM cit_validaciones_rt v
    JOIN cits c ON c.id = v.cit_id
    WHERE v.activo = TRUE
      AND ${isUUID
        ? `(v.cit_id = $1::uuid OR c.id = $1::uuid)`
        : `c.numero_cit = $1`}
    ORDER BY v.creado_en DESC LIMIT 1
  `, [citIdOrNumero])

  // Si no hay validación activa pero el CIT existe, construir snapshot del CIT
  if (!row) {
    const cit = await queryOne<any>(`
      SELECT id::text, numero_cit, estado, puntos_total, fotos_count,
             hash_sha256, nft_token_id, tasa_pagada, creado_en::text
      FROM cits
      WHERE ${isUUID ? 'id = $1::uuid' : 'numero_cit = $1'}
    `, [citIdOrNumero])

    if (!cit) return null

    // Derivar fase y progreso desde el estado del CIT
    const { fase, progresoPct } = inferirFaseDesdeCIT(cit)
    const deadline72h  = new Date(new Date(cit.creado_en).getTime() + 72 * 3_600_000)
    const { dias, horas, minutos, pctTiempo } = calcularTiempoRestante(deadline72h.toISOString())

    return buildSnapshot({
      citId:        cit.id,
      numeroCIT:    cit.numero_cit,
      fase,
      progresoPct,
      deadline72h:  deadline72h.toISOString(),
      tsIniciada:   cit.creado_en,
      citEstado:    cit.estado,
      puntosTotal:  cit.puntos_total,
      fotosCount:   cit.fotos_count,
      hashSHA256:   cit.hash_sha256,
      nftTokenId:   cit.nft_token_id,
      tasaPagada:   cit.tasa_pagada,
      dias, horas, minutos, pctTiempo,
    })
  }

  const { dias, horas, minutos, pctTiempo } = calcularTiempoRestante(row.deadline_72h)

  return buildSnapshot({
    citId:       row.cit_id,
    numeroCIT:   row.numero_cit,
    fase:        row.fase,
    progresoPct: row.progreso_pct,
    deadline72h: row.deadline_72h,
    tsIniciada:  row.ts_iniciada,
    tsFotosOk:   row.ts_fotos_ok,
    tsPuntuacion:row.ts_puntuacion,
    tsFirma:     row.ts_firma,
    tsTasa:      row.ts_tasa,
    tsBfa:       row.ts_bfa,
    tsCompletada:row.ts_completada,
    citEstado:   row.cit_estado,
    puntosTotal: row.puntos_total,
    fotosCount:  row.fotos_count,
    hashSHA256:  row.hash_sha256,
    nftTokenId:  row.nft_token_id,
    tasaPagada:  row.tasa_pagada,
    dias, horas, minutos, pctTiempo,
  })
}

// ══════════════════════════════════════════════════════════
// SSE — endpoint de streaming
// ══════════════════════════════════════════════════════════

export function sseValidacion(citId: string, res: Response): () => void {
  // Headers SSE
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',       // NGINX: desactivar buffer
  })
  res.flushHeaders()

  const clientId = crypto.randomUUID().slice(0, 8)
  let closed     = false

  const emit = (evento: string, data: unknown) => {
    if (closed) return
    try {
      res.write(`event: ${evento}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
      ;(res as any).flush?.()
    } catch { closed = true }
  }

  // 1. Snapshot inicial inmediato
  getValidacionSnapshot(citId).then(snap => {
    if (snap) emit('cit_validacion', snap)
    else emit('error', { mensaje: 'CIT no encontrado', citId })
  }).catch(() => {})

  // 2. Heartbeat cada 25s (evita timeout de proxies)
  const heartbeat = setInterval(() => {
    if (!closed) {
      try { res.write(`: heartbeat ${new Date().toISOString()}\n\n`) }
      catch { closed = true }
    }
  }, 25_000)

  // 3. Suscribir a Redis Pub/Sub
  const redis = getRedis()
  const sub   = redis.duplicate()
  const canal = CANAL_CIT(citId)

  sub.subscribe(canal, CANAL_GLOBAL).catch(() => {})
  sub.on('message', (ch: string, msg: string) => {
    if (closed) return
    try {
      const data = JSON.parse(msg)
      // Solo pasar mensajes del CIT correcto en el canal global
      if (ch === CANAL_GLOBAL && data.citId !== citId) return
      emit('cit_validacion', data)
    } catch { /* JSON inválido */ }
  })

  log.escrow.info({ citId: citId.slice(0, 8), clientId }, '📡 SSE cliente conectado')

  // 4. Cleanup al cerrar la conexión
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    sub.unsubscribe().catch(() => {})
    sub.quit().catch(() => {})
    log.escrow.info({ citId: citId.slice(0, 8), clientId }, '📡 SSE cliente desconectado')
  }

  res.on('close',   cleanup)
  res.on('finish',  cleanup)
  res.on('error',   cleanup)

  return cleanup
}

// ══════════════════════════════════════════════════════════
// PUBLISH — emitir evento a todos los clientes suscritos
// ══════════════════════════════════════════════════════════

export async function publicarEventoValidacion(
  citId:    string,
  fase:     string,
  opts?: { progresoPct?: number; tasaPagada?: boolean; nftTokenId?: string }
): Promise<void> {
  const redis = getRedis()

  // Actualizar DB
  const sets: string[] = ['fase=$2', 'actualizado_en=NOW()']
  const params: unknown[] = [citId, fase]

  if (opts?.progresoPct !== undefined) {
    params.push(opts.progresoPct); sets.push(`progreso_pct=$${params.length}`)
  }
  const tsMap: Record<string, string> = {
    FOTOS_OK:        'ts_fotos_ok',
    PUNTUACION_OK:   'ts_puntuacion',
    FIRMA_PENDIENTE: 'ts_firma',
    TASA_PENDIENTE:  'ts_tasa',
    BFA_PENDING:     'ts_bfa',
    COMPLETADA:      'ts_completada',
  }
  if (tsMap[fase]) sets.push(`${tsMap[fase]}=NOW()`)
  if (fase === 'COMPLETADA') sets.push(`activo=FALSE`)

  await query(
    `UPDATE cit_validaciones_rt SET ${sets.join(',')}
     WHERE cit_id=$1::uuid AND activo=TRUE`,
    params
  ).catch(() => {})

  // Construir snapshot y publicar
  const snap = await getValidacionSnapshot(citId).catch(() => null)
  if (!snap) return

  const msg = JSON.stringify(snap)
  await Promise.all([
    redis.publish(CANAL_CIT(citId), msg),
    redis.publish(CANAL_GLOBAL, msg),
  ]).catch(() => {})

  log.escrow.info({ citId: citId.slice(0, 8), fase, progreso: snap.progresoPct },
    `📡 Evento SSE publicado: ${fase}`)
}

// ══════════════════════════════════════════════════════════
// CREAR VALIDACIÓN (llamar desde iniciarCIT)
// ══════════════════════════════════════════════════════════

export async function crearValidacionRT(opts: {
  citId:        string
  propietarioId:string
  inspectorId?: string
}): Promise<{ validacionId: string; deadline72h: Date }> {
  const deadline72h = new Date(Date.now() + 72 * 3_600_000)

  const row = await queryOne<{ id: string }>(
    `INSERT INTO cit_validaciones_rt
       (cit_id, propietario_id, inspector_id, fase, progreso_pct, deadline_72h)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'INICIADA', 0, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [opts.citId, opts.propietarioId, opts.inspectorId ?? null, deadline72h]
  )

  // Publicar evento inicial
  await publicarEventoValidacion(opts.citId, 'INICIADA', { progresoPct: 0 })

  return { validacionId: row!.id, deadline72h }
}

// ══════════════════════════════════════════════════════════
// ADMIN — listar validaciones activas (72h dashboard)
// ══════════════════════════════════════════════════════════

export async function getValidacionesActivas(limite = 20) {
  return query<any>(`
    SELECT
      v.id::text, v.fase, v.progreso_pct, v.deadline_72h::text,
      c.id::text AS cit_id, c.numero_cit, c.estado AS cit_estado,
      c.puntos_total, c.tasa_pagada,
      b.marca, b.modelo, b.numero_serie,
      u.nombre AS propietario_nombre,
      EXTRACT(EPOCH FROM (v.deadline_72h - NOW()))/3600 AS horas_restantes
    FROM cit_validaciones_rt v
    JOIN cits        c ON c.id = v.cit_id
    JOIN bicicletas  b ON b.id = c.bicicleta_id
    JOIN usuarios    u ON u.id = v.propietario_id
    WHERE v.activo = TRUE
    ORDER BY v.deadline_72h ASC
    LIMIT $1
  `, [limite])
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

function calcularTiempoRestante(deadlineISO: string) {
  const ahora      = Date.now()
  const deadline   = new Date(deadlineISO).getTime()
  const inicio72h  = deadline - 72 * 3_600_000
  const restante   = Math.max(0, deadline - ahora)
  const consumido  = ahora - inicio72h
  const total72h   = 72 * 3_600_000

  return {
    dias:       Math.floor(restante / 86_400_000),
    horas:      Math.floor((restante % 86_400_000) / 3_600_000),
    minutos:    Math.floor((restante % 3_600_000) / 60_000),
    pctTiempo:  Math.min(100, Math.round(consumido / total72h * 100)),
    vencido:    restante === 0,
  }
}

function inferirFaseDesdeCIT(cit: any): { fase: string; progresoPct: number } {
  if (cit.estado === 'RECHAZADO') return { fase: 'RECHAZADA',      progresoPct: 0  }
  if (cit.nft_token_id)           return { fase: 'COMPLETADA',     progresoPct: 100}
  if (cit.estado === 'ACTIVO' && cit.tasa_pagada) return { fase: 'BFA_PENDING', progresoPct: 80 }
  if (cit.estado === 'ACTIVO')    return { fase: 'TASA_PENDIENTE', progresoPct: 60 }
  if (cit.estado === 'PAGO_PENDIENTE') return { fase: 'TASA_PENDIENTE', progresoPct: 60 }
  if (cit.puntos_total >= 16)     return { fase: 'PUNTUACION_OK',  progresoPct: 40 }
  if (cit.fotos_count >= 1)       return { fase: 'FOTOS_OK',       progresoPct: 20 }
  return { fase: 'INICIADA', progresoPct: 0 }
}

function buildSnapshot(d: {
  citId: string; numeroCIT: string; fase: string; progresoPct: number
  deadline72h: string; tsIniciada?: string; tsFotosOk?: string; tsPuntuacion?: string
  tsFirma?: string; tsTasa?: string; tsBfa?: string; tsCompletada?: string
  citEstado: string; puntosTotal: number; fotosCount: number
  hashSHA256: string | null; nftTokenId: string | null; tasaPagada: boolean
  dias: number; horas: number; minutos: number; pctTiempo: number
}): ValidacionSnapshot {
  const vencido = new Date(d.deadline72h) < new Date()

  let alerta: ValidacionSnapshot['alerta'] | undefined
  if (d.citEstado === 'RECHAZADO' || d.fase === 'RECHAZADA') {
    alerta = { tipo: 'RECHAZADO', mensaje: 'El CIT fue rechazado.', urgente: true }
  } else if (vencido) {
    alerta = { tipo: 'DEADLINE_VENCIDO', mensaje: 'Venció el plazo de 72h. Se requiere nueva inspección.', urgente: true }
  } else if (d.pctTiempo >= 85) {
    const h = d.dias * 24 + d.horas
    alerta = { tipo: 'DEADLINE_PROXIMO', mensaje: `Quedan ${h}h ${d.minutos}min para completar la validación.`, urgente: d.pctTiempo >= 95 }
  }

  const faseLabel = (fase: string, ok: boolean): FaseEstado => {
    const MAP: Record<string, [string, string]> = {
      fotos:       ['Fotos subidas',         'Al menos 1 foto del rodado verificada'],
      puntuacion:  ['Puntuación aprobada',   'Inspección ≥ 16/20 puntos'],
      firma:       ['Firma digital',         'Payload firmado con certificado PKCS#12'],
      tasa:        ['Tasa MxM pagada',       'Pago de $3.000 ARS acreditado por Gobierno de Mendoza'],
      bfa:         ['NFT minteado en BFA',   'Token ERC-721 acuñado en Blockchain Federal Argentina'],
      iniciada:    ['Inspección iniciada',   'Inspector registró el CIT en el sistema RODAID'],
    }
    const [label, descripcion] = MAP[fase] ?? [fase, '']
    return { completada: ok, label, descripcion }
  }

  return {
    citId:           d.citId,
    numeroCIT:       d.numeroCIT,
    fase:            d.fase,
    progresoPct:     d.progresoPct,
    vigente:         d.citEstado === 'ACTIVO' && !vencido,
    deadline72h:     d.deadline72h,
    diasRestantes:   d.dias,
    horasRestantes:  d.horas,
    minutosRestantes:d.minutos,
    porcentajeTiempo:d.pctTiempo,
    fases: {
      iniciada:   { ...faseLabel('iniciada', true),              ts: d.tsIniciada,   completada: true },
      fotos:      { ...faseLabel('fotos',    !!d.tsFotosOk  || d.fotosCount > 0),   ts: d.tsFotosOk   ?? undefined },
      puntuacion: { ...faseLabel('puntuacion',!!d.tsPuntuacion || d.puntosTotal >= 16), ts: d.tsPuntuacion ?? undefined },
      firma:      { ...faseLabel('firma',    !!d.tsFirma    || !!d.hashSHA256),      ts: d.tsFirma     ?? undefined },
      tasa:       { ...faseLabel('tasa',     !!d.tsTasa     || d.tasaPagada),        ts: d.tsTasa      ?? undefined },
      bfa:        { ...faseLabel('bfa',      !!d.tsBfa      || !!d.nftTokenId),      ts: d.tsBfa       ?? undefined },
    },
    cit: {
      estadoBase:  d.citEstado,
      puntosTotal: d.puntosTotal,
      fotosCount:  d.fotosCount,
      hashSHA256:  d.hashSHA256,
      nftTokenId:  d.nftTokenId,
      tasaPagada:  d.tasaPagada,
    },
    alerta,
    timestamp: new Date().toISOString(),
  }
}
