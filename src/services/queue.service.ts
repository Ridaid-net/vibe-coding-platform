// ─── RODAID · Pipeline de Validación CIT — 72 horas ───────
//
// Flujo completo:
//   iniciarCIT()
//     → encolarValidacion(citId, venceEn)   // delay hasta 72 hs
//
//   [72 hs después] Job despertó:
//     → workerValidar(citId)
//         1. SET pipeline_estado = 'VALIDANDO'
//         2. Cross-reference Min.Seg (con retry hasta 3 veces)
//         3. Si RECHAZADO -> pipeline_estado = 'RECHAZADO' + notif
//         4. Si APROBADO  -> encolarFinalizar(citId)
//
//   [Segundos después] workerFinalizar(citId)
//         1. SET pipeline_estado = 'ACTIVANDO'
//         2. bfaService.mint() -> tokenId
//         3. SET estado='ACTIVO', pipeline_estado='ACTIVO'
//         4. Notificaciones al propietario
//
// Dead-letter:
//   Jobs que fallan 3+ veces -> pipeline_estado = 'ERROR_PIPELINE'
//   Admin puede reencolar manualmente via POST /admin/queue/retry/:jobId
//
// Cancelacion:
//   Si se denuncia la bici durante las 72 hs -> cancelarValidacion(citId)
//   El job queda como 'completed' con resultado CANCELADO
//
// Resiliencia:
//   Si Redis no esta disponible al iniciar, initQueue() NO lanza -
//   loguea el fallo y deja las colas en null. Los metodos publicos
//   (encolarValidacion, encolarFinalizar, etc.) devuelven un resultado
//   "degradado" en vez de tirar una excepcion no controlada, para que
//   el servidor HTTP pueda seguir arriba aunque el pipeline este caido.

import Bull, { Job, Queue, JobOptions } from 'bull'
import { env }                           from '../config/env'
import { log }                           from '../middleware/logger'
import { query, queryOne }               from '../config/database'

// ══════════════════════════════════════════════════════════
// REDIS + DEFAULTS
// ══════════════════════════════════════════════════════════

function parseRedisUrl(url = 'redis://127.0.0.1:6379') {
  const match = url.match(/redis:\/\/(?::(.+)@)?([^:]+):(\d+)/)
  return {
    host:     match?.[2] ?? '127.0.0.1',
    port:     parseInt(match?.[3] ?? '6379'),
    password: match?.[1] ?? undefined,
    maxRetriesPerRequest: 3,
    enableReadyCheck:     false,
    lazyConnect:          true,
  }
}

const REDIS_OPTS = {
  redis: parseRedisUrl(env.REDIS_URL),
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail:     { count: 200 },
  } as JobOptions,
}

// ══════════════════════════════════════════════════════════
// TIPOS DE PAYLOAD
// ══════════════════════════════════════════════════════════

export interface ValidarCITPayload {
  citId:            string
  intentoActual?:   number
  origenDelay?:     number
}

export interface FinalizarCITPayload {
  citId:             string
  propietarioWallet?: string
}

export interface NotifPayload {
  usuarioId: string; tipo: string
  titulo: string; cuerpo: string; datos?: Record<string, unknown>
}

// ══════════════════════════════════════════════════════════
// INSTANCIAS DE COLAS (Singleton)
// ══════════════════════════════════════════════════════════

let qValidar:   Queue<ValidarCITPayload>   | null = null
let qFinalizar: Queue<FinalizarCITPayload> | null = null
let qNotif:     Queue<NotifPayload>        | null = null
let qExpire:    Queue<Record<string, never>>| null = null
let initialized = false
let queueDisponible = false

// ══════════════════════════════════════════════════════════
// HELPERS — Pipeline state tracking
// ══════════════════════════════════════════════════════════

type PipelineEstado = 'BORRADOR' | 'PENDIENTE' | 'VALIDANDO' | 'ACTIVANDO'
                    | 'ACTIVO' | 'RECHAZADO' | 'CANCELADO' | 'ERROR_PIPELINE'

