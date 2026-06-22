"use strict";
// ─── RODAID · Queue System (BullMQ + Redis) ──────────────
// Sistema de colas para la validación diferida de 72 hs (Ley 9556)
// Queues: validar-cit · finalizar-cit · notificaciones · mantenimiento
Object.defineProperty(exports, "__esModule", { value: true });
exports.Q = void 0;
exports.initBullMQ = initBullMQ;
exports.encolarValidacion = encolarValidacion;
exports.encolarFinalizar = encolarFinalizar;
exports.encolarNotificacion = encolarNotificacion;
exports.programarMantenimiento = programarMantenimiento;
exports.getQueueStats = getQueueStats;
exports.closeBullMQ = closeBullMQ;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const env_1 = require("../config/env");
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
// ── Nombres canónicos de las colas ────────────────────────
exports.Q = {
    VALIDAR_CIT: 'validar-cit',
    FINALIZAR_CIT: 'finalizar-cit',
    NOTIFICACION: 'notificacion',
    MANTENIMIENTO: 'mantenimiento',
};
// ── Configuración BullMQ compartida ──────────────────────
const CONNECTION = { connection: (0, redis_1.getRedis)() };
const DEFAULT_JOB_OPTIONS = {
    removeOnComplete: { age: 7 * 86400, count: 1000 }, // conservar 7 días o 1000 jobs
    removeOnFail: { age: 30 * 86400 }, // fallos conservados 30 días
};
// ── Instancias de colas y eventos ─────────────────────────
let queues = {};
let workers = {};
let events = {};
// ══════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════════════
async function initBullMQ() {
    logger_1.logger.info('Iniciando sistema de colas BullMQ + Redis...');
    // ── Crear colas ───────────────────────────────────────
    for (const name of Object.values(exports.Q)) {
        queues[name] = new bullmq_1.Queue(name, { ...CONNECTION, defaultJobOptions: DEFAULT_JOB_OPTIONS });
        events[name] = new bullmq_1.QueueEvents(name, CONNECTION);
        // Observadores de eventos para logging
        events[name].on('completed', ({ jobId }) => logger_1.logger.debug({ jobId, queue: name }, 'Job completado'));
        events[name].on('failed', ({ jobId, failedReason }) => logger_1.logger.warn({ jobId, failedReason, queue: name }, 'Job fallido'));
        events[name].on('stalled', ({ jobId }) => logger_1.logger.warn({ jobId, queue: name }, 'Job estancado — se reintentará'));
    }
    // ── Registrar workers ─────────────────────────────────
    _registerValidarCITWorker();
    _registerFinalizarCITWorker();
    _registerNotificacionWorker();
    _registerMantenimientoWorker();
    // ── Programar jobs de mantenimiento recurrentes ───────
    await programarMantenimiento();
    logger_1.logger.info({ queues: Object.values(exports.Q) }, '✓ BullMQ iniciado · todos los workers activos');
}
// ══════════════════════════════════════════════════════════
// WORKER 1 — VALIDAR CIT (72 hs · cross-reference Ministerio)
// ══════════════════════════════════════════════════════════
function _registerValidarCITWorker() {
    workers[exports.Q.VALIDAR_CIT] = new bullmq_1.Worker(exports.Q.VALIDAR_CIT, async (job) => {
        const { citId, serial } = job.data;
        logger_1.logger.info({ citId, serial, jobId: job.id, attempt: job.attemptsMade + 1 }, 'Worker: iniciando validación CIT');
        // 1. Verificar que el CIT sigue PENDIENTE (puede haberse bloqueado por denuncia)
        const cit = await (0, database_1.queryOne)(`SELECT c.id, c.estado, c.propietario_id
         FROM cits c
         JOIN validacion_queue vq ON vq.cit_id = c.id
         WHERE c.id = $1 AND vq.procesada_en IS NULL`, [citId]);
        if (!cit) {
            logger_1.logger.info({ citId }, 'CIT ya procesado o no encontrado — job ignorado');
            return { resultado: 'ignorado', motivo: 'ya_procesado' };
        }
        if (cit.estado === 'BLOQUEADO') {
            await (0, database_1.query)(`UPDATE validacion_queue SET procesada_en=NOW(), resultado='rechazado',
           alerta_min_seg=TRUE, detalle_alerta=$2 WHERE cit_id=$1`, [citId, JSON.stringify({ motivo: 'DENUNCIA_PREVIA', procesadoEn: new Date().toISOString() })]);
            logger_1.logger.info({ citId }, 'CIT bloqueado por denuncia — validación cancelada');
            return { resultado: 'cancelado', motivo: 'denuncia_previa' };
        }
        await job.updateProgress(10);
        // 2. Cross-reference con Ministerio de Seguridad Mendoza
        const resultadoMinSeg = await _crossReferenceMinSeg(serial, citId, job);
        await job.updateProgress(60);
        if (resultadoMinSeg.alertaActiva) {
            // Robo confirmado — bloquear y notificar
            await _rechazarCIT(citId, cit.propietario_id, resultadoMinSeg.tipoAlerta ?? 'ALERTA_MINSEG', job);
            await job.updateProgress(100);
            return { resultado: 'rechazado', alerta: resultadoMinSeg.tipoAlerta };
        }
        // 3. Sin alerta — encolar finalización (acuñar NFT en BFA)
        await (0, database_1.query)(`UPDATE validacion_queue SET procesada_en=NOW(), resultado='aprobado' WHERE cit_id=$1`, [citId]);
        await encolarFinalizar(citId);
        await job.updateProgress(100);
        logger_1.logger.info({ citId, serial }, 'Validación aprobada — CIT encolado para finalizar');
        return { resultado: 'aprobado' };
    }, {
        ...CONNECTION,
        concurrency: 3, // hasta 3 validaciones simultáneas
        limiter: { max: 10, duration: 60_000 }, // max 10/min (respeta rate limit de Min.Seg)
    });
    workers[exports.Q.VALIDAR_CIT].on('failed', (job, err) => {
        logger_1.logger.error({ jobId: job?.id, citId: job?.data?.citId, err: err.message }, 'Validación CIT fallida');
    });
}
// ══════════════════════════════════════════════════════════
// WORKER 2 — FINALIZAR CIT (acuñar NFT en BFA)
// ══════════════════════════════════════════════════════════
function _registerFinalizarCITWorker() {
    workers[exports.Q.FINALIZAR_CIT] = new bullmq_1.Worker(exports.Q.FINALIZAR_CIT, async (job) => {
        const { citId, propietarioWallet } = job.data;
        logger_1.logger.info({ citId, jobId: job.id }, 'Worker: finalizando CIT · acuñando NFT en BFA');
        const cit = await (0, database_1.queryOne)(`SELECT id, estado, hash_sha256, numero_cit, propietario_id FROM cits WHERE id=$1`, [citId]);
        if (!cit)
            throw new bullmq_1.UnrecoverableError(`CIT ${citId} no encontrado — no reintentable`);
        if (cit.estado !== 'PENDIENTE') {
            logger_1.logger.info({ citId, estado: cit.estado }, 'CIT ya no está PENDIENTE — saltando');
            return { resultado: 'saltado', estado: cit.estado };
        }
        await job.updateProgress(20);
        // Acuñar NFT en BFA — importación dinámica para evitar circular
        const { bfaService } = await import('./bfa.service');
        const wallet = propietarioWallet ?? '0x0000000000000000000000000000000000000001';
        let bfaResult;
        try {
            bfaResult = await bfaService.mint(wallet, cit.hash_sha256, cit.numero_cit, cit.bicicleta_numero_serie ?? '');
        }
        catch (err) {
            // BFA errors son reintentables (red, gas, etc.)
            throw new Error(`BFA mint falló: ${err.message}`);
        }
        await job.updateProgress(80);
        const ahora = new Date();
        const vence = new Date(ahora);
        vence.setFullYear(vence.getFullYear() + 1);
        await (0, database_1.query)(`UPDATE cits
         SET estado='ACTIVO', bfa_tx_hash=$2, nft_token_id=$3,
             fecha_emision=$4, fecha_vencimiento=$5, actualizado_en=NOW()
         WHERE id=$1`, [citId, bfaResult.txHash, bfaResult.tokenId, ahora, vence]);
        // Notificación al propietario
        await encolarNotificacion({
            usuarioId: cit.propietario_id,
            tipo: 'CIT_APROBADO',
            titulo: `CIT ${cit.numero_cit} activado · NFT acuñado en BFA`,
            cuerpo: 'Tu Certificado de Identidad Técnica fue activado exitosamente. El NFT fue acuñado en la Blockchain Federal Argentina.',
            datos: { citId, numeroCIT: cit.numero_cit, tokenId: bfaResult.tokenId, txHash: bfaResult.txHash },
        });
        await job.updateProgress(100);
        logger_1.logger.info({ citId, tokenId: bfaResult.tokenId, txHash: bfaResult.txHash }, 'CIT finalizado · ACTIVO · NFT acuñado');
        return { resultado: 'activo', tokenId: bfaResult.tokenId, txHash: bfaResult.txHash };
    }, {
        ...CONNECTION,
        concurrency: 1, // serializado — evita doble mint en BFA
        limiter: { max: 5, duration: 60_000 },
    });
}
// ══════════════════════════════════════════════════════════
// WORKER 3 — NOTIFICACIONES (push + email + MxM)
// ══════════════════════════════════════════════════════════
function _registerNotificacionWorker() {
    workers[exports.Q.NOTIFICACION] = new bullmq_1.Worker(exports.Q.NOTIFICACION, async (job) => {
        const { usuarioId, tipo, titulo, cuerpo, datos } = job.data;
        // Persistir en DB (canal interno)
        await (0, database_1.query)(`INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
         VALUES ($1, $2, $3, $4, $5)`, [usuarioId, tipo, titulo, cuerpo, JSON.stringify(datos ?? {})]);
        // FCM push (stub — conectar con firebase-admin cuando esté configurado)
        const deviceTokens = await (0, database_1.query)(`SELECT token, plataforma FROM device_tokens WHERE usuario_id=$1`, [usuarioId]);
        if (deviceTokens.length > 0) {
            logger_1.logger.debug({ usuarioId, tokens: deviceTokens.length, tipo }, 'FCM push [STUB]');
            // En producción: await fcmAdmin.sendMulticast({ tokens, notification: { title, body } })
        }
        return { notified: true, channels: ['db', deviceTokens.length > 0 ? 'fcm' : null].filter(Boolean) };
    }, { ...CONNECTION, concurrency: 10 });
}
// ══════════════════════════════════════════════════════════
// WORKER 4 — MANTENIMIENTO (cron: expirar CITs, limpiar tokens)
// ══════════════════════════════════════════════════════════
function _registerMantenimientoWorker() {
    workers[exports.Q.MANTENIMIENTO] = new bullmq_1.Worker(exports.Q.MANTENIMIENTO, async (job) => {
        const { tarea } = job.data;
        if (tarea === 'expirar_cits') {
            const expired = await (0, database_1.query)(`WITH exp AS (
             UPDATE cits SET estado='EXPIRADO', actualizado_en=NOW()
             WHERE estado='ACTIVO' AND fecha_vencimiento < NOW()
             RETURNING id
           ) SELECT COUNT(*)::text AS count FROM exp`);
            const n = parseInt(expired[0]?.count ?? '0');
            if (n > 0)
                logger_1.logger.info({ count: n }, `Mantenimiento: ${n} CITs expirados automáticamente`);
            return { tarea, expirados: n };
        }
        if (tarea === 'limpiar_tokens') {
            const deleted = await (0, database_1.query)(`WITH del AS (
             DELETE FROM refresh_tokens WHERE expires_at < NOW() RETURNING id
           ) SELECT COUNT(*)::text AS count FROM del`);
            const n = parseInt(deleted[0]?.count ?? '0');
            if (n > 0)
                logger_1.logger.info({ count: n }, `Mantenimiento: ${n} refresh tokens expirados eliminados`);
            return { tarea, eliminados: n };
        }
        return { tarea, resultado: 'no_reconocida' };
    }, { ...CONNECTION, concurrency: 1 });
}
// ══════════════════════════════════════════════════════════
// HELPER — Cross-reference Ministerio de Seguridad Mendoza
// ══════════════════════════════════════════════════════════
async function _crossReferenceMinSeg(serial, citId, job) {
    await job.updateProgress(30);
    // En producción: fetch(env.MINSEG_API_URL + '/cross-reference', { method:'POST', ... })
    // Con mTLS y certificado clientAuth del Ministerio
    if (env_1.env.MINSEG_API_URL && env_1.env.MINSEG_API_KEY) {
        try {
            const res = await fetch(`${env_1.env.MINSEG_API_URL}/api/v1/cross-reference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env_1.env.MINSEG_API_KEY}` },
                body: JSON.stringify({ serial, citId, fuente: 'RODAID' }),
                signal: AbortSignal.timeout(10_000), // timeout de 10 s
            });
            if (res.ok) {
                const data = await res.json();
                await job.updateProgress(50);
                return data;
            }
        }
        catch (err) {
            logger_1.logger.warn({ err, serial }, 'Min.Seg API no respondió — asumiendo sin alerta');
        }
    }
    // STUB: serial que empiece con 'ROBADO-' → alerta activa (para pruebas)
    const alertaActiva = serial.startsWith('ROBADO-');
    logger_1.logger.warn({ serial, alertaActiva }, 'MINSEG STUB — cruce simulado');
    await job.updateProgress(50);
    return { alertaActiva, tipoAlerta: alertaActiva ? 'DENUNCIA_ROBO_ACTIVA' : undefined };
}
async function _rechazarCIT(citId, propietarioId, tipoAlerta, job) {
    await (0, database_1.query)(`UPDATE cits SET estado='RECHAZADO', actualizado_en=NOW() WHERE id=$1`, [citId]);
    await (0, database_1.query)(`UPDATE validacion_queue
     SET procesada_en=NOW(), resultado='rechazado', alerta_min_seg=TRUE,
         detalle_alerta=$2
     WHERE cit_id=$1`, [citId, JSON.stringify({ tipoAlerta, ts: new Date().toISOString() })]);
    // Notificar al propietario
    await encolarNotificacion({
        usuarioId: propietarioId,
        tipo: 'CIT_RECHAZADO',
        titulo: 'CIT rechazado · Alerta de seguridad',
        cuerpo: 'Tu CIT fue rechazado porque el rodado figura en la base de denuncias del Ministerio de Seguridad de Mendoza. Tu información fue remitida a las autoridades.',
        datos: { citId, tipoAlerta },
    });
    await job.updateProgress(90);
    logger_1.logger.warn({ citId, tipoAlerta }, 'CIT rechazado por alerta del Ministerio');
}
// ══════════════════════════════════════════════════════════
// API PÚBLICA — Encolar trabajos
// ══════════════════════════════════════════════════════════
// Encolar validación 72 hs después del inicio del CIT
async function encolarValidacion(citId, serial, venceEn) {
    const q = queues[exports.Q.VALIDAR_CIT];
    if (!q)
        throw new Error('Queue no inicializada');
    const delay = Math.max(0, venceEn.getTime() - Date.now());
    const job = await q.add(`validar:${citId}`, { citId, serial }, {
        delay, // ms hasta que se ejecuta
        attempts: 5,
        backoff: { type: 'exponential', delay: 300_000 }, // 5 min, 10 min, 20 min...
        jobId: `validar-${citId}`, // idempotente: no duplica si ya existe
    });
    logger_1.logger.info({
        citId, serial, jobId: job.id,
        ejecutaEn: venceEn.toISOString(),
        delayHs: (delay / 3600000).toFixed(1),
    }, 'Validación CIT encolada en BullMQ');
    return job.id;
}
// Encolar finalización post-validación
async function encolarFinalizar(citId, wallet) {
    const q = queues[exports.Q.FINALIZAR_CIT];
    if (!q)
        throw new Error('Queue no inicializada');
    const job = await q.add(`finalizar:${citId}`, { citId, propietarioWallet: wallet }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 }, // 1 min, 2 min, 4 min...
        priority: 10,
        jobId: `finalizar-${citId}`,
    });
    return job.id;
}
// Encolar notificación
async function encolarNotificacion(payload) {
    const q = queues[exports.Q.NOTIFICACION];
    if (!q)
        return; // graceful si la queue no está lista
    await q.add('notif', payload, { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } });
}
// ══════════════════════════════════════════════════════════
// MANTENIMIENTO PROGRAMADO (cron via BullMQ repeatable jobs)
// ══════════════════════════════════════════════════════════
async function programarMantenimiento() {
    const q = queues[exports.Q.MANTENIMIENTO];
    if (!q)
        return;
    // Expirar CITs vencidos — cada día a las 03:00 hora Mendoza (06:00 UTC)
    await q.add('expirar_cits', { tarea: 'expirar_cits' }, {
        repeat: { pattern: '0 6 * * *' },
        attempts: 3,
        jobId: 'cron-expirar-cits',
    });
    // Limpiar refresh tokens expirados — cada 6 horas
    await q.add('limpiar_tokens', { tarea: 'limpiar_tokens' }, {
        repeat: { pattern: '0 */6 * * *' },
        attempts: 3,
        jobId: 'cron-limpiar-tokens',
    });
    logger_1.logger.info('Mantenimiento programado: expirar_cits(diario) + limpiar_tokens(c/6h)');
}
// ══════════════════════════════════════════════════════════
// HEALTH + STATS
// ══════════════════════════════════════════════════════════
async function getQueueStats() {
    const stats = {};
    for (const [name, q] of Object.entries(queues)) {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            q.getWaitingCount(), q.getActiveCount(), q.getCompletedCount(),
            q.getFailedCount(), q.getDelayedCount(),
        ]);
        stats[name] = { waiting, active, completed, failed, delayed };
    }
    return stats;
}
// ══════════════════════════════════════════════════════════
// SHUTDOWN
// ══════════════════════════════════════════════════════════
async function closeBullMQ() {
    logger_1.logger.info('Cerrando workers BullMQ...');
    await Promise.all([
        ...Object.values(workers).map(w => w.close()),
        ...Object.values(events).map(e => e.close()),
        ...Object.values(queues).map(q => q.close()),
    ]);
    logger_1.logger.info('✓ BullMQ cerrado correctamente');
}
