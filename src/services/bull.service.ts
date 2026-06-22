// ─── RODAID · Queue System (BullMQ + Redis) ──────────────
// Sistema de colas para la validación diferida de 72 hs (Ley 9556)
// Queues: validar-cit · finalizar-cit · notificaciones · mantenimiento

import { Queue, Worker, Job, QueueEvents, UnrecoverableError } from 'bullmq'
import { getRedis } from '../config/redis'
import { env } from '../config/env'
import { query, queryOne } from '../config/database'
import { logger } from '../middleware/logger'

// ── Nombres canónicos de las colas ────────────────────────
export const Q = {
  VALIDAR_CIT:   'validar-cit',
  FINALIZAR_CIT: 'finalizar-cit',
  NOTIFICACION:  'notificacion',
  MANTENIMIENTO: 'mantenimiento',
} as const

// ── Tipos de los payloads ─────────────────────────────────
export type ValidarCITJob   = { citId: string; serial: string; intentos?: number }
export type FinalizarCITJob = { citId: string; propietarioWallet?: string }
export type NotificacionJob = { usuarioId: string; tipo: string; titulo: string; cuerpo: string; datos?: Record<string, unknown> }
export type MantenimientoJob= { tarea: 'expirar_cits' | 'limpiar_tokens' | 'purgar_logs' }

// ── Configuración BullMQ compartida ──────────────────────
const CONNECTION = { connection: { url: env.REDIS_URL, maxRetriesPerRequest: null } }
const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 7 * 86400, count: 1000 },  // conservar 7 días o 1000 jobs
  removeOnFail:     { age: 30 * 86400 },               // fallos conservados 30 días
}

// ── Instancias de colas y eventos ─────────────────────────
let queues: Record<string, Queue>               = {}
let workers: Record<string, Worker>             = {}
let events: Record<string, QueueEvents>         = {}

// ══════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════════════

export async function initBullMQ(): Promise<void> {
  logger.info('Iniciando sistema de colas BullMQ + Redis...')

  // ── Crear colas ───────────────────────────────────────
  for (const name of Object.values(Q)) {
    queues[name]     = new Queue(name, { ...CONNECTION, defaultJobOptions: DEFAULT_JOB_OPTIONS })
    events[name]     = new QueueEvents(name, CONNECTION)

    // Observadores de eventos para logging
    events[name].on('completed', ({ jobId }) => logger.debug({ jobId, queue: name }, 'Job completado'))
    events[name].on('failed',    ({ jobId, failedReason }) => logger.warn({ jobId, failedReason, queue: name }, 'Job fallido'))
    events[name].on('stalled',   ({ jobId }) => logger.warn({ jobId, queue: name }, 'Job estancado — se reintentará'))
  }

  // ── Registrar workers ─────────────────────────────────
  _registerValidarCITWorker()
  _registerFinalizarCITWorker()
  _registerNotificacionWorker()
  _registerMantenimientoWorker()

  // ── Programar jobs de mantenimiento recurrentes ───────
  await programarMantenimiento()

  logger.info({ queues: Object.values(Q) }, '✓ BullMQ iniciado · todos los workers activos')
}

// ══════════════════════════════════════════════════════════
// WORKER 1 — VALIDAR CIT (72 hs · cross-reference Ministerio)
// ══════════════════════════════════════════════════════════