async function setPipelineEstado(
  citId:   string,
  estado:  PipelineEstado,
  entrada: Record<string, unknown> = {}
): Promise<void> {
  const logEntry = { estado, ts: new Date().toISOString(), ...entrada }
  await query(
    `UPDATE cits
     SET pipeline_estado = $2,
         pipeline_log    = pipeline_log || $3::jsonb,
         actualizado_en  = NOW()
     WHERE id = $1`,
    [citId, estado, JSON.stringify([logEntry])]
  )
  if (estado === 'PENDIENTE') {
    await query(`UPDATE cits SET pipeline_inicio=COALESCE(pipeline_inicio,NOW()) WHERE id=$1`, [citId]).catch(()=>{})
  }
  if (['ACTIVO','RECHAZADO','CANCELADO','ERROR_PIPELINE'].includes(estado)) {
    await query(`UPDATE cits SET pipeline_fin=NOW() WHERE id=$1`, [citId]).catch(()=>{})
  }
}

async function updateValidacionQueue(
  citId:    string,
  etapa:    string,
  jobId?:   string,
  error?:   string
): Promise<void> {
  await query(
    `UPDATE validacion_queue
     SET etapa         = $2,
         job_id        = COALESCE($3, job_id),
         job_intentos  = job_intentos + 1,
         job_error     = $4
     WHERE cit_id = $1`,
    [citId, etapa, jobId ?? null, error ?? null]
  ).catch(() => {})
}

// ══════════════════════════════════════════════════════════
// WORKER: VALIDAR CIT (72 hs despues)
// ══════════════════════════════════════════════════════════

async function processValidar(job: Job<ValidarCITPayload>): Promise<unknown> {
  const { citId } = job.data
  const attempt   = job.attemptsMade + 1

  log.queue.info({ citId, jobId: job.id, attempt }, 'Pipeline: etapa VALIDANDO')
  await job.progress(10)

  const cit = await queryOne<{
    estado: string; propietario_id: string; pipeline_estado: string
  }>(
    `SELECT c.estado, c.propietario_id, c.pipeline_estado
     FROM cits c WHERE c.id = $1`,
    [citId]
  )

  if (!cit) {
    log.queue.warn({ citId }, 'CIT no encontrado - job cancelado')
    return { resultado: 'CANCELADO', motivo: 'CIT no existe' }
  }

  if (cit.pipeline_estado === 'CANCELADO') {
    log.queue.info({ citId }, 'Pipeline cancelado por denuncia - job omitido')
    return { resultado: 'CANCELADO', motivo: 'Pipeline cancelado' }
  }

  if (cit.estado !== 'PENDIENTE') {
    log.queue.info({ citId, estado: cit.estado }, 'CIT ya no esta PENDIENTE - job omitido')
    return { resultado: 'OMITIDO', estadoActual: cit.estado }
  }

  await setPipelineEstado(citId, 'VALIDANDO', { jobId: String(job.id), intento: attempt })
  await updateValidacionQueue(citId, 'PROCESANDO', String(job.id))
  await job.progress(20)

  try {
    const { validarCIT } = await import('./cit.service')
    const resultado = await validarCIT(citId)
    await job.progress(70)

    log.queue.info({ citId, alertaActiva: resultado.alertaActiva, estado: resultado.estado }, 'Validacion Min.Seg completada')

    if (resultado.alertaActiva) {
      await setPipelineEstado(citId, 'RECHAZADO', {
        motivo: 'Alerta Ministerio de Seguridad',
        tipoAlerta: 'DENUNCIA_ROBO_ACTIVA',
      })
      await updateValidacionQueue(citId, 'RECHAZADO')

      const { notificarCITRechazado } = await import('./notif.service')
      const citData = await (await import('../config/database')).queryOne<{
        numero_cit: string; numero_serie: string; min_seg_expediente: string | null
      }>(
        `SELECT c.numero_cit, b.numero_serie, NULL AS min_seg_expediente
         FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id WHERE c.id=$1`,
        [citId]
      )
      await notificarCITRechazado({
        usuarioId:         cit.propietario_id,
        numeroCIT:         citData?.numero_cit ?? citId.slice(0, 8),
        serial:            citData?.numero_serie ?? 'N/D',
        motivo:            'Alerta del Ministerio de Seguridad Mendoza',
        minSegExpediente:  citData?.min_seg_expediente ?? undefined,
      }).catch(err => log.queue.warn({ citId, err: err.message }, 'Notif rechazo fallo'))
      await job.progress(100)
      return { resultado: 'RECHAZADO', alertaActiva: true }
    }

    await updateValidacionQueue(citId, 'APROBADO')

    const propietario = await queryOne<{ wallet_address: string | null }>(
      `SELECT u.wallet_address
       FROM cits c JOIN usuarios u ON u.id = c.propietario_id
       WHERE c.id = $1`,
      [citId]
    )

    await encolarFinalizar(citId, propietario?.wallet_address ?? undefined)
    await job.progress(100)

    log.queue.info({ citId }, 'Pipeline: validacion OK - acunacion encolada')
    return { resultado: 'APROBADO', aprobadoParaFinalizar: true }

  } catch (err) {
    const errMsg = (err as Error).message
    log.queue.error({ citId, attempt, errMsg }, 'Validacion fallo - reintentando')
    await updateValidacionQueue(citId, 'ERROR', undefined, errMsg)
    throw err
  }
}

