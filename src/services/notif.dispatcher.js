"use strict";
// ─── RODAID · Dispatcher de Notificaciones ───────────────
// Conecta los eventos de negocio a los canales de notificación:
//   · FCM push (web + Android)
//   · Email (Resend)
//   · MxM canal gubernamental
//   · In-app (tabla notificaciones)
//
// Todos los dispatchers son fire-and-forget desde los servicios
// de negocio — nunca bloquean el flujo principal.
//
// Eventos cubiertos:
//   notificarCITEmitido       — CIT activo en BFA
//   notificarTasaConfirmada   — pago de tasa procesado
//   notificarDenunciaRobo     — bicicleta denunciada
//   notificarBiciRecuperada   — bicicleta recuperada
//   notificarVenta            — escrow completado (vendedor + comprador)
//   notificarDisputa          — disputa abierta (ambas partes)
//   notificarSistema          — mensaje general
Object.defineProperty(exports, "__esModule", { value: true });
exports.despacharCITEmitido = despacharCITEmitido;
exports.despacharTasaConfirmada = despacharTasaConfirmada;
exports.despacharDenunciaRobo = despacharDenunciaRobo;
exports.despacharBiciRecuperada = despacharBiciRecuperada;
exports.despacharVentaCompletada = despacharVentaCompletada;
exports.despacharNFTTransferido = despacharNFTTransferido;
exports.despacharDisputaAbierta = despacharDisputaAbierta;
exports.despacharSistema = despacharSistema;
const logger_1 = require("../middleware/logger");
const database_1 = require("../config/database");
const fcm_service_1 = require("./fcm.service");
const apns_service_1 = require("./apns.service");
const email_service_1 = require("./email.service");
const mxm_notificaciones_service_1 = require("./mxm.notificaciones.service");
// ══════════════════════════════════════════════════════════
// HELPER: obtener datos del usuario para notificaciones
// ══════════════════════════════════════════════════════════
async function getUsuarioNotif(userId) {
    return (0, database_1.queryOne)(`SELECT email, nombre, apellido,
            COALESCE(nombre || ' ' || apellido, email) AS "nombreCompleto"
     FROM usuarios WHERE id=$1`, [userId]);
}
// Fire-and-forget wrapper con logging
function despachar(nombre, fn) {
    fn().catch(err => logger_1.log.mensajeria.error({ evento: nombre, err: err.message }, `Error despachando ${nombre}`));
}
// ══════════════════════════════════════════════════════════
// 1. CIT EMITIDO (BFA on-chain)
// ══════════════════════════════════════════════════════════
function despacharCITEmitido(opts) {
    despachar('CITEmitido', async () => {
        const u = await getUsuarioNotif(opts.usuarioId);
        if (!u)
            return;
        await Promise.allSettled([
            // Push FCM (Android + Web) + APNs (iOS nativo si aplica)
            (0, apns_service_1.enviarAPNsUsuario)(opts.usuarioId, { titulo: `✅ CIT emitido: ${opts.numeroCIT}`, cuerpo: `${opts.marca} ${opts.modelo} certificada bajo Ley 9556`, badge: 1, mutableContent: true, collapseId: `cit-${opts.numeroCIT}`, datos: { tipo: 'CIT_APROBADO', numeroCIT: opts.numeroCIT } }),
            (0, fcm_service_1.enviarPushUsuario)(opts.usuarioId, {
                titulo: `✅ CIT emitido: ${opts.numeroCIT}`,
                cuerpo: `${opts.marca} ${opts.modelo} certificada bajo Ley 9556`,
                clickUrl: `${process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'}/cit/${opts.numeroCIT}`,
                datos: { tipo: 'CIT_APROBADO', numeroCIT: opts.numeroCIT, serial: opts.serial },
            }),
            // Email
            (0, email_service_1.emailCITEmitido)({ to: u.email, nombre: u.nombre ?? u.email, ...opts }),
            // MxM (canal gubernamental)
            (0, mxm_notificaciones_service_1.notifCITEmitido)({ usuarioId: opts.usuarioId, numeroCIT: opts.numeroCIT, serial: opts.serial, marca: opts.marca, modelo: opts.modelo, txHash: opts.txHash }),
        ]);
        logger_1.log.mensajeria.info({ numeroCIT: opts.numeroCIT, usuarioId: opts.usuarioId.slice(0, 8) }, '✓ Notificaciones CIT emitido enviadas (FCM + Email + MxM)');
    });
}
// ══════════════════════════════════════════════════════════
// 2. TASA CIT CONFIRMADA
// ══════════════════════════════════════════════════════════
function despacharTasaConfirmada(opts) {
    despachar('TasaConfirmada', async () => {
        const u = await getUsuarioNotif(opts.usuarioId);
        if (!u)
            return;
        await Promise.allSettled([
            (0, fcm_service_1.enviarPushUsuario)(opts.usuarioId, {
                titulo: `💳 Tasa confirmada — $${opts.montoARS.toLocaleString('es-AR')} ARS`,
                cuerpo: 'Tu pago fue acreditado. Podés continuar con la emisión del CIT.',
                datos: { tipo: 'TASA_CONFIRMADA', pagoId: opts.pagoId },
            }),
            (0, email_service_1.emailTasaConfirmada)({ to: u.email, nombre: u.nombre ?? u.email, ...opts }),
            (0, mxm_notificaciones_service_1.notifTasaConfirmada)({ usuarioId: opts.usuarioId, montoARS: opts.montoARS, pagoId: opts.pagoId, numeroCIT: opts.numeroCIT }),
        ]);
    });
}
// ══════════════════════════════════════════════════════════
// 3. DENUNCIA DE ROBO
// ══════════════════════════════════════════════════════════
function despacharDenunciaRobo(opts) {
    despachar('DenunciaRobo', async () => {
        const u = await getUsuarioNotif(opts.usuarioId);
        if (!u)
            return;
        await Promise.allSettled([
            (0, fcm_service_1.enviarPushUsuario)(opts.usuarioId, {
                titulo: `🚨 Denuncia registrada — ${opts.serial}`,
                cuerpo: `CIT bloqueado. Denuncia N° ${opts.numeroDenuncia}`,
                datos: { tipo: 'DENUNCIA_REGISTRADA', serial: opts.serial, numeroDenuncia: opts.numeroDenuncia },
            }),
            (0, email_service_1.emailDenunciaRobo)({ to: u.email, nombre: u.nombre ?? u.email, ...opts }),
            (0, mxm_notificaciones_service_1.notifDenunciaRobo)({ usuarioId: opts.usuarioId, serial: opts.serial, marca: opts.marca, modelo: opts.modelo, numeroDenuncia: opts.numeroDenuncia }),
        ]);
    });
}
// ══════════════════════════════════════════════════════════
// 4. BICICLETA RECUPERADA
// ══════════════════════════════════════════════════════════
function despacharBiciRecuperada(opts) {
    despachar('BiciRecuperada', async () => {
        const u = await getUsuarioNotif(opts.usuarioId);
        if (!u)
            return;
        await Promise.allSettled([
            (0, fcm_service_1.enviarPushUsuario)(opts.usuarioId, {
                titulo: `🎉 Bicicleta recuperada`,
                cuerpo: `${opts.marca} ${opts.modelo} marcada como recuperada. CIT activo nuevamente.`,
                datos: { tipo: 'BICI_RECUPERADA', serial: opts.serial },
            }),
            (0, mxm_notificaciones_service_1.notifBiciRecuperada)({ usuarioId: opts.usuarioId, serial: opts.serial, marca: opts.marca, modelo: opts.modelo }),
        ]);
    });
}
// ══════════════════════════════════════════════════════════
// 5. VENTA COMPLETADA (escrow → COMPLETADA)
// ══════════════════════════════════════════════════════════
function despacharVentaCompletada(opts) {
    despachar('VentaCompletada', async () => {
        const [vendedor, comprador] = await Promise.all([
            getUsuarioNotif(opts.vendedorId),
            getUsuarioNotif(opts.compradorId),
        ]);
        const neto = opts.montoARS - opts.comisionARS;
        await Promise.allSettled([
            // Vendedor: FCM + Email + MxM
            vendedor && (0, fcm_service_1.enviarPushUsuario)(opts.vendedorId, {
                titulo: `💰 Venta confirmada — $${neto.toLocaleString('es-AR')} ARS`,
                cuerpo: `${opts.marca} ${opts.modelo} vendida. Fondos acreditados.`,
                datos: { tipo: 'VENTA_CONFIRMADA', montoNeto: String(neto) },
            }),
            vendedor && (0, email_service_1.emailVentaConfirmada)({
                to: vendedor.email, nombre: vendedor.nombre ?? vendedor.email, ...opts,
            }),
            // Comprador: FCM + Email + MxM
            comprador && (0, fcm_service_1.enviarPushUsuario)(opts.compradorId, {
                titulo: `✅ Compra completada — ${opts.marca} ${opts.modelo}`,
                cuerpo: `Tu confirmación liberó $${neto.toLocaleString('es-AR')} ARS al vendedor.`,
                datos: { tipo: 'COMPRA_COMPLETADA', serial: opts.serial },
            }),
            comprador && (0, email_service_1.emailCompraCompletada)({
                to: comprador.email, nombre: comprador.nombre ?? comprador.email, ...opts,
            }),
            // MxM (ambos)
            (0, mxm_notificaciones_service_1.notifVentaConfirmada)({ vendedorId: opts.vendedorId, compradorId: opts.compradorId, montoARS: opts.montoARS, comisionARS: opts.comisionARS, serial: opts.serial, marca: opts.marca, modelo: opts.modelo }),
        ]);
        logger_1.log.mensajeria.info({
            vendedorId: opts.vendedorId.slice(0, 8), compradorId: opts.compradorId.slice(0, 8),
            neto, serial: opts.serial,
        }, '✓ Notificaciones venta completada enviadas');
    });
}
// ══════════════════════════════════════════════════════════
// 6. NFT TRANSFERIDO
// ══════════════════════════════════════════════════════════
function despacharNFTTransferido(opts) {
    despachar('NFTTransferido', async () => {
        const u = await getUsuarioNotif(opts.compradorId);
        if (!u)
            return;
        await Promise.allSettled([
            (0, fcm_service_1.enviarPushUsuario)(opts.compradorId, {
                titulo: `⛓ CIT transferido on-chain`,
                cuerpo: `${opts.numeroCIT} ahora está en tu nombre en la BFA.`,
                datos: { tipo: 'NFT_TRANSFERIDO', txHash: opts.txHash.slice(0, 20), numeroCIT: opts.numeroCIT },
            }),
            (0, mxm_notificaciones_service_1.notifNFTTransferido)({ compradorId: opts.compradorId, serial: opts.serial, txHash: opts.txHash, numeroCIT: opts.numeroCIT }),
        ]);
    });
}
// ══════════════════════════════════════════════════════════
// 7. DISPUTA ABIERTA
// ══════════════════════════════════════════════════════════
function despacharDisputaAbierta(opts) {
    despachar('DisputaAbierta', async () => {
        const [iniciador, otro] = await Promise.all([
            getUsuarioNotif(opts.iniciadorId),
            getUsuarioNotif(opts.otroId),
        ]);
        await Promise.allSettled([
            iniciador && (0, fcm_service_1.enviarPushUsuario)(opts.iniciadorId, {
                titulo: '⚠ Disputa abierta — RODAID PAY',
                cuerpo: `Motivo: ${opts.motivo}. Resolución en 72hs.`,
                datos: { tipo: 'DISPUTA_ABIERTA', disputaId: opts.disputaId },
            }),
            otro && (0, fcm_service_1.enviarPushUsuario)(opts.otroId, {
                titulo: '⚠ Se abrió una disputa sobre tu transacción',
                cuerpo: `Motivo: ${opts.motivo}. Aportá evidencia en tu panel.`,
                datos: { tipo: 'DISPUTA_ABIERTA', disputaId: opts.disputaId },
            }),
            iniciador && (0, email_service_1.emailDisputaAbierta)({
                to: iniciador.email, nombre: iniciador.nombre ?? iniciador.email,
                disputaId: opts.disputaId, motivo: opts.motivo, rol: 'comprador',
            }),
            otro && (0, email_service_1.emailDisputaAbierta)({
                to: otro.email, nombre: otro.nombre ?? otro.email,
                disputaId: opts.disputaId, motivo: opts.motivo, rol: 'vendedor',
            }),
            (0, mxm_notificaciones_service_1.notifDisputaAbierta)({ iniciadorId: opts.iniciadorId, otroId: opts.otroId, disputaId: opts.disputaId, motivo: opts.motivo, transaccionId: opts.transaccionId }),
        ]);
    });
}
// ══════════════════════════════════════════════════════════
// 8. MENSAJE DEL SISTEMA
// ══════════════════════════════════════════════════════════
function despacharSistema(opts) {
    despachar('Sistema', async () => {
        await Promise.allSettled([
            (0, fcm_service_1.enviarPushUsuario)(opts.usuarioId, {
                titulo: opts.titulo,
                cuerpo: opts.cuerpo,
                datos: { tipo: 'SISTEMA_GENERAL' },
            }),
            (0, mxm_notificaciones_service_1.notifSistema)({ usuarioId: opts.usuarioId, titulo: opts.titulo, cuerpo: opts.cuerpo, urgente: opts.urgente }),
        ]);
    });
}