function _registerValidarCITWorker() {
  workers[Q.VALIDAR_CIT] = new Worker<ValidarCITJob>(
    Q.VALIDAR_CIT,
    async (job: Job<ValidarCITJob>) => {
      const { citId, serial } = job.data
      logger.info({ citId, serial, jobId: job.id, attempt: job.attemptsMade + 1 }, 'Worker: iniciando validación CIT')

      // 1. Verificar que el CIT sigue PENDIENTE (puede haberse bloqueado por denuncia)
      const cit = await queryOne<{ id: string; estado: string; propietario_id: string }>(
        `SELECT c.id, c.estado, c.propietario_id
         FROM cits c
         JOIN validacion_queue vq ON vq.cit_id = c.id
         WHERE c.id = $1 AND vq.procesada_en IS NULL`,
        [citId]
      )

      if (!cit) {
        logger.info({ citId }, 'CIT ya procesado o no encontrado — job ignorado')
        return { resultado: 'ignorado', motivo: 'ya_procesado' }
      }

      if (cit.estado === 'BLOQUEADO') {
        await query(
          `UPDATE validacion_queue SET procesada_en=NOW(), resultado='rechazado',
           alerta_min_seg=TRUE, detalle_alerta=$2 WHERE cit_id=$1`,
          [citId, JSON.stringify({ motivo: 'DENUNCIA_PREVIA', procesadoEn: new Date().toISOString() })]
        )
        logger.info({ citId }, 'CIT bloqueado por denuncia — validación cancelada')
        return { resultado: 'cancelado', motivo: 'denuncia_previa' }
      }

      await job.updateProgress(10)

      // 2. Cross-reference con Ministerio de Seguridad Mendoza
      const resultadoMinSeg = await _crossReferenceMinSeg(serial, citId, job)
      await job.updateProgress(60)

      if (resultadoMinSeg.alertaActiva) {
        // Robo confirmado — bloquear y notificar
        await _rechazarCIT(citId, cit.propietario_id, resultadoMinSeg.tipoAlerta ?? 'ALERTA_MINSEG', job)
        await job.updateProgress(100)
        return { resultado: 'rechazado', alerta: resultadoMinSeg.tipoAlerta }
      }

      // 3. Sin alerta — encolar finalización (acuñar NFT en BFA)
      await query(
        `UPDATE validacion_queue SET procesada_en=NOW(), resultado='aprobado' WHERE cit_id=$1`,
        [citId]
      )
      await encolarFinalizar(citId)
      await job.updateProgress(100)

      logger.info({ citId, serial }, 'Validación aprobada — CIT encolado para finalizar')
      return { resultado: 'aprobado' }
    },
    {
      ...CONNECTION,
      concurrency:  3,     // hasta 3 validaciones simultáneas
      limiter:      { max: 10, duration: 60_000 },   // max 10/min (respeta rate limit de Min.Seg)
    }
  )

  workers[Q.VALIDAR_CIT].on('failed', (job, err) => {
    logger.error({ jobId: job?.id, citId: job?.data?.citId, err: err.message }, 'Validación CIT fallida')
  })
}

// ══════════════════════════════════════════════════════════
// WORKER 2 — FINALIZAR CIT (acuñar NFT en BFA)
// ══════════════════════════════════════════════════════════