// ══════════════════════════════════════════════════════════
// WORKER: FINALIZAR CIT (mint NFT en BFA)
// ══════════════════════════════════════════════════════════

async function processFinalizar(job: Job<FinalizarCITPayload>): Promise<unknown> {
  const { citId, propietarioWallet } = job.data
  const attempt = job.attemptsMade + 1

  log.queue.info({ citId, jobId: job.id, attempt }, 'Pipeline: etapa ACTIVANDO - acunando NFT en BFA')
  await job.progress(10)

  const cit = await queryOne<{ estado: string; pipeline_estado: string; nft_token_id: number | null }>(
    `SELECT estado, pipeline_estado, nft_token_id FROM cits WHERE id = $1`, [citId]
  )

  if (!cit || cit.pipeline_estado === 'CANCELADO') {
    log.queue.info({ citId, motivo: cit?.pipeline_estado }, 'Mint omitido - pipeline cancelado')
    return { resultado: 'OMITIDO', motivo: cit?.pipeline_estado ?? 'no encontrado' }
  }

  if (cit.estado === 'ACTIVO' && cit.nft_token_id) {
    log.queue.info({ citId, tokenId: cit.nft_token_id }, 'NFT ya acunado - job idempotente')
    await setPipelineEstado(citId, 'ACTIVO', { nota: 'ya_activo' })
    return { resultado: 'YA_ACTIVO', tokenId: cit.nft_token_id }
  }

  await setPipelineEstado(citId, 'ACTIVANDO', { jobId: String(job.id), intento: attempt })
  await job.progress(20)

  try {
    const { acuñarCITEnBFA } = await import('./bfa.mint.service')
    const mintResult = await acuñarCITEnBFA(citId, propietarioWallet)
    await job.progress(90)

    await setPipelineEstado(citId, 'ACTIVO', {
      tokenId:     mintResult.tokenId,
      txHash:      mintResult.txHash,
      blockNumber: mintResult.blockNumber,
      walletDestino: mintResult.walletDestino,
      custodial:   mintResult.esCustodial,
      indexado:    mintResult.indexado,
    })
    await job.progress(100)

    ;(async () => {
      const { notificarCITAprobado } = await import('./notif.service')
      const { queryOne: qone } = await import('../config/database')
      const citData = await qone<{
        numero_cit: string; propietario_id: string; numero_serie: string; fecha_vencimiento: Date | null
      }>(`SELECT c.numero_cit, c.propietario_id, b.numero_serie, c.fecha_vencimiento
          FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id WHERE c.id=$1`, [citId])
      if (citData) {
        const bfaExplorerUrl = `https://explorer.bfa.ar/tx/${mintResult.txHash}`
        await notificarCITAprobado({
          usuarioId:      citData.propietario_id,
          numeroCIT:      citData.numero_cit,
          serial:         citData.numero_serie,
          tokenId:        mintResult.tokenId,
          txHash:         mintResult.txHash,
          venceEn:        citData.fecha_vencimiento?.toISOString() ?? new Date(Date.now()+365*24*3600*1000).toISOString(),
          bfaExplorerUrl,
          esCustodial:    mintResult.esCustodial,
        }).catch(err => log.queue.warn({ citId, err: err.message }, 'Notif aprobado fallo'))
      }
    })()

    log.queue.info({
      citId,
      tokenId:     mintResult.tokenId,
      txHash:      mintResult.txHash,
      blockNumber: mintResult.blockNumber,
      gasUsed:     mintResult.gasUsed,
      indexado:    mintResult.indexado,
    }, 'Pipeline completado - CIT ACTIVO - NFT acunado en BFA')

    return {
      resultado:   'ACTIVO',
      tokenId:     mintResult.tokenId,
      txHash:      mintResult.txHash,
      blockNumber: mintResult.blockNumber,
      gasUsed:     mintResult.gasUsed,
      indexado:    mintResult.indexado,
    }

  } catch (err) {
    const errMsg = (err as Error).message
    const reintentable = (err as { reintentable?: boolean }).reintentable ?? true

    log.queue.error({ citId, attempt, errMsg, reintentable }, 'Acunacion BFA fallo')

    if (!reintentable && attempt >= (job.opts.attempts ?? 5)) {
      await setPipelineEstado(citId, 'ERROR_PIPELINE', { error: errMsg, reintentable: false })
    }

    throw err
  }
}

