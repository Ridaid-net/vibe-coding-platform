"use strict";
// ─── RODAID · Retribución Automática a Aliados vía MP ─────
//
// Cada vez que un CIT es aprobado y su tasa MxM pagada,
// RODAID emite automáticamente la retribución al Taller Aliado
// a través de MercadoPago (transferencia P2P o marketplace split).
//
// ══ MODELO DE RETRIBUCIÓN ════════════════════════════════
//
//   Plan PIONERO     (hasta 50 CITs/mes):  35% de la tasa CIT
//   Plan CONSTRUCTOR (51–200 CITs/mes):    40% de la tasa CIT
//   Plan ESCALADOR   (> 200 CITs/mes):     45% de la tasa CIT
//
//   Ejemplo con Tasa CIT = $3.000 ARS:
//     PIONERO:     $1.050 ARS → Taller,  $1.950 ARS → RODAID
//     CONSTRUCTOR: $1.200 ARS → Taller,  $1.800 ARS → RODAID
//     ESCALADOR:   $1.350 ARS → Taller,  $1.650 ARS → RODAID
//
// ══ FLUJO COMPLETO ════════════════════════════════════════
//
//   triggerCITAprobado()
//     ↓
//   registrarRetribucion()          ← aliado.panel.service (ya existe)
//     ↓ INSERT retribuciones_aliado estado=PENDIENTE
//     ↓
//   pagarRetribucionMP()            ← esta función
//     ↓
//   1. Buscar token MP del taller en mp_vendedores / talleres_aliados
//   2. Si tiene token → POST /v1/payments (MP Transfer P2P)
//      Si no tiene    → quedar en PENDIENTE hasta que conecte MP
//   3. INSERT retribucion_pagos mp_estado=ACREDITADO|PENDIENTE
//   4. UPDATE retribuciones_aliado estado=PAGADO|PENDIENTE
//   5. Notificar al aliado: push + in-app
//
// ══ LIQUIDACIÓN MENSUAL ═══════════════════════════════════
//
//   liquidarMes(tallerId, mes, año)
//     ↓ Agrupa TODAS las retribuciones PENDIENTE del período
//     ↓ Genera UNA sola transferencia MP por el total
//     ↓ Marca liquidacion_id en cada retribución
//     ↓ INSERT liquidaciones_aliado estado=PAGADA
//
// ══ VARIABLES DE ENTORNO ══════════════════════════════════
//
//   RODAID_MP_ACCESS_TOKEN   → token de RODAID SAS (plataforma)
//   RODAID_MP_CLIENT_ID      → client ID de la App Marketplace
//   RODAID_TASA_CIT_ARS=3000
//   RODAID_MP_COMISION_PCT=2.50
Object.defineProperty(exports, "__esModule", { value: true });
exports.MP_STUB_RET = exports.TASA_CIT_ARS = exports.PLANES = void 0;
exports.pagarRetribucionMP = pagarRetribucionMP;
exports.triggerRetribucionCIT = triggerRetribucionCIT;
exports.liquidarMes = liquidarMes;
exports.reprocesarRetribucionesPendientes = reprocesarRetribucionesPendientes;
exports.getResumenRetribuciones = getResumenRetribuciones;
exports.getRetribucionesTaller = getRetribucionesTaller;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const env_1 = require("../config/env");
// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════
const TASA_CIT_ARS = parseFloat(process.env.RODAID_TASA_CIT_ARS ?? '3000');
exports.TASA_CIT_ARS = TASA_CIT_ARS;
const MP_TOKEN = env_1.env.RODAID_MP_ACCESS_TOKEN ?? '';
const MODO_STUB = !MP_TOKEN;
exports.MP_STUB_RET = MODO_STUB;
const MP_BASE = 'https://api.mercadopago.com';
const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const PLANES = {
    PIONERO: { porcentaje: 35, max_cits: 50, label: 'Pionero' },
    CONSTRUCTOR: { porcentaje: 40, max_cits: 200, label: 'Constructor' },
    ESCALADOR: { porcentaje: 45, max_cits: 9999, label: 'Escalador' },
};
exports.PLANES = PLANES;
// ══════════════════════════════════════════════════════════
// 1. PAGAR RETRIBUCIÓN POR CIT (automático post-aprobación)
// ══════════════════════════════════════════════════════════
async function pagarRetribucionMP(opts) {
    const pct = PLANES[opts.plan]?.porcentaje ?? 35;
    const modo = MODO_STUB ? 'STUB' : 'LIVE';
    // Idempotencia — una sola transferencia por retribución
    const yaExiste = await (0, database_1.queryOne)(`SELECT id, mp_estado, mp_payment_id FROM retribucion_pagos WHERE retribucion_id=$1`, [opts.retribucionId]);
    if (yaExiste) {
        return {
            pagoId: yaExiste.id,
            retribucionId: opts.retribucionId,
            tallerId: opts.tallerId,
            montoARS: opts.montoARS,
            mpEstado: yaExiste.mp_estado,
            mpPaymentId: yaExiste.mp_payment_id ?? undefined,
            mensaje: `Retribución ya procesada (${yaExiste.mp_estado})`,
            plan: opts.plan,
            pctRetribucion: pct,
            modo,
        };
    }
    // Obtener cuenta MP del taller
    const taller = await (0, database_1.queryOne)(`SELECT t.nombre, t.mp_user_id, t.mp_access_token, t.mp_email, t.propietario_id
     FROM talleres_aliados t WHERE t.id=$1`, [opts.tallerId]);
    // Si no tiene MP → buscar en mp_vendedores
    let mpToken = taller?.mp_access_token;
    let mpUserId = taller?.mp_user_id;
    if (!mpToken && taller?.propietario_id) {
        const vend = await (0, database_1.queryOne)(`SELECT mp_user_id, mp_access_token FROM mp_vendedores
       WHERE usuario_id=$1 AND activo=TRUE ORDER BY creado_en DESC LIMIT 1`, [taller.propietario_id]);
        mpToken = vend?.mp_access_token ?? null;
        mpUserId = vend?.mp_user_id ?? null;
    }
    let mpPaymentId;
    let mpEstado = 'PENDIENTE';
    let errorMsg;
    if (MODO_STUB) {
        // STUB: simular pago exitoso
        mpPaymentId = `STUB_RET_${Date.now()}_${opts.tallerId.slice(0, 8)}`;
        mpEstado = 'ACREDITADO';
        logger_1.log.marketplace.warn({
            tallerId: opts.tallerId.slice(0, 8), numeroCIT: opts.numeroCIT, montoARS: opts.montoARS,
        }, `⚠ MP STUB — retribución $${opts.montoARS} ARS simulada`);
    }
    else if (!mpToken || !mpUserId) {
        // Sin cuenta MP conectada → dejar PENDIENTE
        mpEstado = 'PENDIENTE';
        errorMsg = `Taller sin cuenta MercadoPago conectada. Conectar en /mp/connect.`;
        logger_1.log.marketplace.warn({ tallerId: opts.tallerId.slice(0, 8) }, '⚠ Retribución pendiente: sin MP conectado');
    }
    else {
        // LIVE — Transfer P2P usando MP API
        try {
            const idempKey = `ret-${opts.retribucionId}`;
            const payload = {
                transaction_amount: opts.montoARS,
                description: `Retribución CIT ${opts.numeroCIT} — RODAID (${opts.plan} ${pct}%)`,
                payment_method_id: 'account_money',
                receiver_id: parseInt(mpUserId),
                payer: {
                    type: 'customer',
                    id: process.env.RODAID_MP_USER_ID ?? '0',
                },
                metadata: {
                    retribucion_id: opts.retribucionId,
                    cit_id: opts.citId,
                    numero_cit: opts.numeroCIT,
                    plan: opts.plan,
                    porcentaje: pct,
                },
            };
            const resp = await fetch(`${MP_BASE}/v1/payments`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${MP_TOKEN}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': idempKey,
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10_000),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(`MP ${resp.status}: ${err.message ?? 'error'}`);
            }
            const mpPago = await resp.json();
            mpPaymentId = String(mpPago.id);
            mpEstado = mpPago.status === 'approved' ? 'ACREDITADO' : 'PENDIENTE';
        }
        catch (err) {
            errorMsg = err.message;
            mpEstado = 'PENDIENTE';
            logger_1.log.marketplace.error({ err: errorMsg, retribucionId: opts.retribucionId.slice(0, 8) }, '✗ Error MP en retribución');
        }
    }
    // Registrar pago
    const pagoRow = await (0, database_1.queryOne)(`INSERT INTO retribucion_pagos
       (retribucion_id, taller_id, monto_ars, concepto, mp_payment_id, mp_estado, error, acreditado_en)
     VALUES ($1,$2,$3,'RETRIBUCION_CIT',$4,$5::text,$6,
       CASE WHEN $5::text='ACREDITADO' THEN NOW() ELSE NULL END)
     ON CONFLICT (retribucion_id) DO NOTHING
     RETURNING id`, [opts.retribucionId, opts.tallerId, opts.montoARS, mpPaymentId ?? null, mpEstado, errorMsg ?? null]);
    // Actualizar retribución
    await (0, database_1.query)(`UPDATE retribuciones_aliado SET
       estado=CASE WHEN $2='ACREDITADO' THEN 'PAGADO' ELSE 'PENDIENTE' END,
       mp_payment_id=$3,
       pagado_en=CASE WHEN $2='ACREDITADO' THEN NOW() END
     WHERE id=$1`, [opts.retribucionId, mpEstado, mpPaymentId ?? null]);
    // Notificar al aliado
    if (mpEstado === 'ACREDITADO' && taller?.propietario_id) {
        await notificarAliado({
            propietarioId: taller.propietario_id,
            tallerNombre: taller.nombre,
            montoARS: opts.montoARS,
            numeroCIT: opts.numeroCIT,
            plan: opts.plan,
            pct,
            retribucionId: opts.retribucionId,
        });
    }
    logger_1.log.marketplace.info({
        tallerId: opts.tallerId.slice(0, 8),
        numeroCIT: opts.numeroCIT,
        plan: opts.plan,
        pct: `${pct}%`,
        montoARS: opts.montoARS,
        mpEstado,
        mpPaymentId: mpPaymentId?.slice(0, 15),
        modo,
    }, `💰 Retribución ${mpEstado}: $${opts.montoARS} ARS → ${opts.plan}`);
    return {
        pagoId: pagoRow.id,
        retribucionId: opts.retribucionId,
        tallerId: opts.tallerId,
        montoARS: opts.montoARS,
        mpEstado,
        estado: mpEstado,
        mpPaymentId,
        mensaje: mpEstado === 'ACREDITADO'
            ? `✅ $${opts.montoARS} ARS acreditados al taller (${opts.plan} ${pct}%)`
            : `⏳ $${opts.montoARS} ARS pendientes — ${errorMsg ?? 'sin cuenta MP'}`,
        plan: opts.plan,
        pctRetribucion: pct,
        modo,
    };
}
// ══════════════════════════════════════════════════════════
// HOOK — Llamar desde triggerCITAprobado (fire-and-forget)
// ══════════════════════════════════════════════════════════
/**
 * Registrar retribución Y disparar pago MP en un solo paso.
 * Fire-and-forget: errores de MP no bloquean la emisión del CIT.
 */