function _registerFinalizarCITWorker() {
  workers[Q.FINALIZAR_CIT] = new Worker<FinalizarCITJob>(
    Q.FINALIZAR_CIT,
    async (job: Job<FinalizarCITJob>) => {
      const { citId, propietarioWallet } = job.data
      logger.info({ citId, jobId: job.id }, 'Worker: finalizando CIT · acuñando NFT en BFA')

      const cit = await queryOne<{ id: string; estado: string; hash_sha256: string; numero_cit: string; propietario_id: string; bicicleta_numero_serie?: string }>(
        `SELECT id, estado, hash_sha256, numero_cit, propietario_id FROM cits WHERE id=$1`,
        [citId]
      )

      if (!cit) throw new UnrecoverableError(`CIT ${citId} no encontrado — no reintentable`)
      if (cit.estado !== 'PENDIENTE') {
        logger.info({ citId, estado: cit.estado }, 'CIT ya no está PENDIENTE — saltando')
        return { resultado: 'saltado', estado: cit.estado }
      }

      await job.updateProgress(20)

      // Acuñar NFT en BFA — importación dinámica para evitar circular
      const { bfaService } = await import('./bfa.service')
      const wallet = propietarioWallet ?? '0x0000000000000000000000000000000000000001'

      let bfaResult
      try {
        bfaResult = await bfaService.mint(wallet, cit.hash_sha256, cit.numero_cit, cit.bicicleta_numero_serie ?? '')
      } catch (err) {
        // BFA errors son reintentables (red, gas, etc.)
        throw new Error(`BFA mint falló: ${(err as Error).message}`)
      }

      await job.updateProgress(80)

      const ahora  = new Date()
      const vence  = new Date(ahora); vence.setFullYear(vence.getFullYear() + 1)

      await query(
        `UPDATE cits
         SET estado='ACTIVO', bfa_tx_hash=$2, nft_token_id=$3,
             fecha_emision=$4, fecha_vencimiento=$5, actualizado_en=NOW()
         WHERE id=$1`,
        [citId, bfaResult.txHash, bfaResult.tokenId, ahora, vence]
      )

      // Notificación al propietario
      await encolarNotificacion({
        usuarioId: cit.propietario_id,
        tipo:      'CIT_APROBADO',
        titulo:    `CIT ${cit.numero_cit} activado · NFT acuñado en BFA`,
        cuerpo:    'Tu Certificado de Identidad Técnica fue activado exitosamente. El NFT fue acuñado en la Blockchain Federal Argentina.',
        datos:     { citId, numeroCIT: cit.numero_cit, tokenId: bfaResult.tokenId, txHash: bfaResult.txHash },
      })

      await job.updateProgress(100)
      logger.info({ citId, tokenId: bfaResult.tokenId, txHash: bfaResult.txHash }, 'CIT finalizado · ACTIVO · NFT acuñado')
      return { resultado: 'activo', tokenId: bfaResult.tokenId, txHash: bfaResult.txHash }
    },
    {
      ...CONNECTION,
      concurrency: 1,   // serializado — evita doble mint en BFA
      limiter:     { max: 5, duration: 60_000 },
    }
  )
}

// ══════════════════════════════════════════════════════════
// WORKER 3 — NOTIFICACIONES (push + email + MxM)
// ══════════════════════════════════════════════════════════

function _registerNotificacionWorker() {
  workers[Q.NOTIFICACION] = new Worker<NotificacionJob>(
    Q.NOTIFICACION,
    async (job: Job<NotificacionJob>) => {
      const { usuarioId, tipo, titulo, cuerpo, datos } = job.data

      // Persistir en DB (canal interno)
      await query(
        `INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
         VALUES ($1, $2, $3, $4, $5)`,
        [usuarioId, tipo, titulo, cuerpo, JSON.stringify(datos ?? {})]
      )

      // FCM push (stub — conectar con firebase-admin cuando esté configurado)
      const deviceTokens = await query<{ token: string; plataforma: string }>(
        `SELECT token, plataforma FROM device_tokens WHERE usuario_id=$1`, [usuarioId]
      )
      if (deviceTokens.length > 0) {
        logger.debug({ usuarioId, tokens: deviceTokens.length, tipo }, 'FCM push [STUB]')
        // En producción: await fcmAdmin.sendMulticast({ tokens, notification: { title, body } })
      }

      return { notified: true, channels: ['db', deviceTokens.length > 0 ? 'fcm' : null].filter(Boolean) }
    },
    { ...CONNECTION, concurrency: 10 }
  )
}

// ══════════════════════════════════════════════════════════
// WORKER 4 — MANTENIMIENTO (cron: expirar CITs, limpiar tokens)
// ══════════════════════════════════════════════════════════