// ══════════════════════════════════════════════════════════
// INICIALIZACION DE COLAS Y WORKERS
// ══════════════════════════════════════════════════════════

function crearColaSegura<T>(nombre: string): Queue<T> | null {
  try {
    const q = new Bull<T>(nombre, REDIS_OPTS)
    return q
  } catch (err) {
    log.queue.error({ nombre, err: (err as Error).message }, `No se pudo crear la cola "${nombre}"`)
    return null
  }
}

function esperarListaOFalla(q: Queue<any> | null, timeoutMs = 5000): Promise<boolean> {
  if (!q) return Promise.resolve(false)
  return new Promise((resolve) => {
    let resuelto = false
    const finalizar = (ok: boolean) => {
      if (resuelto) return
      resuelto = true
      resolve(ok)
    }
    q.isReady().then(() => finalizar(true)).catch(() => finalizar(false))
    q.once('error', () => finalizar(false))
    setTimeout(() => finalizar(false), timeoutMs)
  })
}

export async function initQueue(): Promise<void> {
  if (initialized) return

  qValidar   = crearColaSegura<ValidarCITPayload>  ('rodaid:cit:validar')
  qFinalizar = crearColaSegura<FinalizarCITPayload>('rodaid:cit:finalizar')
  qNotif     = crearColaSegura<NotifPayload>        ('rodaid:notif')
  qExpire    = crearColaSegura<Record<string, never>>('rodaid:cit:expirar')

  for (const [nombre, q] of [
    ['validar', qValidar], ['finalizar', qFinalizar], ['notif', qNotif], ['expirar', qExpire],
  ] as const) {
    if (!q) continue
    q.on('error',   err => log.queue.error({ queue: nombre, err: err.message }, 'Queue error'))
    q.on('stalled', job => log.queue.warn({ queue: nombre, jobId: job?.id }, 'Job estancado'))
  }

  const validarListo = await esperarListaOFalla(qValidar)

  if (!validarListo) {
    log.queue.error(
      { redis: `${REDIS_OPTS.redis.host}:${REDIS_OPTS.redis.port}` },
      'Redis no disponible para colas - pipeline CIT deshabilitado (modo degradado)'
    )
    queueDisponible = false
    initialized = true
    return
  }

  queueDisponible = true

  try {
    qValidar?.process(2, processValidar)
    qFinalizar?.process(1, processFinalizar)

    qNotif?.process(5, async (job: Job<NotifPayload>) => {
      const { usuarioId, tipo, titulo } = job.data
      log.queue.debug({ usuarioId, tipo, titulo: titulo.slice(0, 40) }, 'Notif enviada')
      return { ok: true }
    })

    qExpire?.process(1, async (job: Job) => {
      log.queue.info({ jobId: job.id }, 'Expirar CITs vencidos')
      const result = await query<{ count: string }>(
        `WITH expired AS (
           UPDATE cits SET estado='EXPIRADO', actualizado_en=NOW()
           WHERE estado='ACTIVO' AND fecha_vencimiento < NOW()
           RETURNING id
         ) SELECT COUNT(*)::text AS count FROM expired`
      )
      const n = parseInt(result[0]?.count ?? '0')
      log.queue.info({ expiredCount: n }, `${n} CIT(s) expirado(s)`)
      return { expiredCount: n }
    })

    if (qExpire) {
      await qExpire.removeRepeatable({ cron: '0 3 * * *', tz: 'America/Argentina/Mendoza' }).catch(() => {})
      await qExpire.add({}, {
        repeat: { cron: '0 3 * * *', tz: 'America/Argentina/Mendoza' },
        jobId:  'cit-expiry-daily',
      }).catch(err => log.queue.warn({ err: err.message }, 'No se pudo programar el cron de expiracion'))
    }

    qValidar?.on('failed', async (job, err) => {
      log.queue.error({ jobId: job?.id, err: err.message, attempts: job?.attemptsMade }, 'Job validar FALLIDO definitivo')
      if (job?.attemptsMade >= (job?.opts?.attempts ?? 3) - 1 && job?.data?.citId) {
        await setPipelineEstado(job.data.citId, 'ERROR_PIPELINE', { error: err.message })
          .catch(() => {})
      }
    })

    qFinalizar?.on('failed', async (job, err) => {
      log.queue.error({ jobId: job?.id, err: err.message }, 'Job finalizar FALLIDO definitivo')
      if (job?.attemptsMade >= (job?.opts?.attempts ?? 3) - 1 && job?.data?.citId) {
        await setPipelineEstado(job.data.citId, 'ERROR_PIPELINE', { error: err.message })
          .catch(() => {})
      }
    })

    initialized = true
    log.queue.info({ redis: `${REDIS_OPTS.redis.host}:${REDIS_OPTS.redis.port}` }, 'Pipeline de validacion CIT iniciado')

  } catch (err) {
    log.queue.error({ err: (err as Error).message }, 'Error montando workers de cola - pipeline degradado')
    queueDisponible = false
    initialized = true
  }
}

