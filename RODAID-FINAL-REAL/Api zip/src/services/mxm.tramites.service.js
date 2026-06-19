"use strict";
// ─── RODAID · MxM Trámites — Expediente CIT Provincial ──
// Crea y gestiona el expediente CIT en el sistema de trámites
// del Gobierno de Mendoza (Mendoza por Mí / TAD provincial).
//
// Flujo principal:
//   1. POST /mxm/tramites { citId }
//      → verificar CIT activo + tasa pagada + identidad nivel 2
//      → mxmService.crearExpediente(token, citId)
//      → INSERT mxm_tramites (INICIADO)
//      → UPDATE cits.mxm_expediente + cits.numero_expediente
//      → respuesta: { tramiteId, expedienteId, numeroExpediente, urlConsulta }
//
//   2. Webhook MxM (opcional): cambios de estado del expediente
//      POST /mxm/tramites/webhook → UPDATE estado_mxm
//
//   3. GET /mxm/tramites/:id     → estado actual
//   4. GET /mxm/tramites/mi-cit/:citId → expediente del CIT del usuario
//
// Tipos de trámite soportados:
//   REGISTRO_CIT      → certificado emitido por primera vez
//   TRANSFERENCIA_CIT → cambio de propietario (venta)
//   BAJA_CIT          → baja voluntaria del registro
//   DENUNCIA_ROBO     → reporte de robo con bloqueo del CIT
//   ACTUALIZACION     → corrección de datos del certificado
//
// Modo STUB (sin MXM_TRAMITES_URL):
//   → genera expedienteId sintético formato EX-STUB-YYYY-NNNNNN
//   → estado simulado: INICIADO → PRESENTADO (automático en STUB)
//   → POST /mxm/tramites/stub/avanzar para simular avance de estado
//
// Integración con finalizarCIT():
//   Cuando el CIT alcanza estado ACTIVO, se dispara crearTramite()
//   como fire-and-forget — no bloquea la emisión del CIT.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crearTramite = crearTramite;
exports.procesarWebhookTramite = procesarWebhookTramite;
exports.stubAvanzarEstado = stubAvanzarEstado;
exports.getTramite = getTramite;
exports.getTramitePorCIT = getTramitePorCIT;
exports.getTramitesUsuario = getTramitesUsuario;
exports.getHistorialTramite = getHistorialTramite;
exports.getEstadisticasTramites = getEstadisticasTramites;
exports.tramiteCITEmitido = tramiteCITEmitido;
exports.tramiteTransferenciaCIT = tramiteTransferenciaCIT;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const mxm_service_1 = require("./mxm.service");
const mxm_identidad_service_1 = require("./mxm.identidad.service");
const errorHandler_1 = require("../middleware/errorHandler");
const logger_1 = require("../middleware/logger");
const MODO_STUB = !process.env.MXM_TRAMITES_URL;
// ══════════════════════════════════════════════════════════
// GENERAR NÚMERO LEGIBLE DE EXPEDIENTE (STUB)
// ══════════════════════════════════════════════════════════
function generarNumeroExpediente(tipo) {
    const anio = new Date().getFullYear();
    const seq = Math.floor(Math.random() * 999999).toString().padStart(6, '0');
    const sufijo = {
        REGISTRO_CIT: 'CIT',
        TRANSFERENCIA_CIT: 'TRF',
        BAJA_CIT: 'BAJ',
        DENUNCIA_ROBO: 'DEN',
        ACTUALIZACION: 'ACT',
    }[tipo] ?? 'GEN';
    return `EX-STUB-${anio}-${sufijo}-${seq}`;
}
// ══════════════════════════════════════════════════════════
// REGISTRAR HISTORIAL
// ══════════════════════════════════════════════════════════
async function registrarHistorial(opts) {
    await (0, database_1.query)(`INSERT INTO mxm_tramites_historial
       (tramite_id, estado_previo, estado_nuevo, origen, datos)
     VALUES ($1, $2, $3, $4, $5::jsonb)`, [
        opts.tramiteId, opts.estadoPrevio ?? null, opts.estadoNuevo,
        opts.origen ?? 'SISTEMA',
        opts.datos ? JSON.stringify(opts.datos) : null,
    ]).catch(e => logger_1.log.mxm.warn({ err: e.message }, 'Error en historial trámite'));
}
// ══════════════════════════════════════════════════════════
// CREAR EXPEDIENTE PRINCIPAL
// ══════════════════════════════════════════════════════════
async function crearTramite(opts) {
    const tipo = opts.tipoTramite ?? 'REGISTRO_CIT';
    // ── 1. Validar CIT ──────────────────────────────────────
    const cit = await (0, database_1.queryOne)(`SELECT c.id, c.numero_cit, c.estado::text, c.tasa_pagada,
            c.propietario_id, c.mxm_expediente,
            b.numero_serie, b.marca, b.modelo
     FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
     WHERE c.id=$1`, [opts.citId]);
    if (!cit)
        throw new errorHandler_1.AppError('CIT no encontrado', 404, 'CIT_NOT_FOUND');
    if (tipo === 'REGISTRO_CIT') {
        if (!['ACTIVO', 'EN_VALIDACION'].includes(cit.estado))
            throw new errorHandler_1.AppError(`El CIT debe estar ACTIVO para crear el expediente (estado actual: ${cit.estado})`, 422, 'CIT_ESTADO_INVALIDO');
        if (cit.mxm_expediente && tipo === 'REGISTRO_CIT')
            throw new errorHandler_1.AppError(`Ya existe un expediente para este CIT: ${cit.mxm_expediente}`, 409, 'EXPEDIENTE_DUPLICADO');
    }
    // ── 2. Verificar identidad MxM nivel 2 ─────────────────
    const identidad = await (0, mxm_identidad_service_1.getIdentidadMxM)(opts.usuarioId);
    if (!identidad.conectado)
        throw new errorHandler_1.AppError('Debés conectar tu cuenta MxM antes de crear el expediente provincial.', 403, 'MXM_NOT_CONNECTED');
    if (identidad.nivel < 2)
        throw new errorHandler_1.AppError(`Se requiere Nivel 2 MxM (RENAPER) para crear expedientes. Tu nivel: ${identidad.nivel}`, 403, 'MXM_NIVEL_INSUFICIENTE');
    // ── 3. Obtener access token MxM ─────────────────────────
    const accessToken = await (0, mxm_service_1.getMxMAccessToken)(opts.usuarioId);
    // ── 4. Llamar al gateway MxM (o STUB) ──────────────────
    let expedienteId;
    let numeroExpediente;
    let urlConsulta;
    let respuestaRaw;
    let esStub;
    if (accessToken && !MODO_STUB) {
        // ── LIVE: llamada real al sistema provincial ──────────
        try {
            expedienteId = await mxm_service_1.mxmService.crearExpediente(accessToken, opts.citId);
            // Si el gateway devuelve datos adicionales (endpoint puede variar)
            numeroExpediente = expedienteId.startsWith('EX-')
                ? expedienteId
                : `EX-${new Date().getFullYear()}-${expedienteId}`;
            urlConsulta = `${process.env.MXM_AUTH_URL ?? 'https://tramites.mendoza.gob.ar'}/expediente/${expedienteId}`;
            respuestaRaw = { expedienteId, fuente: 'MXM_LIVE' };
            esStub = false;
            logger_1.log.mxm.info({ expedienteId, citId: opts.citId, tipo }, '✓ Expediente MxM creado (LIVE)');
        }
        catch (err) {
            throw new errorHandler_1.AppError(`Error al crear expediente en el sistema provincial: ${err.message}`, 502, 'MXM_TRAMITE_ERROR');
        }
    }
    else {
        // ── STUB ──────────────────────────────────────────────
        expedienteId = `EXP-STUB-${crypto_1.default.randomBytes(4).toString('hex').toUpperCase()}`;
        numeroExpediente = generarNumeroExpediente(tipo);
        urlConsulta = `http://localhost:5173/dev/tramite/${expedienteId}`;
        respuestaRaw = { expedienteId, fuente: 'STUB', cit: cit.numero_cit };
        esStub = true;
        logger_1.log.mxm.warn({ expedienteId, citId: opts.citId, tipo }, '⚠ MxM Trámite STUB — configurar MXM_TRAMITES_URL para expedientes reales');
    }
    // ── 5. Persistir el trámite ─────────────────────────────
    const row = await (0, database_1.queryOne)(`INSERT INTO mxm_tramites
       (cit_id, usuario_id, expediente_id, numero_expediente,
        tipo_tramite, ley_referencia, descripcion, datos_extra,
        estado_mxm, url_consulta, respuesta_raw, es_stub, presentado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'PRESENTADO',$9,$10::jsonb,$11::boolean,NOW())
     RETURNING id, creado_en`, [
        opts.citId, opts.usuarioId, expedienteId, numeroExpediente,
        tipo, opts.leyRef ?? '9556',
        opts.descripcion ?? descripcionDefault(tipo, cit),
        opts.datosExtra ? JSON.stringify(opts.datosExtra) : null,
        urlConsulta, JSON.stringify(respuestaRaw), esStub,
    ]);
    const tramiteId = row.id;
    // ── 6. Actualizar el CIT con el número de expediente ──
    await (0, database_1.query)(`UPDATE cits SET
       mxm_expediente    = $2,
       numero_expediente = $3,
       expediente_estado = 'PRESENTADO'
     WHERE id=$1`, [opts.citId, expedienteId, numeroExpediente]);
    // ── 7. Historial ─────────────────────────────────────
    await registrarHistorial({
        tramiteId,
        estadoPrevio: 'INICIADO',
        estadoNuevo: 'PRESENTADO',
        datos: { expedienteId, tipo, numeroCIT: cit.numero_cit, esStub },
    });
    logger_1.log.mxm.info({
        tramiteId, expedienteId, numeroExpediente, tipo,
        numeroCIT: cit.numero_cit, esStub,
    }, `✓ Trámite ${tipo} creado: ${numeroExpediente}`);
    return {
        tramiteId,
        expedienteId,
        numeroExpediente,
        estadoMxM: 'PRESENTADO',
        urlConsulta,
        esStub,
        mensaje: esStub
            ? `⚠ STUB: expediente simulado. Configurar MXM_TRAMITES_URL para el sistema real.`
            : `✓ Expediente ${numeroExpediente} presentado en el sistema provincial MxM. ` +
                `Podés consultar el estado en: ${urlConsulta}`,
    };
}
// ══════════════════════════════════════════════════════════
// WEBHOOK: MxM notifica cambio de estado del expediente
// ══════════════════════════════════════════════════════════
async function procesarWebhookTramite(opts) {
    const expedienteId = String(opts.payload.expedienteId ?? opts.payload.id ?? '');
    const estadoMxM = String(opts.payload.estado ?? opts.payload.status ?? '');
    if (!expedienteId)
        return { ok: true };
    // Buscar el trámite por expediente_id
    const tramite = await (0, database_1.queryOne)(`SELECT id, estado_mxm, cit_id FROM mxm_tramites WHERE expediente_id=$1`, [expedienteId]);
    if (!tramite)
        return { ok: true };
    const estadoFinal = mapEstadoMxM(estadoMxM);
    if (!estadoFinal || tramite.estado_mxm === estadoFinal)
        return { ok: true, tramiteId: tramite.id, estado: tramite.estado_mxm };
    const ahora = new Date();
    await (0, database_1.query)(`UPDATE mxm_tramites SET
       estado_mxm    = $2::text,
       observaciones = $3,
       actualizado_en = NOW()
     WHERE id=$1`, [tramite.id, estadoFinal, opts.payload.observaciones ?? null]);
    if (['APROBADO', 'RECHAZADO', 'ARCHIVADO'].includes(estadoFinal)) {
        await (0, database_1.query)(`UPDATE mxm_tramites SET resuelto_en=$2 WHERE id=$1`, [tramite.id, ahora]);
    }
    // Sincronizar con cits.expediente_estado
    await (0, database_1.query)(`UPDATE cits SET expediente_estado=$2 WHERE id=$1`, [tramite.cit_id, estadoFinal]);
    await registrarHistorial({
        tramiteId: tramite.id,
        estadoPrevio: tramite.estado_mxm,
        estadoNuevo: estadoFinal,
        origen: 'WEBHOOK_MXM',
        datos: { payload: opts.payload },
    });
    logger_1.log.mxm.info({ tramiteId: tramite.id, expedienteId, estadoFinal }, `Trámite → ${estadoFinal}`);
    return { ok: true, tramiteId: tramite.id, estado: estadoFinal };
}
// ══════════════════════════════════════════════════════════
// STUB: avanzar estado manualmente (para testing/dev)
// ══════════════════════════════════════════════════════════
const ESTADOS_FLUJO = ['INICIADO', 'PRESENTADO', 'EN_REVISION', 'APROBADO'];
async function stubAvanzarEstado(tramiteId) {
    const tramite = await (0, database_1.queryOne)(`SELECT estado_mxm, es_stub, cit_id FROM mxm_tramites WHERE id=$1`, [tramiteId]);
    if (!tramite)
        throw new errorHandler_1.AppError('Trámite no encontrado', 404, 'NOT_FOUND');
    if (!tramite.es_stub && process.env.NODE_ENV === 'production')
        throw new errorHandler_1.AppError('Solo disponible en modo STUB', 400, 'NOT_STUB');
    const idx = ESTADOS_FLUJO.indexOf(tramite.estado_mxm);
    if (idx < 0 || idx >= ESTADOS_FLUJO.length - 1)
        throw new errorHandler_1.AppError(`El trámite ya está en estado final: ${tramite.estado_mxm}`, 422, 'ESTADO_FINAL');
    const estadoNuevo = ESTADOS_FLUJO[idx + 1];
    await (0, database_1.query)(`UPDATE mxm_tramites SET estado_mxm=$2::text, actualizado_en=NOW() WHERE id=$1`, [tramiteId, estadoNuevo]);
    if (estadoNuevo === 'APROBADO') {
        await (0, database_1.query)(`UPDATE mxm_tramites SET resuelto_en=NOW() WHERE id=$1`, [tramiteId]);
    }
    await (0, database_1.query)(`UPDATE cits SET expediente_estado=$2 WHERE id=$1`, [tramite.cit_id, estadoNuevo]);
    await registrarHistorial({ tramiteId, estadoPrevio: tramite.estado_mxm, estadoNuevo, origen: 'SISTEMA', datos: { stub: true } });
    logger_1.log.mxm.warn({ tramiteId, estadoNuevo }, `⚠ STUB: estado avanzado a ${estadoNuevo}`);
    return { estadoAnterior: tramite.estado_mxm, estadoNuevo };
}
// ══════════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════════
async function getTramite(id) {
    const row = await (0, database_1.queryOne)(`SELECT id, cit_id, usuario_id, expediente_id, numero_expediente,
            numero_tramite, tipo_tramite, ley_referencia, descripcion,
            estado_mxm, url_consulta, observaciones, es_stub,
            creado_en, presentado_en, resuelto_en
     FROM mxm_tramites WHERE id=$1`, [id]);
    return row ? mapRow(row) : null;
}
async function getTramitePorCIT(citId) {
    const row = await (0, database_1.queryOne)(`SELECT id, cit_id, usuario_id, expediente_id, numero_expediente,
            numero_tramite, tipo_tramite, ley_referencia, descripcion,
            estado_mxm, url_consulta, observaciones, es_stub,
            creado_en, presentado_en, resuelto_en
     FROM mxm_tramites WHERE cit_id=$1
     ORDER BY creado_en DESC LIMIT 1`, [citId]);
    return row ? mapRow(row) : null;
}
async function getTramitesUsuario(usuarioId) {
    const rows = await (0, database_1.query)(`SELECT t.id, t.cit_id, t.usuario_id, t.expediente_id, t.numero_expediente,
            t.tipo_tramite, t.estado_mxm, t.url_consulta, t.es_stub,
            t.creado_en, t.presentado_en, t.resuelto_en,
            c.numero_cit, b.numero_serie AS serial, b.marca, b.modelo
     FROM mxm_tramites t
     JOIN cits c ON c.id=t.cit_id
     JOIN bicicletas b ON b.id=c.bicicleta_id
     WHERE t.usuario_id=$1
     ORDER BY t.creado_en DESC`, [usuarioId]);
    return rows.map(mapRow);
}
async function getHistorialTramite(tramiteId) {
    return (0, database_1.query)(`SELECT id, estado_previo, estado_nuevo, origen, datos, registrado_en
     FROM mxm_tramites_historial WHERE tramite_id=$1
     ORDER BY registrado_en`, [tramiteId]);
}
async function getEstadisticasTramites(dias = 30) {
    const row = await (0, database_1.queryOne)(`SELECT
       COUNT(*)::text                                            AS total,
       COUNT(*) FILTER (WHERE estado_mxm='APROBADO')::text     AS apro,
       COUNT(*) FILTER (WHERE estado_mxm='EN_REVISION')::text  AS rev,
       COUNT(*) FILTER (WHERE estado_mxm='RECHAZADO')::text    AS rech
     FROM mxm_tramites WHERE creado_en > NOW() - ($1||' days')::interval`, [dias]);
    return {
        total: parseInt(row?.total ?? '0'),
        aprobados: parseInt(row?.apro ?? '0'),
        enRevision: parseInt(row?.rev ?? '0'),
        rechazados: parseInt(row?.rech ?? '0'),
    };
}
// ══════════════════════════════════════════════════════════
// DISPARADOR DE NEGOCIO: al finalizar un CIT
// ══════════════════════════════════════════════════════════
/** Llamar desde finalizarCIT() como fire-and-forget */
async function tramiteCITEmitido(opts) {
    await crearTramite({
        citId: opts.citId,
        usuarioId: opts.usuarioId,
        tipoTramite: 'REGISTRO_CIT',
        leyRef: '9556',
    }).catch(e => {
        // No interrumpir el flujo CIT si falla el expediente
        logger_1.log.mxm.error({ citId: opts.citId, err: e.message }, '⚠ No se pudo crear el expediente MxM (no bloquea la emisión del CIT)');
    });
}
/** Crear expediente de transferencia al cerrar una venta */
async function tramiteTransferenciaCIT(opts) {
    await crearTramite({
        citId: opts.citId,
        usuarioId: opts.compradorId,
        tipoTramite: 'TRANSFERENCIA_CIT',
        leyRef: '9556',
        descripcion: `Transferencia de CIT por venta en marketplace RODAID.`,
    }).catch(e => logger_1.log.mxm.error({ err: e.message }, 'Error expediente transferencia'));
}
// ── Helpers privados ─────────────────────────────────────
function descripcionDefault(tipo, cit) {
    const base = `${cit.marca} ${cit.modelo} (S/N: ${cit.numero_serie}) — CIT ${cit.numero_cit}`;
    const descs = {
        REGISTRO_CIT: `Registro de certificado de identidad técnica bajo Ley N° 9556. ${base}`,
        TRANSFERENCIA_CIT: `Transferencia de propietario del CIT. ${base}`,
        BAJA_CIT: `Solicitud de baja del CIT del registro provincial. ${base}`,
        DENUNCIA_ROBO: `Denuncia de robo con solicitud de bloqueo del CIT. ${base}`,
        ACTUALIZACION: `Actualización de datos del CIT. ${base}`,
    };
    return descs[tipo] ?? `Trámite CIT Ley 9556. ${base}`;
}
function mapEstadoMxM(raw) {
    const mapa = {
        INICIADO: 'INICIADO', PRESENTADO: 'PRESENTADO', EN_REVISION: 'EN_REVISION',
        IN_REVIEW: 'EN_REVISION', APPROVED: 'APROBADO', APROBADO: 'APROBADO',
        REJECTED: 'RECHAZADO', RECHAZADO: 'RECHAZADO', ARCHIVED: 'ARCHIVADO', ARCHIVADO: 'ARCHIVADO',
    };
    return mapa[raw.toUpperCase().replace(/ /g, '_')] ?? null;
}
function mapRow(row) {
    return {
        id: row.id,
        citId: row.cit_id,
        usuarioId: row.usuario_id,
        expedienteId: row.expediente_id ?? undefined,
        numeroExpediente: row.numero_expediente ?? undefined,
        numeroTramite: row.numero_tramite ?? undefined,
        tipoTramite: row.tipo_tramite,
        leyReferencia: row.ley_referencia,
        descripcion: row.descripcion ?? undefined,
        estadoMxM: row.estado_mxm,
        urlConsulta: row.url_consulta ?? undefined,
        observaciones: row.observaciones ?? undefined,
        esStub: row.es_stub,
        creadoEn: new Date(row.creado_en),
        presentadoEn: row.presentado_en ? new Date(row.presentado_en) : undefined,
        resueltoEn: row.resuelto_en ? new Date(row.resuelto_en) : undefined,
    };
}