async function triggerRetribucionCIT(opts) {
    try {
        // 1. Registrar retribución (idempotente)
        const { registrarRetribucion } = await import('./aliado.panel.service');
        const ret = await registrarRetribucion({
            tallerId: opts.tallerId,
            citId: opts.citId,
            numeroCIT: opts.numeroCIT,
            inspectorId: opts.inspectorId,
            tasaCITARS: opts.tasaCITARS,
        });
        if (!ret.retribucionId) {
            logger_1.log.marketplace.warn({ citId: opts.citId.slice(0, 8) }, '⚠ Retribución ya existía');
            return;
        }
        // 2. Obtener datos del taller para conocer el plan
        const taller = await (0, database_1.queryOne)(`SELECT plan_aliado FROM talleres_aliados WHERE id=$1`, [opts.tallerId]);
        // 3. Pagar vía MP
        await pagarRetribucionMP({
            retribucionId: ret.retribucionId,
            tallerId: opts.tallerId,
            citId: opts.citId,
            numeroCIT: opts.numeroCIT,
            montoARS: ret.montoAliadoARS,
            plan: taller?.plan_aliado ?? 'PIONERO',
            inspectorId: opts.inspectorId,
        });
    }
    catch (err) {
        logger_1.log.marketplace.error({
            citId: opts.citId.slice(0, 8),
            err: err.message,
        }, '✗ Error en triggerRetribucionCIT — retribución pendiente para reproceso');
    }
}
// ══════════════════════════════════════════════════════════
// 2. LIQUIDACIÓN MENSUAL
// ══════════════════════════════════════════════════════════
async function liquidarMes(tallerId, mes, año) {
    // Obtener retribuciones PENDIENTE del período
    const retribuciones = await (0, database_1.query)(`SELECT id, numero_cit, tasa_cit_ars, monto_aliado_ars, porcentaje_aliado, plan_aliado
     FROM retribuciones_aliado
     WHERE taller_id=$1 AND periodo_mes=$2 AND periodo_año=$3
       AND estado IN ('PENDIENTE','CALCULADO')
     ORDER BY creado_en`, [tallerId, mes, año]);
    if (retribuciones.length === 0) {
        throw new Error(`Sin retribuciones pendientes para ${MESES[mes]} ${año}`);
    }
    const totalTasaARS = retribuciones.reduce((s, r) => s + parseFloat(r.tasa_cit_ars), 0);
    const totalAliadoARS = retribuciones.reduce((s, r) => s + parseFloat(r.monto_aliado_ars), 0);
    const totalRodaidARS = Math.round((totalTasaARS - totalAliadoARS) * 100) / 100;
    const citsCount = retribuciones.length;
    // Idempotencia — evitar doble liquidación
    const yaLiquidada = await (0, database_1.queryOne)(`SELECT id, estado FROM liquidaciones_aliado
     WHERE taller_id=$1 AND periodo_mes=$2 AND periodo_año=$3`, [tallerId, mes, año]);
    if (yaLiquidada) {
        throw new Error(`Período ${MESES[mes]} ${año} ya liquidado (${yaLiquidada.estado})`);
    }
    // Emisión de pago MP consolidado
    let mpPaymentId;
    let mpEstado = 'PENDIENTE';
    const taller = await (0, database_1.queryOne)(`SELECT nombre, mp_user_id, propietario_id FROM talleres_aliados WHERE id=$1`, [tallerId]);
    if (MODO_STUB) {
        mpPaymentId = `STUB_LIQ_${tallerId.slice(0, 8)}_${mes}${año}`;
        mpEstado = 'PAGADA';
    }
    else if (taller?.mp_user_id) {
        try {
            const resp = await fetch(`${MP_BASE}/v1/payments`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${MP_TOKEN}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': `liq-${tallerId}-${mes}-${año}`,
                },
                body: JSON.stringify({
                    transaction_amount: totalAliadoARS,
                    description: `Liquidación RODAID ${MESES[mes]} ${año} — ${citsCount} CITs`,
                    payment_method_id: 'account_money',
                    receiver_id: parseInt(taller.mp_user_id),
                    metadata: { tallerId, mes, año, cits: citsCount },
                }),
                signal: AbortSignal.timeout(10_000),
            });
            const body = await resp.json();
            mpPaymentId = String(body.id);
            mpEstado = body.status === 'approved' ? 'PAGADA' : 'PENDIENTE';
        }
        catch (err) {
            logger_1.log.marketplace.error({ err: err.message }, '✗ Error MP en liquidación');
        }
    }
    // INSERT liquidación
    const liqRow = await (0, database_1.queryOne)(`INSERT INTO liquidaciones_aliado
       (taller_id, periodo_mes, periodo_año, cits_count, total_tasa_ars, total_aliado_ars, total_rodaid_ars,
        estado, mp_payment_id, referencia_pago, pagado_en, detalle)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     RETURNING id`, [
        tallerId, mes, año, citsCount, totalTasaARS, totalAliadoARS, totalRodaidARS,
        mpEstado, mpPaymentId ?? null,
        `LIQ-${tallerId.slice(0, 8)}-${mes}-${año}`,
        mpEstado === 'PAGADA' ? new Date().toISOString() : null,
        JSON.stringify({ retribucionIds: retribuciones.map((r) => r.id) }),
    ]);
    // Marcar retribuciones como liquidadas
    await (0, database_1.query)(`UPDATE retribuciones_aliado SET
       estado='LIQUIDADO', liquidacion_id=$2, liquidado_en=NOW()
     WHERE taller_id=$1 AND periodo_mes=$3 AND periodo_año=$4 AND estado IN ('PENDIENTE','CALCULADO')`, [tallerId, liqRow.id, mes, año]);
    // Notificar al aliado
    if (taller?.propietario_id) {
        await (0, database_1.query)(`INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
       VALUES ($1,'LIQUIDACION_ALIADO','💰 Liquidación mensual acreditada',$2,$3::jsonb)`, [
            taller.propietario_id,
            `$${totalAliadoARS.toFixed(0)} ARS por ${citsCount} CITs en ${MESES[mes]} ${año}.`,
            JSON.stringify({ liquidacionId: liqRow.id, totalARS: totalAliadoARS, citsCount }),
        ]).catch(() => { });
    }
    logger_1.log.marketplace.info({
        tallerId: tallerId.slice(0, 8), taller: taller?.nombre,
        mes, año, citsCount, totalAliadoARS, mpEstado,
    }, `📋 Liquidación ${MESES[mes]} ${año}: $${totalAliadoARS} ARS (${citsCount} CITs)`);
    return {
        liquidacionId: liqRow.id,
        tallerId,
        mesLabel: `${MESES[mes]} ${año}`,
        citsCount,
        totalTasaARS: Math.round(totalTasaARS * 100) / 100,
        totalAliadoARS: Math.round(totalAliadoARS * 100) / 100,
        totalRodaidARS,
        mpEstado,
        estado: mpEstado,
        mpPaymentId,
        detalleRetrib: retribuciones.map((r) => ({
            retribucionId: r.id,
            numeroCIT: r.numero_cit,
            tasaARS: parseFloat(r.tasa_cit_ars),
            montoARS: parseFloat(r.monto_aliado_ars),
            pctRetribucion: parseFloat(r.porcentaje_aliado),
            plan: r.plan_aliado,
        })),
    };
}
// ══════════════════════════════════════════════════════════
// 3. REPROCESAR PENDIENTES
// ══════════════════════════════════════════════════════════
async function reprocesarRetribucionesPendientes() {
    // Retribuciones con pago en estado PENDIENTE hace más de 5 minutos
    const pendientes = await (0, database_1.query)(`SELECT rp.id AS pago_id, rp.retribucion_id, rp.taller_id, rp.monto_ars,
            ra.numero_cit, ra.plan_aliado, ra.cit_id
     FROM retribucion_pagos rp
     JOIN retribuciones_aliado ra ON ra.id=rp.retribucion_id
     WHERE rp.mp_estado='PENDIENTE'
       AND rp.procesado_en < NOW() - INTERVAL '5 minutes'
     ORDER BY rp.procesado_en LIMIT 50`, []);
    let acreditadas = 0;
    for (const p of pendientes) {
        const result = await pagarRetribucionMP({
            retribucionId: p.retribucion_id,
            tallerId: p.taller_id,
            citId: p.cit_id,
            numeroCIT: p.numero_cit,
            montoARS: parseFloat(p.monto_ars),
            plan: p.plan_aliado,
        }).catch(() => null);
        if (result?.mpEstado === 'ACREDITADO')
            acreditadas++;
    }
    return { procesadas: pendientes.length, acreditadas, pendientes: pendientes.length - acreditadas };
}
// ══════════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════════
async function getResumenRetribuciones(tallerId, dias = 30) {
    const [resumen, porPlan, tendencia] = await Promise.all([
        (0, database_1.queryOne)(`SELECT COUNT(*)::int                                            AS total,
              COUNT(*) FILTER(WHERE ra.estado='PAGADO')::int          AS pagadas,
              COUNT(*) FILTER(WHERE ra.estado='PENDIENTE')::int       AS pendientes,
              COALESCE(SUM(ra.monto_aliado_ars),0)::numeric           AS total_aliado_ars,
              COALESCE(SUM(ra.tasa_cit_ars),0)::numeric               AS total_tasa_ars,
              COALESCE(SUM(ra.monto_rodaid_ars),0)::numeric           AS total_rodaid_ars,
              ROUND(AVG(ra.porcentaje_aliado),1)::numeric             AS pct_promedio
       FROM retribuciones_aliado ra
       WHERE ra.taller_id=$1 AND ra.creado_en > NOW()-($2||' days')::interval`, [tallerId, dias]),
        (0, database_1.query)(`SELECT ra.plan_aliado AS plan,
              COUNT(*)::int AS cits,
              COALESCE(SUM(ra.monto_aliado_ars),0)::numeric AS total_ars
       FROM retribuciones_aliado ra
       WHERE ra.taller_id=$1 AND ra.creado_en > NOW()-($2||' days')::interval
       GROUP BY ra.plan_aliado`, [tallerId, dias]),
        (0, database_1.query)(`SELECT ra.periodo_mes AS mes, ra.periodo_año AS año,
              COUNT(*)::int AS cits,
              COALESCE(SUM(ra.monto_aliado_ars),0)::numeric AS aliado_ars
       FROM retribuciones_aliado ra
       WHERE ra.taller_id=$1 AND ra.creado_en > NOW() - INTERVAL '6 months'
       GROUP BY ra.periodo_mes, ra.periodo_año ORDER BY ra.periodo_año, ra.periodo_mes`, [tallerId]),
    ]);
    const liquidaciones = await (0, database_1.query)(`SELECT id, periodo_mes, periodo_año, cits_count, total_aliado_ars, estado, pagado_en, mp_payment_id
     FROM liquidaciones_aliado WHERE taller_id=$1 ORDER BY periodo_año DESC, periodo_mes DESC LIMIT 6`, [tallerId]);
    return {
        modoMP: MODO_STUB ? 'STUB' : 'LIVE',
        dias,
        resumen,
        porPlan,
        tendencia: tendencia.map((t) => ({ ...t, mesLabel: `${MESES[t.mes]} ${t.año}` })),
        liquidaciones: liquidaciones.map((l) => ({
            ...l, mesLabel: `${MESES[l.periodo_mes]} ${l.periodo_año}`,
        })),
    };
}
async function getRetribucionesTaller(tallerId, pagina = 1, porPagina = 25) {
    const offset = (pagina - 1) * porPagina;
    const [rows, total] = await Promise.all([
        (0, database_1.query)(`SELECT ra.id, ra.numero_cit, ra.tasa_cit_ars, ra.monto_aliado_ars,
              ra.porcentaje_aliado, ra.plan_aliado, ra.estado,
              ra.mp_payment_id, ra.pagado_en, ra.creado_en,
              rp.mp_estado, rp.acreditado_en
       FROM retribuciones_aliado ra
       LEFT JOIN retribucion_pagos rp ON rp.retribucion_id=ra.id
       WHERE ra.taller_id=$1
       ORDER BY ra.creado_en DESC LIMIT $2 OFFSET $3`, [tallerId, porPagina, offset]),
        (0, database_1.queryOne)(`SELECT COUNT(*)::text AS count FROM retribuciones_aliado WHERE taller_id=$1`, [tallerId]),
    ]);
    return { retribuciones: rows, total: parseInt(total?.count ?? '0'), pagina, porPagina };
}
// ══════════════════════════════════════════════════════════
// NOTIFICACIONES
// ══════════════════════════════════════════════════════════
async function notificarAliado(opts) {
    await (0, database_1.query)(`INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
     VALUES ($1,'RETRIBUCION_CIT','💰 ¡Retribución por CIT acreditada!',$2,$3::jsonb)
     ON CONFLICT DO NOTHING`, [
        opts.propietarioId,
        `$${opts.montoARS.toFixed(0)} ARS por el CIT ${opts.numeroCIT} (plan ${opts.plan} — ${opts.pct}%).`,
        JSON.stringify({
            retribucionId: opts.retribucionId,
            numeroCIT: opts.numeroCIT,
            montoARS: opts.montoARS,
            plan: opts.plan,
            pct: opts.pct,
        }),
    ]).catch(() => { });
    import('./device_token.service').then(dt => dt.enviarPush(opts.propietarioId, {
        titulo: '💰 Retribución acreditada',
        cuerpo: `$${opts.montoARS.toFixed(0)} ARS por CIT ${opts.numeroCIT} (${opts.plan} ${opts.pct}%)`,
        datos: { tipo: 'RETRIBUCION_CIT', retribucionId: opts.retribucionId, numeroCIT: opts.numeroCIT },
    })).catch(() => { });
}