// ══════════════════════════════════════════════════════════
// API PUBLICA — ENCOLAR TRABAJOS
// ══════════════════════════════════════════════════════════

export async function encolarValidacion(citId: string, venceEn: Date): Promise<string | undefined> {
  if (!queueDisponible || !qValidar) {
    log.queue.warn({ citId }, 'encolarValidacion omitido - queue no disponible (modo degradado)')
    await setPipelineEstado(citId, 'PENDIENTE', { motivo: 'queue_no_disponible' }).catch(() => {})
    return undefined
  }

  const delayMs = Math.max(0, venceEn.getTime() - Date.now())

  const job = await qValidar.add(
    { citId, origenDelay: delayMs },
    {
      delay:    delayMs,
      jobId:    `validar:${citId}`,
      priority: 5,
      attempts: 3,
      backoff:  { type: 'exponential', delay: 60000 },
    }
  )

  await setPipelineEstado(citId, 'PENDIENTE', { delayMs, venceEn: venceEn.toISOString() })
  await query(
    `UPDATE validacion_queue SET job_id=$2, etapa='ENCOLADO' WHERE cit_id=$1`,
    [citId, String(job.id)]
  ).catch(() => {})

  log.queue.info({
    citId, jobId: job.id,
    delay72hs: (delayMs / 3600000).toFixed(1) + ' hs',
    venceEn: venceEn.toISOString(),
  }, 'CIT encolado para validacion 72 hs')

  return String(job.id)
}

export async function encolarFinalizar(citId: string, propietarioWallet?: string): Promise<string | undefined> {
  if (!queueDisponible || !qFinalizar) {
    log.queue.warn({ citId }, 'encolarFinalizar omitido - queue no disponible (modo degradado)')
    return undefined
  }

  const job = await qFinalizar.add(
    { citId, propietarioWallet },
    {
      jobId:    `finalizar:${citId}`,
      priority: 10,
      attempts: 5,
      backoff:  { type: 'exponential', delay: 30000 },
    }
  )

  log.queue.info({ citId, jobId: job.id }, 'Acunacion NFT encolada')
  return String(job.id)
}