function _registerMantenimientoWorker() {
  workers[Q.MANTENIMIENTO] = new Worker<MantenimientoJob>(
    Q.MANTENIMIENTO,
    async (job: Job<MantenimientoJob>) => {
      const { tarea } = job.data

      if (tarea === 'expirar_cits') {
        const expired = await query<{ count: string }>(
          `WITH exp AS (
             UPDATE cits SET estado='EXPIRADO', actualizado_en=NOW()
             WHERE estado='ACTIVO' AND fecha_vencimiento < NOW()
             RETURNING id
           ) SELECT COUNT(*)::text AS count FROM exp`
        )
        const n = parseInt(expired[0]?.count ?? '0')
        if (n > 0) logger.info({ count: n }, `Mantenimiento: ${n} CITs expirados automáticamente`)
        return { tarea, expirados: n }
      }

      if (tarea === 'limpiar_tokens') {
        const deleted = await query<{ count: string }>(
          `WITH del AS (
             DELETE FROM refresh_tokens WHERE expires_at < NOW() RETURNING id
           ) SELECT COUNT(*)::text AS count FROM del`
        )
        const n = parseInt(deleted[0]?.count ?? '0')
        if (n > 0) logger.info({ count: n }, `Mantenimiento: ${n} refresh tokens expirados eliminados`)
        return { tarea, eliminados: n }
      }

      return { tarea, resultado: 'no_reconocida' }
    },
    { ...CONNECTION, concurrency: 1 }
  )
}

// ══════════════════════════════════════════════════════════
// HELPER — Cross-reference Ministerio de Seguridad Mendoza
// ══════════════════════════════════════════════════════════

