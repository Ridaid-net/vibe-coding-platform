"use strict";
// ─── RODAID · Aliado Panel Service ────────────────────────
// Registrar retribuciones y consultar panel del aliado.
// pagarRetribucionMP() y liquidarMes() viven en retribucion.mp.service
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANES = void 0;
exports.registrarRetribucion = registrarRetribucion;
exports.getRetribucionAliado = getRetribucionAliado;
exports.getResumenTaller = getResumenTaller;
exports.getDashboardAliado = getDashboardAliado;
exports.getCITsTaller = getCITsTaller;
exports.getResumenRetribucion = getResumenRetribucion;
exports.getTendenciaMensual = getTendenciaMensual;
exports.getInspectoresMetricas = getInspectoresMetricas;
exports.getLiquidaciones = getLiquidaciones;
exports.calcularLiquidacion = calcularLiquidacion;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const TASA_CIT = parseFloat(process.env.RODAID_TASA_CIT_ARS ?? '3000');
const PLANES_INTERNAL = {
    PIONERO: { porcentaje: 35 },
    CONSTRUCTOR: { porcentaje: 40 },
    ESCALADOR: { porcentaje: 45 },
};
async function registrarRetribucion(opts) {
    // Idempotencia
    const idKey = `ret-cit-${opts.citId}`;
    const yaExiste = await (0, database_1.queryOne)(`SELECT id, monto_aliado_ars, plan_aliado, estado FROM retribuciones_aliado WHERE idempotency_key=$1`, [idKey]);
    if (yaExiste) {
        return {
            retribucionId: null,
            montoAliadoARS: parseFloat(yaExiste.monto_aliado_ars),
            montoRodaidARS: TASA_CIT - parseFloat(yaExiste.monto_aliado_ars),
            plan: yaExiste.plan_aliado,
            porcentaje: PLANES_INTERNAL[yaExiste.plan_aliado]?.porcentaje ?? 35,
            estado: yaExiste.estado,
        };
    }
    // Obtener plan del taller
    const taller = await (0, database_1.queryOne)(`SELECT plan_aliado FROM talleres_aliados WHERE id=$1`, [opts.tallerId]);
    const plan = taller?.plan_aliado ?? 'PIONERO';
    const pct = PLANES_INTERNAL[plan]?.porcentaje ?? 35;
    const tasaARS = opts.tasaCITARS ?? TASA_CIT;
    const aliadoARS = Math.round(tasaARS * pct) / 100;
    const rodaidARS = Math.round((tasaARS - aliadoARS) * 100) / 100;
    const now = new Date();
    const row = await (0, database_1.queryOne)(`INSERT INTO retribuciones_aliado
       (taller_id, cit_id, inspector_id, numero_cit, plan_aliado,
        porcentaje_aliado, tasa_cit_ars, monto_aliado_ars, monto_rodaid_ars,
        estado, periodo_mes, periodo_año, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDIENTE',$10,$11,$12)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`, [
        opts.tallerId, opts.citId, opts.inspectorId ?? null, opts.numeroCIT,
        plan, pct, tasaARS, aliadoARS, rodaidARS,
        now.getMonth() + 1, now.getFullYear(), idKey,
    ]);
    logger_1.log.marketplace.info({
        citId: opts.citId.slice(0, 8), plan, pct,
        aliadoARS, rodaidARS, numeroCIT: opts.numeroCIT,
    }, `📋 Retribución registrada — ${plan} ${pct}%`);
    return {
        retribucionId: row.id,
        montoAliadoARS: aliadoARS,
        montoRodaidARS: rodaidARS,
        plan,
        porcentaje: pct,
        estado: 'PENDIENTE',
    };
}
async function getRetribucionAliado(tallerId, pagina = 1, porPagina = 25) {
    const offset = (pagina - 1) * porPagina;
    const [rows, total] = await Promise.all([
        (0, database_1.query)(`SELECT r.id, r.numero_cit, r.plan_aliado, r.porcentaje_aliado,
              r.tasa_cit_ars, r.monto_aliado_ars, r.monto_rodaid_ars,
              r.estado, r.mp_payment_id, r.pagado_en, r.periodo_mes, r.periodo_año, r.creado_en
       FROM retribuciones_aliado r
       WHERE r.taller_id=$1 ORDER BY r.creado_en DESC LIMIT $2 OFFSET $3`, [tallerId, porPagina, offset]),
        (0, database_1.queryOne)(`SELECT COUNT(*)::text AS count FROM retribuciones_aliado WHERE taller_id=$1`, [tallerId]),
    ]);
    return { retribuciones: rows, total: parseInt(total?.count ?? '0'), pagina, porPagina };
}
async function getResumenTaller(tallerId) {
    const now = new Date();
    return (0, database_1.queryOne)(`SELECT COUNT(*)::int AS total_cits,
            COUNT(*) FILTER(WHERE estado='PAGADO')::int AS cits_pagados,
            COUNT(*) FILTER(WHERE estado='PENDIENTE')::int AS cits_pendientes,
            COALESCE(SUM(monto_aliado_ars),0)::numeric AS total_aliado_ars,
            COALESCE(SUM(monto_aliado_ars) FILTER(WHERE estado='PAGADO'),0)::numeric AS cobrado_ars,
            COALESCE(SUM(monto_aliado_ars) FILTER(WHERE estado='PENDIENTE'),0)::numeric AS pendiente_ars,
            COALESCE(SUM(monto_aliado_ars) FILTER(WHERE periodo_mes=$2 AND periodo_año=$3),0)::numeric AS mes_actual_ars
     FROM retribuciones_aliado WHERE taller_id=$1`, [tallerId, now.getMonth() + 1, now.getFullYear()]);
}
async function getDashboardAliado(tallerId) {
    return getResumenTaller(tallerId);
}
async function getCITsTaller(tallerId, pagina = 1, porPagina = 25) {
    return getRetribucionAliado(tallerId, pagina, porPagina);
}
async function getResumenRetribucion(tallerId) {
    return getResumenTaller(tallerId);
}
async function getTendenciaMensual(tallerId) {
    const rows = await (0, database_1.query)(`SELECT periodo_mes AS mes, periodo_año AS año,
            COUNT(*)::int AS cits,
            COALESCE(SUM(monto_aliado_ars),0)::numeric AS aliado_ars,
            COALESCE(SUM(monto_rodaid_ars),0)::numeric AS rodaid_ars
     FROM retribuciones_aliado WHERE taller_id=$1
     GROUP BY periodo_mes, periodo_año ORDER BY año DESC, mes DESC LIMIT 12`, [tallerId]);
    return rows;
}
async function getInspectoresMetricas(tallerId) {
    return (0, database_1.query)(`SELECT i.id, u.nombre, u.apellido,
            COUNT(r.id)::int AS cits_emitidos,
            COALESCE(SUM(r.monto_aliado_ars),0)::numeric AS aliado_generado
     FROM inspectores i
     JOIN usuarios u ON u.id=i.usuario_id
     LEFT JOIN retribuciones_aliado r ON r.inspector_id=i.id AND r.taller_id=$1
     WHERE i.taller_aliado_id=$1
     GROUP BY i.id, u.nombre, u.apellido
     ORDER BY cits_emitidos DESC`, [tallerId]);
}
async function getLiquidaciones(tallerId) {
    return (0, database_1.query)(`SELECT id, periodo_mes, periodo_año, cits_count,
            total_tasa_ars, total_aliado_ars, total_rodaid_ars,
            estado, mp_payment_id, liquidada_en, creado_en
     FROM liquidaciones_aliado WHERE taller_id=$1
     ORDER BY periodo_año DESC, periodo_mes DESC`, [tallerId]);
}
async function calcularLiquidacion(tallerId, mes, año) {
    const rows = await (0, database_1.query)(`SELECT COUNT(*)::int AS cits,
            COALESCE(SUM(tasa_cit_ars),0)::numeric AS tasa_total,
            COALESCE(SUM(monto_aliado_ars),0)::numeric AS aliado_total,
            COALESCE(SUM(monto_rodaid_ars),0)::numeric AS rodaid_total
     FROM retribuciones_aliado
     WHERE taller_id=$1 AND periodo_mes=$2 AND periodo_año=$3
       AND estado IN ('PENDIENTE','CALCULADO')`, [tallerId, mes, año]);
    return rows[0];
}
exports.PLANES = {
    PIONERO: { porcentaje: 35 },
    CONSTRUCTOR: { porcentaje: 40 },
    ESCALADOR: { porcentaje: 45 },
};