export async function cancelarValidacion(citId: string): Promise<{ cancelado: boolean; jobId?: string }> {
  if (!queueDisponible || !qValidar) return { cancelado: false }

  try {
    const job = await qValidar.getJob(`validar:${citId}`)
    if (!job) return { cancelado: false }

    const state = await job.getState()
    if (state === 'delayed' || state === 'waiting') {
      await job.remove()
      await setPipelineEstado(citId, 'CANCELADO', { motivo: 'Denuncia de robo registrada' })
      await query(
        `UPDATE validacion_queue SET etapa='CANCELADO', procesada_en=NOW() WHERE cit_id=$1`,
        [citId]
      ).catch(() => {})
      log.queue.info({ citId, jobId: job.id, state }, 'Job de validacion cancelado por denuncia')
      return { cancelado: true, jobId: String(job.id) }
    }

    await setPipelineEstado(citId, 'CANCELADO', { motivo: 'Denuncia durante procesamiento', state })
    return { cancelado: true, jobId: String(job.id) }

  } catch (err) {
    log.queue.warn({ citId, err: (err as Error).message }, 'cancelarValidacion error')
    return { cancelado: false }
  }
}

export async function encolarNotificacion(payload: NotifPayload): Promise<void> {
  if (!queueDisponible || !qNotif) { log.queue.warn('Queue notif no disponible'); return }
  await qNotif.add(payload, { attempts: 3, backoff: { type: 'fixed', delay: 10000 } }).catch(
    err => log.queue.warn({ err: err.message }, 'encolarNotificacion fallo')
  )
}

// ══════════════════════════════════════════════════════════
// MONITOREO ADMIN
// ══════════════════════════════════════════════════════════

export async function getQueueStats() {
  if (!queueDisponible || !qValidar || !qFinalizar) {
    return { error: 'Queues no inicializadas (modo degradado - Redis no disponible)' }
  }

  const [vCounts, fCounts] = await Promise.all([
    qValidar.getJobCounts(),
    qFinalizar.getJobCounts(),
  ])

  const pipelineStats = await query<{ pipeline_estado: string; count: string }>(
    `SELECT pipeline_estado, COUNT(*)::text AS count
     FROM cits WHERE pipeline_estado IS NOT NULL
     GROUP BY pipeline_estado ORDER BY pipeline_estado`
  )

  return {
    queues: {
      'rodaid:cit:validar':   vCounts,
      'rodaid:cit:finalizar': fCounts,
    },
    pipeline: Object.fromEntries(pipelineStats.map(r => [r.pipeline_estado, parseInt(r.count)])),
  }
}

export async function getJobsPendientes() {
  if (!queueDisponible || !qValidar || !qFinalizar) return []

  const [delayed, waiting] = await Promise.all([
    qValidar.getDelayed(0, 50),
    qValidar.getWaiting(0, 50),
  ])

  const jobs = [...delayed, ...waiting]
  return Promise.all(jobs.map(async job => {
    const state = await job.getState()
    return {
      jobId:      String(job.id),
      citId:      job.data.citId,
      estado:     state,
      procesadoEn: new Date(job.timestamp + (job.opts.delay ?? 0)).toISOString(),
      intentos:   job.attemptsMade,
    }
  }))
}

export async function reintentarJob(jobId: string): Promise<{ ok: boolean; message: string }> {
  if (!queueDisponible || !qValidar || !qFinalizar) return { ok: false, message: 'Queues no inicializadas' }

  for (const q of [qValidar, qFinalizar]) {
    const job = await q.getJob(jobId)
    if (job) {
      await job.retry()
      return { ok: true, message: `Job ${jobId} reencolado` }
    }
  }
  return { ok: false, message: `Job ${jobId} no encontrado` }
}

export async function limpiarCola(nombre: 'validar' | 'finalizar' | 'notif'): Promise<{ ok: boolean }> {
  const map = { validar: qValidar, finalizar: qFinalizar, notif: qNotif }
  const q = map[nombre]
  if (!q) return { ok: false }
  await q.clean(0, 'completed')
  await q.clean(0, 'failed')
  return { ok: true }
}

export function queueEstaDisponible(): boolean {
  return queueDisponible
}