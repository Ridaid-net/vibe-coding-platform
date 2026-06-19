"use strict";
// ─── RODAID · Scheduler de Notificaciones ────────────────
//
// Ejecuta los jobs de notificación en background:
//
//   job.vencimientoCITs  → 09:00 ART diario
//     └─ procesarArbolDecisionCITs()
//        ├─ Evalúa todos los CITs ACTIVOS
//        ├─ Detecta transiciones de zona (VERDE→AMARILLA, etc.)
//        └─ Dispara push + email + in-app con idempotencia
//
//   job.cleanupTokens    → 03:00 ART diario
//     └─ Desactiva device_tokens con >10 fallos consecutivos
//
//   job.statsSnapshot    → 00:00 ART diario (opcional)
//     └─ Snapshot de métricas para analítica
//
// ══ USO ══════════════════════════════════════════════════
//
//   // En server.ts, después de pool.connect():
//   import { iniciarScheduler, detenerScheduler } from './services/notif.scheduler'
//   iniciarScheduler()
//
//   // Al cerrar el servidor:
//   process.on('SIGTERM', async () => {
//     detenerScheduler()
//     await pool.end()
//   })
Object.defineProperty(exports, "__esModule", { value: true });
exports.iniciarScheduler = iniciarScheduler;
exports.detenerScheduler = detenerScheduler;
exports.ejecutarJobManual = ejecutarJobManual;
const logger_1 = require("../middleware/logger");
const database_1 = require("../config/database");
const cit_decision_tree_1 = require("./cit.decision.tree");
// ══════════════════════════════════════════════════════════
// HELPER — calcular ms hasta la próxima hora:minuto en ART
// ══════════════════════════════════════════════════════════
function msHastaProxima(horaART, minutoART) {
    // ART = UTC-3
    const ahora = new Date();
    const offsetART = -3 * 60 * 60 * 1000;
    const horaActualART = new Date(ahora.getTime() + offsetART);
    const objetivo = new Date(horaActualART);
    objetivo.setHours(horaART, minutoART, 0, 0);
    // Si ya pasó la hora, apuntar al día siguiente
    if (objetivo.getTime() <= horaActualART.getTime()) {
        objetivo.setDate(objetivo.getDate() + 1);
    }
    return objetivo.getTime() - horaActualART.getTime();
}
// ══════════════════════════════════════════════════════════
// JOB 1: Árbol de decisión de CITs (09:00 ART diario)
// ══════════════════════════════════════════════════════════
let timerVencimientos = null;
async function ejecutarVencimientos() {
    logger_1.log.bfa.info('⏰ Scheduler: job vencimientoCITs iniciado');
    try {
        const resultado = await (0, cit_decision_tree_1.procesarArbolDecisionCITs)();
        logger_1.log.bfa.info({
            total: resultado.total,
            cambios: resultado.cambios,
            enviadas: resultado.enviadas,
            errores: resultado.errores,
        }, '✓ Scheduler: job vencimientoCITs completado');
    }
    catch (err) {
        logger_1.log.bfa.error({ err: err.message }, '✗ Scheduler: job vencimientoCITs falló');
    }
    // Programar la próxima ejecución (mañana 09:00 ART)
    const msHasta = msHastaProxima(9, 0);
    timerVencimientos = setTimeout(ejecutarVencimientos, msHasta);
    logger_1.log.bfa.info({ proximoEn: `${Math.round(msHasta / 3600000)}h` }, 'Próximo job vencimientos programado');
}
// ══════════════════════════════════════════════════════════
// JOB 2: Limpiar device_tokens con fallos (03:00 ART diario)
// ══════════════════════════════════════════════════════════
let timerCleanup = null;
async function ejecutarCleanupTokens() {
    try {
        const res = await (0, database_1.query)(`UPDATE device_tokens
       SET valido=FALSE, activo=FALSE, motivo_baja='FALLOS_EXCESIVOS'
       WHERE fallos >= 10 AND valido=TRUE
       RETURNING id::text`, []);
        if (res.length > 0) {
            logger_1.log.mensajeria.info({ desactivados: res.length }, '✓ device_tokens con fallos excesivos desactivados');
        }
    }
    catch (err) {
        logger_1.log.mensajeria.warn({ err: err.message }, 'cleanup device_tokens falló');
    }
    const msHasta = msHastaProxima(3, 0);
    timerCleanup = setTimeout(ejecutarCleanupTokens, msHasta);
}
// ══════════════════════════════════════════════════════════
// API PÚBLICA
// ══════════════════════════════════════════════════════════
let schedulerActivo = false;
function iniciarScheduler() {
    if (schedulerActivo) {
        logger_1.log.bfa.warn('Scheduler ya activo — ignorando llamada duplicada');
        return;
    }
    schedulerActivo = true;
    logger_1.log.bfa.info('⏰ RODAID Notification Scheduler iniciado');
    // Job 1: Vencimientos — arrancar a las 09:00 ART
    const ms1 = msHastaProxima(9, 0);
    logger_1.log.bfa.info({ enHoras: Math.round(ms1 / 3600000) }, 'Job vencimientoCITs: primera ejecución programada');
    timerVencimientos = setTimeout(ejecutarVencimientos, ms1);
    // Job 2: Cleanup tokens — arrancar a las 03:00 ART
    const ms2 = msHastaProxima(3, 0);
    timerCleanup = setTimeout(ejecutarCleanupTokens, ms2);
    // En desarrollo: ejecutar inmediatamente para ver los resultados
    if (process.env.NODE_ENV === 'development' && process.env.SCHEDULER_IMMEDIATE === 'true') {
        logger_1.log.bfa.info('SCHEDULER_IMMEDIATE=true → ejecutando jobs ahora');
        setImmediate(ejecutarVencimientos);
    }
}
function detenerScheduler() {
    if (timerVencimientos) {
        clearTimeout(timerVencimientos);
        timerVencimientos = null;
    }
    if (timerCleanup) {
        clearTimeout(timerCleanup);
        timerCleanup = null;
    }
    schedulerActivo = false;
    logger_1.log.bfa.info('⏰ RODAID Notification Scheduler detenido');
}
/** Ejecutar manualmente (útil para testing o endpoints admin) */
async function ejecutarJobManual() {
    const [venc, tkns] = await Promise.allSettled([
        (0, cit_decision_tree_1.procesarArbolDecisionCITs)(),
        (0, database_1.query)(`UPDATE device_tokens SET valido=FALSE, activo=FALSE,
           motivo_baja='FALLOS_EXCESIVOS' WHERE fallos >= 10 AND valido=TRUE
           RETURNING id`, []),
    ]);
    return {
        vencimientos: venc.status === 'fulfilled' ? venc.value : { total: 0, cambios: 0, enviadas: 0, errores: 1, detalles: [] },
        tokensLimpiados: tkns.status === 'fulfilled' ? tkns.value.length : 0,
    };
}
