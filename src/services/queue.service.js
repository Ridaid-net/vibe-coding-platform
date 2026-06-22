"use strict";
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
//         3. Si RECHAZADO → pipeline_estado = 'RECHAZADO' + notif
//         4. Si APROBADO  → encolarFinalizar(citId)
//
//   [Segundos después] workerFinalizar(citId)
//         1. SET pipeline_estado = 'ACTIVANDO'
//         2. bfaService.mint() → tokenId
//         3. SET estado='ACTIVO', pipeline_estado='ACTIVO'
//         4. Notificaciones al propietario
//
// Dead-letter:
//   Jobs que fallan 3+ veces → pipeline_estado = 'ERROR_PIPELINE'
//   Admin puede reencolar manualmente via POST /admin/queue/retry/:jobId
//
// Cancelación:
//   Si se denuncia la bici durante las 72 hs → cancelarValidacion(citId)
//   El job queda como 'completed' con resultado CANCELADO
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initQueue = initQueue;
exports.encolarValidacion = encolarValidacion;
exports.encolarFinalizar = encolarFinalizar;
exports.cancelarValidacion = cancelarValidacion;
exports.encolarNotificacion = encolarNotificacion;
exports.getQueueStats = getQueueStats;
exports.getJobsPendientes = getJobsPendientes;
exports.reintentarJob = reintentarJob;
exports.limpiarCola = limpiarCola;
const bull_1 = __importDefault(require("bull"));
const env_1 = require("../config/env");
const logger_1 = require("../middleware/logger");
const database_1 = require("../config/database");
// ══════════════════════════════════════════════════════════
// REDIS + DEFAULTS
// ══════════════════════════════════════════════════════════
function parseRedisUrl(url = 'redis://127.0.0.1:6379') {
    const match = url.match(/redis:\/\/(?::(.+)@)?([^:]+):(\d+)/);
    return {
        host: match?.[2] ?? '127.0.0.1',
        port: parseInt(match?.[3] ?? '6379'),
        password: match?.[1] ?? undefined,
        maxRetriesPerRequest: 3,
        enableReadyCheck: false,
        lazyConnect: true,
    };
}
const REDIS_OPTS = {
    redis: parseRedisUrl(env_1.env.REDIS_URL),
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
    },
};
// ══════════════════════════════════════════════════════════
// INSTANCIAS DE COLAS (Singleton)
// ══════════════════════════════════════════════════════════
let qValidar = null;
let qFinalizar = null;
let qNotif = null;
let qExpire = null;
let initialized = false;
async function setPipelineEstado(citId, estado, entrada = {}) {
    const logEntry = { estado, ts: new Date().toISOString(), ...entrada };
    await (0, database_1.query)(`UPDATE cits
     SET pipeline_estado = $2,
         pipeline_log    = pipeline_log || $3::jsonb,
         actualizado_en  = NOW()
     WHERE id = $1`, [citId, estado, JSON.stringify([logEntry])]);
    // Set timestamps separately to avoid type conflicts
    if (estado === 'PENDIENTE') {
        await (0, database_1.query)(`UPDATE cits SET pipeline_inicio=COALESCE(pipeline_inicio,NOW()) WHERE id=$1`, [citId]).catch(() => { });
    }
    if (['ACTIVO', 'RECHAZADO', 'CANCELADO', 'ERROR_PIPELINE'].includes(estado)) {
        await (0, database_1.query)(`UPDATE cits SET pipeline_fin=NOW() WHERE id=$1`, [citId]).catch(() => { });
    }
}
async function updateValidacionQueue(citId, etapa, jobId, error) {
    await (0, database_1.query)(`UPDATE validacion_queue
     SET etapa         = $2,
         job_id        = COALESCE($3, job_id),
         job_intentos  = job_intentos + 1,
         job_error     = $4
     WHERE cit_id = $1`, [citId, etapa, jobId ?? null, error ?? null]).catch(() => { });
}
// ══════════════════════════════════════════════════════════
// WORKER: VALIDAR CIT (72 hs después)
// ══════════════════════════════════════════════════════════
async function processValidar(job) {
    const { citId } = job.data;
    const attempt = job.attemptsMade + 1;
    logger_1.log.queue.info({ citId, jobId: job.id, attempt }, '▶ Pipeline: etapa VALIDANDO');
    await job.progress(10);
    // Verificar que el CIT todavía está en estado esperado
    const cit = await (0, database_1.queryOne)(`SELECT c.estado, c.propietario_id, c.pipeline_estado
     FROM cits c WHERE c.id = $1`, [citId]);
    if (!cit) {
        logger_1.log.queue.warn({ citId }, 'CIT no encontrado — job cancelado');
        return { resultado: 'CANCELADO', motivo: 'CIT no existe' };
    }
    if (cit.pipeline_estado === 'CANCELADO') {
        logger_1.log.queue.info({ citId }, 'Pipeline cancelado por denuncia — job omitido');
        return { resultado: 'CANCELADO', motivo: 'Pipeline cancelado' };
    }
    if (cit.estado !== 'PENDIENTE') {
        logger_1.log.queue.info({ citId, estado: cit.estado }, 'CIT ya no está PENDIENTE — job omitido');
        return { resultado: 'OMITIDO', estadoActual: cit.estado };
    }
    // Marcar como VALIDANDO
    await setPipelineEstado(citId, 'VALIDANDO', { jobId: String(job.id), intento: attempt });
    await updateValidacionQueue(citId, 'PROCESANDO', String(job.id));
    await job.progress(20);
    // Ejecutar validación Ministerio de Seguridad
    try {
        const { validarCIT } = await import('./cit.service');
        const resultado = await validarCIT(citId);
        await job.progress(70);
        logger_1.log.queue.info({ citId, alertaActiva: resultado.alertaActiva, estado: resultado.estado }, '◀ Validación Min.Seg completada');
        if (resultado.alertaActiva) {
            // RECHAZADO — bicicleta con alerta de robo
            await setPipelineEstado(citId, 'RECHAZADO', {
                motivo: 'Alerta Ministerio de Seguridad',
                tipoAlerta: 'DENUNCIA_ROBO_ACTIVA',
            });
            await updateValidacionQueue(citId, 'RECHAZADO');
            // Notificar al propietario con mensaje completo (canal email + push)
            const { notificarCITRechazado } = await import('./notif.service');
            const citData = await (await import('../config/database')).queryOne(`SELECT c.numero_cit, b.numero_serie, NULL AS min_seg_expediente
         FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id WHERE c.id=$1`, [citId]);
            await notificarCITRechazado({
                usuarioId: cit.propietario_id,
                numeroCIT: citData?.numero_cit ?? citId.slice(0, 8),
                serial: citData?.numero_serie ?? 'N/D',
                motivo: 'Alerta del Ministerio de Seguridad Mendoza',
                minSegExpediente: citData?.min_seg_expediente ?? undefined,
            }).catch(err => logger_1.log.queue.warn({ citId, err: err.message }, 'Notif rechazo falló'));
            await job.progress(100);
            return { resultado: 'RECHAZADO', alertaActiva: true };
        }
        // APROBADO — encolar acuñación del NFT
        await updateValidacionQueue(citId, 'APROBADO');
        // Obtener wallet del propietario (si tiene)
        const propietario = await (0, database_1.queryOne)(`SELECT u.wallet_address
       FROM cits c JOIN usuarios u ON u.id = c.propietario_id
       WHERE c.id = $1`, [citId]);
        await encolarFinalizar(citId, propietario?.wallet_address ?? undefined);
        await job.progress(100);
        logger_1.log.queue.info({ citId }, '✓ Pipeline: validación OK · acuñación encolada');
        return { resultado: 'APROBADO', aprobadoParaFinalizar: true };
    }
    catch (err) {
        const errMsg = err.message;
        logger_1.log.queue.error({ citId, attempt, errMsg }, '✗ Validación falló — reintentando');
        await updateValidacionQueue(citId, 'ERROR', undefined, errMsg);
        throw err; // Bull reintentará según backoff
    }
}
// ══════════════════════════════════════════════════════════
// WORKER: FINALIZAR CIT (mint NFT en BFA)
// ══════════════════════════════════════════════════════════
async function processFinalizar(job) {
    const { citId, propietarioWallet } = job.data;
    const attempt = job.attemptsMade + 1;
    logger_1.log.queue.info({ citId, jobId: job.id, attempt }, '▶ Pipeline: etapa ACTIVANDO · acuñando NFT en BFA');
    await job.progress(10);
    // Verificar estado antes de continuar
    const cit = await (0, database_1.queryOne)(`SELECT estado, pipeline_estado, nft_token_id FROM cits WHERE id = $1`, [citId]);
    if (!cit || cit.pipeline_estado === 'CANCELADO') {
        logger_1.log.queue.info({ citId, motivo: cit?.pipeline_estado }, 'Mint omitido — pipeline cancelado');
        return { resultado: 'OMITIDO', motivo: cit?.pipeline_estado ?? 'no encontrado' };
    }
    // Idempotencia: si ya acuñó (podría haberse reintentado el job)
    if (cit.estado === 'ACTIVO' && cit.nft_token_id) {
        logger_1.log.queue.info({ citId, tokenId: cit.nft_token_id }, 'NFT ya acuñado — job idempotente');
        await setPipelineEstado(citId, 'ACTIVO', { nota: 'ya_activo' });
        return { resultado: 'YA_ACTIVO', tokenId: cit.nft_token_id };
    }
    await setPipelineEstado(citId, 'ACTIVANDO', { jobId: String(job.id), intento: attempt });
    await job.progress(20);
    try {
        // Usar el servicio dedicado de mint con tracking + indexación + notificación
        const { acuñarCITEnBFA } = await import('./bfa.mint.service');
        const mintResult = await acuñarCITEnBFA(citId, propietarioWallet);
        await job.progress(90);
        await setPipelineEstado(citId, 'ACTIVO', {
            tokenId: mintResult.tokenId,
            txHash: mintResult.txHash,
            blockNumber: mintResult.blockNumber,
            walletDestino: mintResult.walletDestino,
            custodial: mintResult.esCustodial,
            indexado: mintResult.indexado,
        });
        await job.progress(100);
        (async () => {
            const { notificarCITAprobado } = await import('./notif.service');
            const { queryOne: qone } = await import('../config/database');
            const citData = await qone(`SELECT c.numero_cit, c.propietario_id, b.numero_serie, c.fecha_vencimiento
          FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id WHERE c.id=$1`, [citId]);
            if (citData) {
                const bfaExplorerUrl = `https://explorer.bfa.ar/tx/${mintResult.txHash}`;
                await notificarCITAprobado({
                    usuarioId: citData.propietario_id,
                    numeroCIT: citData.numero_cit,
                    serial: citData.numero_serie,
                    tokenId: mintResult.tokenId,
                    txHash: mintResult.txHash,
                    venceEn: citData.fecha_vencimiento?.toISOString() ?? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
                    bfaExplorerUrl,
                    esCustodial: mintResult.esCustodial,
                }).catch(err => logger_1.log.queue.warn({ citId, err: err.message }, 'Notif aprobado falló'));
            }
        })();
        logger_1.log.queue.info({
            citId,
            tokenId: mintResult.tokenId,
            txHash: mintResult.txHash,
            blockNumber: mintResult.blockNumber,
            gasUsed: mintResult.gasUsed,
            indexado: mintResult.indexado,
        }, '✅ Pipeline completado · CIT ACTIVO · NFT acuñado en BFA');
        return {
            resultado: 'ACTIVO',
            tokenId: mintResult.tokenId,
            txHash: mintResult.txHash,
            blockNumber: mintResult.blockNumber,
            gasUsed: mintResult.gasUsed,
            indexado: mintResult.indexado,
        };
    }
    catch (err) {
        const errMsg = err.message;
        const reintentable = err.reintentable ?? true;
        logger_1.log.queue.error({ citId, attempt, errMsg, reintentable }, '✗ Acuñación BFA falló');
        if (!reintentable && attempt >= (job.opts.attempts ?? 5)) {
            // Error no reintentable (problema de contrato) → marcar definitivamente
            await setPipelineEstado(citId, 'ERROR_PIPELINE', { error: errMsg, reintentable: false });
        }
        throw err; // Bull reintentará si quedan intentos
    }
}
// ══════════════════════════════════════════════════════════
// INICIALIZACIÓN DE COLAS Y WORKERS
// ══════════════════════════════════════════════════════════
async function initQueue() {
    if (initialized)
        return;
    qValidar = new bull_1.default('rodaid:cit:validar', REDIS_OPTS);
    qFinalizar = new bull_1.default('rodaid:cit:finalizar', REDIS_OPTS);
    qNotif = new bull_1.default('rodaid:notif', REDIS_OPTS);
    qExpire = new bull_1.default('rodaid:cit:expirar', REDIS_OPTS);
    // Workers
    qValidar.process(2, processValidar);
    qFinalizar.process(1, processFinalizar);
    qNotif.process(5, async (job) => {
        const { usuarioId, tipo, titulo } = job.data;
        logger_1.log.queue.debug({ usuarioId, tipo, titulo: titulo.slice(0, 40) }, '▶ Notif enviada');
        // FCM/email en producción con credenciales
        return { ok: true };
    });
    qExpire.process(1, async (job) => {
        logger_1.log.queue.info({ jobId: job.id }, '▶ Expirar CITs vencidos');
        const result = await (0, database_1.query)(`WITH expired AS (
         UPDATE cits SET estado='EXPIRADO', actualizado_en=NOW()
         WHERE estado='ACTIVO' AND fecha_vencimiento < NOW()
         RETURNING id
       ) SELECT COUNT(*)::text AS count FROM expired`);
        const n = parseInt(result[0]?.count ?? '0');
        logger_1.log.queue.info({ expiredCount: n }, `◀ ${n} CIT(s) expirado(s)`);
        return { expiredCount: n };
    });
    // Cron diario 03:00 Mendoza
    await qExpire.removeRepeatable({ cron: '0 3 * * *', tz: 'America/Argentina/Mendoza' }).catch(() => { });
    await qExpire.add({}, {
        repeat: { cron: '0 3 * * *', tz: 'America/Argentina/Mendoza' },
        jobId: 'cit-expiry-daily',
    });
    // Dead-letter: jobs que fallaron todos los intentos → marcar ERROR_PIPELINE
    qValidar.on('failed', async (job, err) => {
        logger_1.log.queue.error({ jobId: job?.id, err: err.message, attempts: job?.attemptsMade }, 'Job validar FALLIDO definitivo');
        if (job?.attemptsMade >= (job?.opts?.attempts ?? 3) - 1 && job?.data?.citId) {
            await setPipelineEstado(job.data.citId, 'ERROR_PIPELINE', { error: err.message })
                .catch(() => { });
        }
    });
    qFinalizar.on('failed', async (job, err) => {
        logger_1.log.queue.error({ jobId: job?.id, err: err.message }, 'Job finalizar FALLIDO definitivo');
        if (job?.attemptsMade >= (job?.opts?.attempts ?? 3) - 1 && job?.data?.citId) {
            await setPipelineEstado(job.data.citId, 'ERROR_PIPELINE', { error: err.message })
                .catch(() => { });
        }
    });
    for (const [nombre, q] of [
        ['validar', qValidar], ['finalizar', qFinalizar], ['notif', qNotif], ['expirar', qExpire],
    ]) {
        q.on('stalled', job => logger_1.log.queue.warn({ queue: nombre, jobId: job?.id }, 'Job estancado'));
        q.on('error', err => logger_1.log.queue.error({ queue: nombre, err: err.message }, 'Queue error'));
    }
    initialized = true;
    logger_1.log.queue.info({ redis: `${REDIS_OPTS.redis.host}:${REDIS_OPTS.redis.port}` }, '✓ Pipeline de validación CIT iniciado');
}
// ══════════════════════════════════════════════════════════
// API PÚBLICA — ENCOLAR TRABAJOS
// ══════════════════════════════════════════════════════════
/** Encolar validación con delay hasta 72 hs */
async function encolarValidacion(citId, venceEn) {
    if (!qValidar)
        throw new Error('Queue no inicializada — llamar initQueue() primero');
    const delayMs = Math.max(0, venceEn.getTime() - Date.now());
    const job = await qValidar.add({ citId, origenDelay: delayMs }, {
        delay: delayMs,
        jobId: `validar:${citId}`, // idempotente
        priority: 5,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
    });
    // Marcar en pipeline + validacion_queue
    await setPipelineEstado(citId, 'PENDIENTE', { delayMs, venceEn: venceEn.toISOString() });
    await (0, database_1.query)(`UPDATE validacion_queue SET job_id=$2, etapa='ENCOLADO' WHERE cit_id=$1`, [citId, String(job.id)]).catch(() => { });
    logger_1.log.queue.info({
        citId, jobId: job.id,
        delay72hs: (delayMs / 3_600_000).toFixed(1) + ' hs',
        venceEn: venceEn.toISOString(),
    }, '✓ CIT encolado para validación 72 hs');
    return String(job.id);
}
/** Encolar acuñación post-validación */
async function encolarFinalizar(citId, propietarioWallet) {
    if (!qFinalizar)
        throw new Error('Queue no inicializada');
    const job = await qFinalizar.add({ citId, propietarioWallet }, {
        jobId: `finalizar:${citId}`,
        priority: 10,
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
    });
    logger_1.log.queue.info({ citId, jobId: job.id }, '✓ Acuñación NFT encolada');
    return String(job.id);
}
/** Cancelar el job de validación (cuando se denuncia la bicicleta) */
async function cancelarValidacion(citId) {
    if (!qValidar)
        return { cancelado: false };
    try {
        const job = await qValidar.getJob(`validar:${citId}`);
        if (!job)
            return { cancelado: false };
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
            await job.remove();
            await setPipelineEstado(citId, 'CANCELADO', { motivo: 'Denuncia de robo registrada' });
            await (0, database_1.query)(`UPDATE validacion_queue SET etapa='CANCELADO', procesada_en=NOW() WHERE cit_id=$1`, [citId]).catch(() => { });
            logger_1.log.queue.info({ citId, jobId: job.id, state }, '✓ Job de validación cancelado por denuncia');
            return { cancelado: true, jobId: String(job.id) };
        }
        // Job ya en proceso — marcar para ignorar cuando despierte
        await setPipelineEstado(citId, 'CANCELADO', { motivo: 'Denuncia durante procesamiento', state });
        return { cancelado: true, jobId: String(job.id) };
    }
    catch (err) {
        logger_1.log.queue.warn({ citId, err: err.message }, 'cancelarValidacion error');
        return { cancelado: false };
    }
}
/** Notificación (fire-and-forget) */
async function encolarNotificacion(payload) {
    if (!qNotif) {
        logger_1.log.queue.warn('Queue notif no disponible');
        return;
    }
    await qNotif.add(payload, { attempts: 3, backoff: { type: 'fixed', delay: 10_000 } });
}
// ══════════════════════════════════════════════════════════
// MONITOREO ADMIN
// ══════════════════════════════════════════════════════════
async function getQueueStats() {
    if (!qValidar || !qFinalizar)
        return { error: 'Queues no inicializadas' };
    const [vCounts, fCounts] = await Promise.all([
        qValidar.getJobCounts(),
        qFinalizar.getJobCounts(),
    ]);
    // Pipeline stats desde DB
    const pipelineStats = await (0, database_1.query)(`SELECT pipeline_estado, COUNT(*)::text AS count
     FROM cits WHERE pipeline_estado IS NOT NULL
     GROUP BY pipeline_estado ORDER BY pipeline_estado`);
    return {
        queues: {
            'rodaid:cit:validar': vCounts,
            'rodaid:cit:finalizar': fCounts,
        },
        pipeline: Object.fromEntries(pipelineStats.map(r => [r.pipeline_estado, parseInt(r.count)])),
    };
}
async function getJobsPendientes() {
    if (!qValidar || !qFinalizar)
        return [];
    const [delayed, waiting] = await Promise.all([
        qValidar.getDelayed(0, 50),
        qValidar.getWaiting(0, 50),
    ]);
    const jobs = [...delayed, ...waiting];
    return Promise.all(jobs.map(async (job) => {
        const state = await job.getState();
        return {
            jobId: String(job.id),
            citId: job.data.citId,
            estado: state,
            procesadoEn: new Date(job.timestamp + (job.opts.delay ?? 0)).toISOString(),
            intentos: job.attemptsMade,
        };
    }));
}
async function reintentarJob(jobId) {
    if (!qValidar || !qFinalizar)
        return { ok: false, message: 'Queues no inicializadas' };
    for (const q of [qValidar, qFinalizar]) {
        const job = await q.getJob(jobId);
        if (job) {
            await job.retry();
            return { ok: true, message: `Job ${jobId} reencolado` };
        }
    }
    return { ok: false, message: `Job ${jobId} no encontrado` };
}
async function limpiarCola(nombre) {
    const map = { validar: qValidar, finalizar: qFinalizar, notif: qNotif };
    const q = map[nombre];
    if (!q)
        return { ok: false };
    await q.clean(0, 'completed');
    await q.clean(0, 'failed');
    return { ok: true };
}