async function _crossReferenceMinSeg(
  serial: string,
  citId: string,
  job: Job
): Promise<{ alertaActiva: boolean; tipoAlerta?: string }> {
  await job.updateProgress(30)

  // En producción: fetch(env.MINSEG_API_URL + '/cross-reference', { method:'POST', ... })
  // Con mTLS y certificado clientAuth del Ministerio
  if (env.MINSEG_API_URL && env.MINSEG_API_KEY) {
    try {
      const res = await fetch(`${env.MINSEG_API_URL}/api/v1/cross-reference`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.MINSEG_API_KEY}` },
        body:    JSON.stringify({ serial, citId, fuente: 'RODAID' }),
        signal:  AbortSignal.timeout(10_000),  // timeout de 10 s
      })
      if (res.ok) {
        const data = await res.json() as { alertaActiva: boolean; tipoAlerta?: string }
        await job.updateProgress(50)
        return data
      }
    } catch (err) {
      logger.warn({ err, serial }, 'Min.Seg API no respondió — asumiendo sin alerta')
    }
  }

  // STUB: serial que empiece con 'ROBADO-' → alerta activa (para pruebas)
  const alertaActiva = serial.startsWith('ROBADO-')
  logger.warn({ serial, alertaActiva }, 'MINSEG STUB — cruce simulado')
  await job.updateProgress(50)
  return { alertaActiva, tipoAlerta: alertaActiva ? 'DENUNCIA_ROBO_ACTIVA' : undefined }
}

async function _rechazarCIT(
  citId: string, propietarioId: string, tipoAlerta: string, job: Job
): Promise<void> {
  await query(`UPDATE cits SET estado='RECHAZADO', actualizado_en=NOW() WHERE id=$1`, [citId])
  await query(
    `UPDATE validacion_queue
     SET procesada_en=NOW(), resultado='rechazado', alerta_min_seg=TRUE,
         detalle_alerta=$2
     WHERE cit_id=$1`,
    [citId, JSON.stringify({ tipoAlerta, ts: new Date().toISOString() })]
  )
  // Notificar al propietario
  await encolarNotificacion({
    usuarioId: propietarioId,
    tipo:      'CIT_RECHAZADO',
    titulo:    'CIT rechazado · Alerta de seguridad',
    cuerpo:    'Tu CIT fue rechazado porque el rodado figura en la base de denuncias del Ministerio de Seguridad de Mendoza. Tu información fue remitida a las autoridades.',
    datos:     { citId, tipoAlerta },
  })
  await job.updateProgress(90)
  logger.warn({ citId, tipoAlerta }, 'CIT rechazado por alerta del Ministerio')
}

// ══════════════════════════════════════════════════════════
// API PÚBLICA — Encolar trabajos
// ══════════════════════════════════════════════════════════

// Encolar validación 72 hs después del inicio del CIT
export async function encolarValidacion(citId: string, serial: string, venceEn: Date): Promise<string> {
  const q = queues[Q.VALIDAR_CIT]
  if (!q) throw new Error('Queue no inicializada')

  const delay = Math.max(0, venceEn.getTime() - Date.now())

  const job = await q.add(
    `validar:${citId}`,
    { citId, serial } satisfies ValidarCITJob,
    {
      delay,                  // ms hasta que se ejecuta
      attempts: 5,
      backoff:  { type: 'exponential', delay: 300_000 },  // 5 min, 10 min, 20 min...
      jobId:    `validar-${citId}`,    // idempotente: no duplica si ya existe
    }
  )

  logger.info({
    citId, serial, jobId: job.id,
    ejecutaEn: venceEn.toISOString(),
    delayHs:   (delay / 3600000).toFixed(1),
  }, 'Validación CIT encolada en BullMQ')

  return job.id!
}

// Encolar finalización post-validación
export async function encolarFinalizar(citId: string, wallet?: string): Promise<string> {
  const q = queues[Q.FINALIZAR_CIT]
  if (!q) throw new Error('Queue no inicializada')

  const job = await q.add(
    `finalizar:${citId}`,
    { citId, propietarioWallet: wallet } satisfies FinalizarCITJob,
    {
      attempts: 5,
      backoff:  { type: 'exponential', delay: 60_000 },   // 1 min, 2 min, 4 min...
      priority: 10,
      jobId:    `finalizar-${citId}`,
    }
  )
  return job.id!
}

// Encolar notificación
export async function encolarNotificacion(payload: NotificacionJob): Promise<void> {
  const q = queues[Q.NOTIFICACION]
  if (!q) return  // graceful si la queue no está lista
  await q.add('notif', payload, { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } })
}

// ══════════════════════════════════════════════════════════
// MANTENIMIENTO PROGRAMADO (cron via BullMQ repeatable jobs)
// ══════════════════════════════════════════════════════════

export async function programarMantenimiento(): Promise<void> {
  const q = queues[Q.MANTENIMIENTO]
  if (!q) return

  // Expirar CITs vencidos — cada día a las 03:00 hora Mendoza (06:00 UTC)
  await q.add('expirar_cits', { tarea: 'expirar_cits' } satisfies MantenimientoJob, {
    repeat:   { pattern: '0 6 * * *' },
    attempts: 3,
    jobId:    'cron-expirar-cits',
  })

  // Limpiar refresh tokens expirados — cada 6 horas
  await q.add('limpiar_tokens', { tarea: 'limpiar_tokens' } satisfies MantenimientoJob, {
    repeat:   { pattern: '0 */6 * * *' },
    attempts: 3,
    jobId:    'cron-limpiar-tokens',
  })

  logger.info('Mantenimiento programado: expirar_cits(diario) + limpiar_tokens(c/6h)')
}

// ══════════════════════════════════════════════════════════
// HEALTH + STATS
// ══════════════════════════════════════════════════════════

export async function getQueueStats() {
  const stats: Record<string, unknown> = {}
  for (const [name, q] of Object.entries(queues)) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      q.getWaitingCount(), q.getActiveCount(), q.getCompletedCount(),
      q.getFailedCount(),  q.getDelayedCount(),
    ])
    stats[name] = { waiting, active, completed, failed, delayed }
  }
  return stats
}

// ══════════════════════════════════════════════════════════
// SHUTDOWN
// ══════════════════════════════════════════════════════════

export async function closeBullMQ(): Promise<void> {
  logger.info('Cerrando workers BullMQ...')
  await Promise.all([
    ...Object.values(workers).map(w => w.close()),
...Object.values(events).map(e => e.close()),
    ...Object.values(queues).map(q => q.close()),
  ])
  logger.info('✓ BullMQ cerrado correctamente')
}
