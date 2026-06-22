"use strict";
// ─── RODAID · Servicio de Comisiones ────────────────────
// Retención automática del 2.5% al confirmar la entrega.
//
// Tasas por plan del vendedor:
//   Plan Libre:     2.5%  (COMISION_RATES.LIBRE)
//   Plan Estándar:  1.8%  (COMISION_RATES.ESTANDAR)
//   Plan Premium:   1.2%  (COMISION_RATES.PREMIUM)
//
// Flujo:
//   1. confirmarEntrega() → registrarComision()
//   2. La comisión ya está RETENIDA en el escrow desde el depósito.
//      RODAID libera solo (precio - comisión) al vendedor.
//   3. Estado ACREDITADA cuando MercadoPago transfiere a la cuenta RODAID.
//   4. Estado DEVUELTA si se emite un reembolso.
//
// Integración con MP:
//   MercadoPago también cobra su propia comisión de gateway.
//   La comisión_neta_ars = comision_rodaid - costo_mp
//
// Reporting:
//   · Por período (mes/año)
//   · Por vendedor (para el panel del aliado)
//   · Totales para el dashboard admin
//   · Proyección de ingresos
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASAS = void 0;
exports.calcularComision = calcularComision;
exports.registrarComision = registrarComision;
exports.acreditarComision = acreditarComision;
exports.devolverComision = devolverComision;
exports.getResumenPeriodo = getResumenPeriodo;
exports.getHistorialComisiones = getHistorialComisiones;
exports.getBreakdownMensual = getBreakdownMensual;
exports.getTopVendedores = getTopVendedores;
exports.getProyeccionMes = getProyeccionMes;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// TASAS VIGENTES
// ══════════════════════════════════════════════════════════
exports.TASAS = {
    LIBRE: 0.0250,
    ESTANDAR: 0.0180,
    PREMIUM: 0.0120,
};
/** Costo estimado de MercadoPago según medio de pago (Argentina 2026) */
const COSTO_MP = {
    credit_card: 0.0499, // tarjeta de crédito ~4.99% + IVA
    debit_card: 0.0199, // débito ~1.99% + IVA
    account_money: 0, // dinero en cuenta MP: sin costo
    ticket: 0.0499, // efectivo (PagoFácil, Rapipago) ~4.99%
    bank_transfer: 0.0099, // transferencia bancaria ~0.99%
    DEFAULT: 0.0399, // estimado conservador si no se conoce el medio
};
// ══════════════════════════════════════════════════════════
// CALCULAR COMISIÓN
// ══════════════════════════════════════════════════════════
function calcularComision(precioVentaARS, planVendedor = 'LIBRE', metodoPago = 'DEFAULT') {
    const plan = planVendedor.toUpperCase();
    const tasa = exports.TASAS[plan] ?? exports.TASAS['LIBRE'];
    const tasaMp = COSTO_MP[metodoPago] ?? COSTO_MP['DEFAULT'];
    const comisionARS = Math.round(precioVentaARS * tasa * 100) / 100;
    const montoVendedorARS = Math.round((precioVentaARS - comisionARS) * 100) / 100;
    const comisionMpARS = Math.round(precioVentaARS * tasaMp * 100) / 100;
    const comisionNetaARS = Math.round((comisionARS - comisionMpARS) * 100) / 100;
    return {
        precioVentaARS,
        tasaComision: tasa,
        tasaPct: `${(tasa * 100).toFixed(2)}%`,
        planVendedor: plan,
        comisionARS,
        montoVendedorARS,
        comisionMpARS,
        comisionNetaARS,
    };
}
// ══════════════════════════════════════════════════════════
// REGISTRAR COMISIÓN (al confirmar entrega)
// ══════════════════════════════════════════════════════════
async function registrarComision(opts) {
    // Obtener plan del vendedor
    const vendedor = await (0, database_1.queryOne)(`SELECT plan_suscripcion FROM usuarios WHERE id=$1`, [opts.vendedorId]);
    const plan = vendedor?.plan_suscripcion ?? 'LIBRE';
    // Obtener datos del CIT (serial + numeroCIT)
    const cit = await (0, database_1.queryOne)(`SELECT c.numero_cit, b.numero_serie AS serial
     FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id WHERE c.id=$1`, [opts.citId]);
    // Calcular
    const calc = calcularComision(opts.precioVentaARS, plan, opts.metodoPago);
    // Insertar en rodaid_comisiones
    const row = await (0, database_1.queryOne)(`INSERT INTO rodaid_comisiones
       (transaccion_id, vendedor_id, comprador_id, cit_id,
        precio_venta_ars, tasa_comision, plan_vendedor,
        comision_ars, monto_vendedor_ars, comision_mp_ars, comision_neta_ars,
        serial_bicicleta, numero_cit, gateway, mp_payment_id, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'RETENIDA')
     RETURNING id, venta_en`, [
        opts.transaccionId, opts.vendedorId, opts.compradorId, opts.citId,
        calc.precioVentaARS, calc.tasaComision, calc.planVendedor,
        calc.comisionARS, calc.montoVendedorARS, calc.comisionMpARS, calc.comisionNetaARS,
        cit?.serial ?? null, cit?.numero_cit ?? null,
        opts.gateway ?? 'STUB', opts.mpPaymentId ?? null,
    ]);
    logger_1.log.escrow.info({
        transaccionId: opts.transaccionId,
        plan: calc.planVendedor,
        tasa: calc.tasaPct,
        precioVentaARS: calc.precioVentaARS,
        comisionARS: calc.comisionARS,
        montoVendedorARS: calc.montoVendedorARS,
        comisionNetaARS: calc.comisionNetaARS,
        numeroCIT: cit?.numero_cit,
    }, `💰 Comisión registrada: ${calc.tasaPct} de $${calc.precioVentaARS.toLocaleString('es-AR')} = $${calc.comisionARS.toLocaleString('es-AR')}`);
    return {
        id: row.id,
        transaccionId: opts.transaccionId,
        vendedorId: opts.vendedorId,
        compradorId: opts.compradorId,
        citId: opts.citId,
        precioVentaARS: calc.precioVentaARS,
        comisionARS: calc.comisionARS,
        montoVendedorARS: calc.montoVendedorARS,
        comisionNetaARS: calc.comisionNetaARS,
        tasaComision: calc.tasaComision,
        planVendedor: calc.planVendedor,
        estado: 'RETENIDA',
        serialBicicleta: cit?.serial,
        numeroCIT: cit?.numero_cit,
        gateway: opts.gateway ?? 'STUB',
        ventaEn: row.venta_en,
    };
}
// ══════════════════════════════════════════════════════════
// ACREDITAR COMISIÓN (cuando MP transfiere a cuenta RODAID)
// ══════════════════════════════════════════════════════════
async function acreditarComision(transaccionId) {
    await (0, database_1.query)(`UPDATE rodaid_comisiones
     SET estado='ACREDITADA', acreditada_en=NOW()
     WHERE transaccion_id=$1 AND estado='RETENIDA'`, [transaccionId]);
    logger_1.log.escrow.info({ transaccionId }, '✓ Comisión ACREDITADA');
}
// ══════════════════════════════════════════════════════════
// DEVOLVER COMISIÓN (reembolso / cancelación)
// ══════════════════════════════════════════════════════════
async function devolverComision(transaccionId) {
    await (0, database_1.query)(`UPDATE rodaid_comisiones
     SET estado='DEVUELTA', devuelta_en=NOW()
     WHERE transaccion_id=$1`, [transaccionId]);
    logger_1.log.escrow.info({ transaccionId }, '↩ Comisión DEVUELTA (reembolso)');
}
// ══════════════════════════════════════════════════════════
// REPORTING
// ══════════════════════════════════════════════════════════
/** Resumen por período (mes, año, o total) */
async function getResumenPeriodo(opts) {
    const params = [];
    const conds = ["estado != 'DEVUELTA'"];
    if (opts.desde) {
        params.push(opts.desde);
        conds.push(`venta_en >= $${params.length}`);
    }
    if (opts.hasta) {
        params.push(opts.hasta);
        conds.push(`venta_en < $${params.length}`);
    }
    if (opts.vendedorId) {
        params.push(opts.vendedorId);
        conds.push(`vendedor_id = $${params.length}`);
    }
    const where = conds.join(' AND ');
    const row = await (0, database_1.queryOne)(`SELECT
       COUNT(*)::text                AS total_ventas,
       COALESCE(SUM(precio_venta_ars),0)::text  AS volumen,
       COALESCE(SUM(comision_ars),0)::text       AS comision_bruta,
       COALESCE(SUM(comision_mp_ars),0)::text    AS costo_gw,
       COALESCE(SUM(comision_neta_ars),0)::text  AS comision_neta,
       COALESCE(AVG(tasa_comision)*100,0)::text  AS tasa_prom,
       (SELECT COUNT(*) FROM rodaid_comisiones WHERE estado='DEVUELTA')::text AS devols
     FROM rodaid_comisiones WHERE ${where}`, params);
    const volumen = parseFloat(row?.volumen ?? '0');
    const comisionBruta = parseFloat(row?.comision_bruta ?? '0');
    return {
        periodo: opts.desde
            ? `${opts.desde.toISOString().slice(0, 7)}`
            : 'total',
        totalVentas: parseInt(row?.total_ventas ?? '0'),
        volumenARS: volumen,
        comisionBrutaARS: comisionBruta,
        costoGatewayARS: parseFloat(row?.costo_gw ?? '0'),
        comisionNetaARS: parseFloat(row?.comision_neta ?? '0'),
        tasaPromedioARS: volumen > 0 ? comisionBruta / volumen * 100 : 0,
        devoluciones: parseInt(row?.devols ?? '0'),
    };
}
/** Historial de comisiones con paginación */
async function getHistorialComisiones(opts) {
    const pagina = Math.max(1, opts.pagina ?? 1);
    const limite = Math.min(100, opts.limite ?? 50);
    const offset = (pagina - 1) * limite;
    const params = [];
    const conds = [];
    if (opts.desde) {
        params.push(opts.desde);
        conds.push(`c.venta_en >= $${params.length}`);
    }
    if (opts.hasta) {
        params.push(opts.hasta);
        conds.push(`c.venta_en < $${params.length}`);
    }
    if (opts.vendedorId) {
        params.push(opts.vendedorId);
        conds.push(`c.vendedor_id = $${params.length}`);
    }
    if (opts.estado) {
        params.push(opts.estado);
        conds.push(`c.estado = $${params.length}`);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limite, offset);
    const lp = params.length - 1;
    const op = params.length;
    const [rows, totRow] = await Promise.all([
        (0, database_1.query)(`SELECT c.id, c.transaccion_id, c.vendedor_id, c.comprador_id, c.cit_id,
              c.precio_venta_ars, c.comision_ars, c.monto_vendedor_ars,
              c.comision_neta_ars, c.tasa_comision, c.plan_vendedor, c.estado,
              c.serial_bicicleta, c.numero_cit, c.gateway, c.venta_en,
              c.acreditada_en, c.devuelta_en,
              u.nombre AS vendedor_nombre, u.email AS vendedor_email
       FROM rodaid_comisiones c
       JOIN usuarios u ON u.id=c.vendedor_id
       ${where}
       ORDER BY c.venta_en DESC
       LIMIT $${lp} OFFSET $${op}`, params),
        (0, database_1.queryOne)(`SELECT COUNT(*)::text AS n,
              COALESCE(SUM(comision_ars),0)::text AS sum_com,
              COALESCE(SUM(precio_venta_ars),0)::text AS sum_vol
       FROM rodaid_comisiones c ${where}`, params.slice(0, -2)),
    ]);
    return {
        comisiones: rows.map((r) => ({
            id: r.id,
            transaccionId: r.transaccion_id,
            vendedorId: r.vendedor_id,
            compradorId: r.comprador_id,
            citId: r.cit_id,
            precioVentaARS: parseFloat(r.precio_venta_ars),
            comisionARS: parseFloat(r.comision_ars),
            montoVendedorARS: parseFloat(r.monto_vendedor_ars),
            comisionNetaARS: parseFloat(r.comision_neta_ars),
            tasaComision: parseFloat(r.tasa_comision),
            planVendedor: r.plan_vendedor,
            estado: r.estado,
            serialBicicleta: r.serial_bicicleta ?? undefined,
            numeroCIT: r.numero_cit ?? undefined,
            gateway: r.gateway,
            ventaEn: new Date(r.venta_en),
            acreditadaEn: r.acreditada_en ? new Date(r.acreditada_en) : undefined,
            devueltaEn: r.devuelta_en ? new Date(r.devuelta_en) : undefined,
        })),
        total: parseInt(totRow?.n ?? '0'),
        resumen: {
            comisionTotalARS: parseFloat(totRow?.sum_com ?? '0'),
            volumenTotalARS: parseFloat(totRow?.sum_vol ?? '0'),
        },
    };
}
/** Breakdown mensual para el dashboard */
async function getBreakdownMensual(anio) {
    const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const rows = await (0, database_1.query)(`SELECT
       EXTRACT(MONTH FROM venta_en)::text    AS mes,
       COUNT(*) FILTER (WHERE estado!='DEVUELTA')::text  AS ventas,
       COALESCE(SUM(precio_venta_ars) FILTER (WHERE estado!='DEVUELTA'),0)::text AS volumen,
       COALESCE(SUM(comision_ars) FILTER (WHERE estado!='DEVUELTA'),0)::text     AS comision,
       COALESCE(SUM(comision_neta_ars) FILTER (WHERE estado!='DEVUELTA'),0)::text AS neta,
       COUNT(*) FILTER (WHERE estado='DEVUELTA')::text   AS devols
     FROM rodaid_comisiones
     WHERE EXTRACT(YEAR FROM venta_en)=$1
     GROUP BY EXTRACT(MONTH FROM venta_en)
     ORDER BY mes`, [anio]);
    return rows.map(r => {
        const mes = parseInt(r.mes);
        return {
            mes,
            mesNombre: MESES[mes - 1] ?? '',
            totalVentas: parseInt(r.ventas),
            volumenARS: parseFloat(r.volumen),
            comisionARS: parseFloat(r.comision),
            comisionNetaARS: parseFloat(r.neta),
            devoluciones: parseInt(r.devols),
        };
    });
}
/** Top vendedores por volumen de ventas */
async function getTopVendedores(opts) {
    const params = [];
    const conds = ["rc.estado != 'DEVUELTA'"];
    if (opts.desde) {
        params.push(opts.desde);
        conds.push(`rc.venta_en >= $${params.length}`);
    }
    if (opts.hasta) {
        params.push(opts.hasta);
        conds.push(`rc.venta_en < $${params.length}`);
    }
    params.push(opts.limit ?? 10);
    return (0, database_1.query)(`SELECT rc.vendedor_id, u.nombre, u.email, rc.plan_vendedor AS plan,
            COUNT(*)::int AS total_ventas,
            SUM(rc.precio_venta_ars)::float AS volumen_ars,
            SUM(rc.comision_ars)::float AS comision_ars
     FROM rodaid_comisiones rc
     JOIN usuarios u ON u.id=rc.vendedor_id
     WHERE ${conds.join(' AND ')}
     GROUP BY rc.vendedor_id, u.nombre, u.email, rc.plan_vendedor
     ORDER BY volumen_ars DESC
     LIMIT $${params.length}`, params).then(rows => rows.map((r) => ({
        vendedorId: r.vendedor_id,
        nombre: r.nombre,
        email: r.email,
        plan: r.plan,
        totalVentas: r.total_ventas,
        volumenARS: r.volumen_ars,
        comisionARS: r.comision_ars,
    })));
}
/** Proyección del mes actual */
async function getProyeccionMes() {
    const ahora = new Date();
    const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
    const diasMes = Math.round((fin.getTime() - inicio.getTime()) / 86400_000);
    const diasTranscurridos = Math.max(1, Math.round((ahora.getTime() - inicio.getTime()) / 86400_000));
    const row = await (0, database_1.queryOne)(`SELECT COALESCE(SUM(comision_ars),0)::text AS comision,
            COALESCE(SUM(precio_venta_ars),0)::text AS volumen
     FROM rodaid_comisiones
     WHERE venta_en >= $1 AND estado != 'DEVUELTA'`, [inicio]);
    const comisionActualARS = parseFloat(row?.comision ?? '0');
    const volumenActualARS = parseFloat(row?.volumen ?? '0');
    const factor = diasMes / diasTranscurridos;
    return {
        diasTranscurridos,
        diasTotales: diasMes,
        comisionActualARS,
        proyeccionARS: Math.round(comisionActualARS * factor),
        volumenActualARS,
        proyeccionVolumenARS: Math.round(volumenActualARS * factor),
    };
}
