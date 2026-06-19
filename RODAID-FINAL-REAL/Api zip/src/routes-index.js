"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const rodaid_i18n_service_1 = require("../services/rodaid.i18n.service");
// ─── RODAID · Router Principal ────────────────────────────
// Cada endpoint declara explícitamente:
//   1. Rate limit (IP / usuario)
//   2. Autenticación (público | authenticated | onlyX)
//   3. Autorización por permiso (requirePermission)
//   4. Handler
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
const zod_1 = require("zod");
const notif_preferencias_service_1 = require("../services/notif.preferencias.service");
const email_sender_1 = require("../services/email.sender");
const rbac_service_1 = require("../services/rbac.service");
const s3_service_1 = require("../services/s3.service");
const aliado_panel_service_1 = require("../services/aliado.panel.service");
const firma_validacion_service_1 = require("../services/firma.validacion.service");
const firma_service_1 = require("../services/firma.service");
const jwt_service_1 = require("../services/jwt.service");
const cit_triggers_service_1 = require("../services/cit.triggers.service");
const device_token_service_1 = require("../services/device_token.service");
const apns_service_1 = require("../services/apns.service");
const fcm_service_1 = require("../services/fcm.service");
const express_1 = require("express");
// ── Middleware ─────────────────────────────────────────────
const auth_1 = require("../middleware/auth");
const rateLimiter_1 = require("../middleware/rateLimiter");
// ── Controllers ────────────────────────────────────────────
const auth_controller_1 = require("../controllers/auth.controller");
const twofa_controller_1 = require("../controllers/twofa.controller");
const cit_controller_1 = require("../controllers/cit.controller");
const bicicletas_controller_1 = require("../controllers/bicicletas.controller");
const seguridad_controller_1 = require("../controllers/seguridad.controller");
const marketplace_controller_1 = require("../controllers/marketplace.controller");
const notif_service_1 = require("../services/notif.service");
const mp_sdk_service_1 = require("../services/mp.sdk.service");
const mp_business_service_1 = require("../services/mp.business.service");
const encryption_service_1 = require("../services/encryption.service");
const sla_service_1 = require("../services/sla.service");
const minseg_recuperacion_service_1 = require("../services/minseg.recuperacion.service");
const mtls_middleware_1 = require("../middleware/mtls.middleware");
const crossreference_service_1 = require("../services/crossreference.service");
const minseg_protocol_service_1 = require("../services/minseg.protocol.service");
const capacitacion_service_1 = require("../services/capacitacion.service");
const auditoria_gps_service_1 = require("../services/auditoria.gps.service");
const publicMiddleware_1 = require("../middleware/publicMiddleware");
const verificador_service_1 = require("../services/verificador.service");
const sello_service_1 = require("../services/sello.service");
const font_service_1 = require("../services/font.service");
const qr_service_1 = require("../services/qr.service");
const firma_service_2 = require("../services/firma.service");
const pdf_controller_1 = require("../controllers/pdf.controller");
const bfa_indexer_1 = require("../services/bfa.indexer");
const admin_controller_1 = require("../controllers/admin.controller");
const mxm_circuit_service_1 = require("../services/mxm.circuit.service");
const mxm_token_refresh_service_1 = require("../services/mxm.token.refresh.service");
const mxm_tramites_service_1 = require("../services/mxm.tramites.service");
const mxm_notificaciones_service_1 = require("../services/mxm.notificaciones.service");
const mxm_pagos_service_1 = require("../services/mxm.pagos.service");
const mxm_identidad_service_1 = require("../services/mxm.identidad.service");
const jwt_service_2 = require("../services/jwt.service");
const health_service_1 = require("../services/health.service");
const database_1 = require("../config/database");
const comision_service_1 = require("../services/comision.service");
const sla_stream_service_1 = require("../services/sla.stream.service");
const gpt_proxy_service_1 = require("../services/gpt.proxy.service");
const gpt_ratelimit_service_1 = require("../services/gpt.ratelimit.service");
const gpt_cache_service_1 = require("../services/gpt.cache.service");
const rodaid_ai_service_1 = require("../services/rodaid.ai.service");
const cit_validacion_rt_service_1 = require("../services/cit.validacion.rt.service");
const cit_estado_service_1 = require("../services/cit.estado.service");
const escrow_service_1 = require("../services/escrow.service");
const mercadopago_service_1 = require("../services/mercadopago.service");
const r = (0, express_1.Router)();
// POST /usuarios/fcm-token — registrar device token
r.post('/usuarios/fcm-token', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        token: zod_1.z.string().min(10),
        plataforma: zod_1.z.enum(['WEB', 'ANDROID', 'IOS']),
        dispositivo: zod_1.z.string().max(200).optional(),
        appVersion: zod_1.z.string().max(20).optional(),
    }).parse(req.body);
    const result = await (0, fcm_service_1.registrarToken)({
        usuarioId: req.user.sub,
        token: body.token,
        plataforma: body.plataforma,
        dispositivo: body.dispositivo,
        appVersion: body.appVersion,
    });
    res.status(result.nuevo ? 201 : 200).json({ ok: true, data: result,
        message: result.nuevo ? 'Token FCM registrado' : 'Token FCM actualizado',
    });
});
// DELETE /usuarios/fcm-token — desregistrar token (logout)
r.delete('/usuarios/fcm-token', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { token } = zod_1.z.object({ token: zod_1.z.string().min(10) }).parse(req.body);
    const eliminado = await (0, fcm_service_1.desregistrarToken)(token, req.user.sub);
    res.json({ ok: true, data: { eliminado } });
});
// GET /usuarios/fcm-tokens — listar tokens del usuario
r.get('/usuarios/fcm-tokens', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const tokens = await (0, fcm_service_1.getTokensUsuario)(req.user.sub);
    res.json({ ok: true, data: tokens });
});
// POST /admin/fcm/push-test — enviar push de prueba a un usuario
r.post('/admin/fcm/push-test', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        usuarioId: zod_1.z.string().uuid(),
        titulo: zod_1.z.string().default('Prueba RODAID'),
        cuerpo: zod_1.z.string().default('Notificación de prueba desde el panel admin.'),
        plataformas: zod_1.z.array(zod_1.z.enum(['WEB', 'ANDROID', 'IOS'])).optional(),
    }).parse(req.body);
    const result = await (0, fcm_service_1.enviarPushUsuario)(body.usuarioId, {
        titulo: body.titulo, cuerpo: body.cuerpo,
        datos: { tipo: 'TEST', ts: Date.now().toString() },
    }, { plataformas: body.plataformas });
    res.json({ ok: true, data: result, modo: (0, fcm_service_1.getModo)() });
});
// POST /admin/fcm/topico — enviar push a un tópico
r.post('/admin/fcm/topico', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        topico: zod_1.z.string().min(3).max(100),
        titulo: zod_1.z.string(),
        cuerpo: zod_1.z.string(),
        datos: zod_1.z.record(zod_1.z.string()).optional(),
    }).parse(req.body);
    const result = await (0, fcm_service_1.enviarPushTopico)(body.topico, {
        titulo: body.titulo, cuerpo: body.cuerpo, datos: body.datos,
    });
    res.json({ ok: true, data: result, modo: (0, fcm_service_1.getModo)() });
});
// GET /admin/fcm/estadisticas
r.get('/admin/fcm/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    const stats = await (0, fcm_service_1.getEstadisticas)(dias);
    res.json({ ok: true, data: { ...stats, modo: (0, fcm_service_1.getModo)() } });
});
// ══════════════════════════════════════════════════════════
// POST /inspector/cit — Endpoint principal de inspección
// Multipart/form-data: fotos + datos JSON + firma digital
// ══════════════════════════════════════════════════════════
// Multer: memoria (max 10 MB por archivo, max 10 archivos)
const multer = require('multer');
const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/jpg']
            .includes(file.mimetype);
        cb(ok ? null : new Error('Solo imágenes JPEG/PNG/WebP/HEIC'), ok);
    },
}).array('fotos', 10);
/**
 * POST /inspector/cit
 *
 * Content-Type: multipart/form-data
 *
 * Campos:
 *   fotos[]          - Archivos de imagen (1-10 fotos)
 *   bicicletaId      - UUID de la bicicleta a certificar
 *   propietarioDNI   - DNI del propietario
 *   propietarioNombre- Nombre completo del propietario
 *   puntos           - JSON: { serial:bool, cuadro:bool, ... } (20 checks)
 *   djFirmada        - "true" (declaración jurada)
 *   p12Base64        - (opcional) PKCS#12 del inspector en base64
 *   p12Password      - (opcional) contraseña del P12
 *   tiposFotos       - (opcional) JSON: ["serie","cuadro",...] — tipos por foto
 *
 * Flujo:
 *   1. Validar multipart (Multer)
 *   2. Autenticar inspector + cargar perfil (JWT claims)
 *   3. Validar bicicleta (propietario, serial)
 *   4. Subir fotos a S3 en paralelo
 *   5. Iniciar CIT en DB
 *   6. Firmar payload con RSA-PSS (PKCS#12 o clave RODAID)
 *   7. Trigger notificaciones (fire-and-forget)
 *   8. Respuesta con CIT + fotos + firma
 */
r.post('/inspector/cit', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
        if (err) {
            res.status(422).json({ ok: false, error: err.message, code: 'FOTO_UPLOAD_ERROR' });
        }
        else {
            next();
        }
    });
}, async (req, res) => {
    if (!['INSPECTOR', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Rol INSPECTOR requerido', code: 'SIN_PERMISO' });
        return;
    }
    // ── 1. Parsear y validar campos del form ──────────────
    const body = zod_1.z.object({
        bicicletaId: zod_1.z.string().uuid(),
        propietarioDNI: zod_1.z.string().min(7).max(20),
        propietarioNombre: zod_1.z.string().min(3).max(100),
        puntos: zod_1.z.string().transform(s => JSON.parse(s)),
        djFirmada: zod_1.z.string().transform(s => s === 'true'),
        p12Base64: zod_1.z.string().optional(),
        p12Password: zod_1.z.string().optional(),
        tiposFotos: zod_1.z.string().optional().transform(s => s ? JSON.parse(s) : null),
        propietarioGeoLat: zod_1.z.string().optional().transform(s => s ? parseFloat(s) : undefined),
        propietarioGeoLng: zod_1.z.string().optional().transform(s => s ? parseFloat(s) : undefined),
    }).parse(req.body);
    if (!body.djFirmada) {
        res.status(422).json({ ok: false, error: 'Declaración jurada debe estar firmada', code: 'DJ_REQUERIDA' });
        return;
    }
    const archivos = (req.files ?? []);
    if (archivos.length === 0) {
        res.status(422).json({ ok: false, error: 'Se requiere al menos 1 foto de la inspección', code: 'FOTOS_REQUERIDAS' });
        return;
    }
    // ── 2. Verificar perfil inspector ───────────────────
    const { queryOne: qOne } = await import('../config/database');
    const inspectorId = req.user.inspectorId; // del JWT claim
    const tallerAliadoId = req.user.tallerAliadoId; // del JWT claim
    // Si el JWT tiene claims de inspector → usar directo (sin DB)
    // Si no → cargar desde DB (compatibilidad con tokens viejos)
    let resolvedInspId = inspectorId;
    let resolvedTallerId = tallerAliadoId;
    if (!resolvedInspId) {
        const insp = await qOne(`SELECT id, taller_aliado_id, certificado FROM inspectores
         WHERE usuario_id=$1 AND activo=TRUE`, [req.user.sub]);
        if (!insp) {
            res.status(403).json({ ok: false, error: 'Sin perfil de inspector activo', code: 'NOT_INSPECTOR' });
            return;
        }
        resolvedInspId = insp.id;
        resolvedTallerId = insp.taller_aliado_id;
    }
    // ── 3. Validar bicicleta ──────────────────────────
    const bici = await qOne(`SELECT numero_serie, propietario_id, marca, modelo FROM bicicletas WHERE id=$1`, [body.bicicletaId]);
    if (!bici) {
        res.status(404).json({ ok: false, error: 'Bicicleta no encontrada', code: 'BICICLETA_NOT_FOUND' });
        return;
    }
    // ── 4. Crear CIT en DB para obtener el citId ───────
    const { iniciarCIT } = await import('../services/cit.service');
    const { validarSerial } = await import('../services/serial.service');
    // Validar serial contra base MinSeg
    const validacion = await validarSerial({
        serial: bici.numero_serie,
        propietarioDNI: body.propietarioDNI,
        propietarioNombre: body.propietarioNombre,
    });
    if (!validacion.aprobado) {
        const bloq = validacion.checks.filter((c) => c.resultado === 'BLOQUEANTE');
        res.status(422).json({
            ok: false,
            error: `Serial rechazado: ${bloq[0]?.mensaje ?? 'validación fallida'}`,
            code: 'SERIAL_INVALIDO',
            data: { serial: validacion.serial, checks: validacion.checks },
        });
        return;
    }
    const citResult = await iniciarCIT({
        bicicletaId: body.bicicletaId,
        puntos: body.puntos,
        fotosUrls: ['placeholder'], // se actualizan después
        firmaInspector: `inspector:${resolvedInspId}`,
        djFirmada: true,
        propietarioDNI: body.propietarioDNI,
        propietarioNombre: body.propietarioNombre,
        inspectorId: resolvedInspId,
        tallerAliadoId: resolvedTallerId,
    });
    const citId = citResult.citId;
    // ── 5. Subir fotos a S3 en paralelo ───────────────
    const tiposFotos = body.tiposFotos ?? archivos.map((_, i) => i === 0 ? 'serie' : i === 1 ? 'cuadro' : 'inspeccion');
    const fotosResult = await (0, s3_service_1.subirFotosCIT)({
        citId,
        archivos: archivos.map((a, i) => ({
            archivo: { buffer: a.buffer, mimetype: a.mimetype, size: a.size, originalname: a.originalname },
            tipo: (tiposFotos[i] ?? 'inspeccion'),
        })),
        inspectorId: resolvedInspId,
    });
    const fotosUrls = fotosResult.map(f => f.url);
    // Actualizar el CIT con las URLs reales
    const { query: dbQuery } = await import('../config/database');
    await dbQuery(`UPDATE cits SET fotos_count=$2 WHERE id=$1`, [citId, fotosResult.length]);
    // ── 6. Firmar el payload CIT con RSA-PSS ──────────
    const { construirPayloadCIT, firmarPayloadCIT } = await import('../services/firma.service');
    const puntosInspeccion = body.puntos;
    const puntosTotal = Object.values(puntosInspeccion).filter(Boolean).length;
    const payload = construirPayloadCIT({
        numeroCIT: citResult.numeroCIT,
        citId,
        serial: bici.numero_serie,
        marca: bici.marca ?? 'N/A',
        modelo: bici.modelo ?? 'N/A',
        propietarioDNI: body.propietarioDNI,
        propietarioNombre: body.propietarioNombre,
        inspectorId: resolvedInspId,
        tallerAliadoId: resolvedTallerId,
        puntos: puntosInspeccion,
        hashSHA256PDF: '', // PDF se genera después en /cit/:id/pdf
        fechaEmision: new Date().toISOString(),
    });
    const p12Buffer = body.p12Base64 ? Buffer.from(body.p12Base64, 'base64') : undefined;
    const firmaResult = await firmarPayloadCIT({
        payload,
        citId,
        numeroCIT: citResult.numeroCIT,
        inspectorId: resolvedInspId,
        p12Buffer,
        p12Password: body.p12Password,
    });
    // Actualizar CIT con referencia a la firma
    await dbQuery(`UPDATE cits SET firma_payload_id=$2, firma_payload_hash=$3 WHERE id=$1`, [citId, firmaResult.firmaId, firmaResult.payloadHash]);
    // ── 7. Notificaciones fire-and-forget ─────────────
    // (no bloqueamos la respuesta)
    // ── 8. Respuesta completa ─────────────────────────
    res.status(201).json({
        ok: true,
        data: {
            // CIT
            citId,
            numeroCIT: citResult.numeroCIT,
            estado: citResult.estado,
            serial: bici.numero_serie,
            marca: bici.marca,
            modelo: bici.modelo,
            puntosTotal,
            puntosMax: 20,
            porcentaje: Math.round(puntosTotal / 20 * 100),
            // Fotos
            fotos: fotosResult.map(f => ({
                url: f.url,
                tipo: f.tipo,
                posicion: f.posicion,
                stub: f.stub,
            })),
            // Firma digital
            firma: {
                firmaId: firmaResult.firmaId,
                payloadHash: firmaResult.payloadHash,
                certSerial: firmaResult.certSerial,
                algoritmo: firmaResult.algoritmo,
                firmadoEn: firmaResult.firmadoEn,
                validaHasta: firmaResult.validaHasta,
            },
            // Validación serial
            serialValidacion: {
                aprobado: validacion.aprobado,
                checksOK: validacion.checks.filter((c) => c.resultado === 'OK').length,
                alertas: validacion.checks.filter((c) => c.resultado === 'ALERTA').map((c) => c.mensaje),
            },
            s3Modo: (0, s3_service_1.getModoS3)(),
        },
        message: `CIT iniciado con ${fotosResult.length} foto${fotosResult.length !== 1 ? 's' : ''} y firma digital RSA-PSS-SHA256`,
    });
});
// GET /inspector/cit/:citId/fotos — listar fotos de un CIT
r.get('/inspector/cit/:citId/fotos', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const fotos = await (0, s3_service_1.getFotosCIT)(req.params.citId);
    res.json({ ok: true, data: fotos, total: fotos.length });
});
// DELETE /inspector/cit/:citId/fotos/:fotoId — eliminar una foto
r.delete('/inspector/cit/:citId/fotos/:fotoId', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['INSPECTOR', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    const ok = await (0, s3_service_1.eliminarFotoCIT)(req.params.fotoId, req.params.citId);
    res.json({ ok: true, data: { eliminado: ok } });
});
// POST /inspector/cit/presigned — presigned URL para upload directo (mobile)
r.post('/inspector/cit/presigned', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['INSPECTOR', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    const body = zod_1.z.object({
        citId: zod_1.z.string().uuid(),
        tipo: zod_1.z.enum(['serie', 'cuadro', 'componentes', 'inspeccion', 'firma', 'general']).default('inspeccion'),
        posicion: zod_1.z.number().int().min(1).max(10),
        mimetype: zod_1.z.string().default('image/jpeg'),
    }).parse(req.body);
    const result = await (0, s3_service_1.generarPresignedUpload)({
        citId: body.citId,
        tipo: body.tipo,
        posicion: body.posicion,
        mimetype: body.mimetype,
    });
    res.json({ ok: true, data: result });
});
// POST /inspector/cit/confirmar-foto — confirmar foto subida via presigned URL
r.post('/inspector/cit/confirmar-foto', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['INSPECTOR', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    const body = zod_1.z.object({
        citId: zod_1.z.string().uuid(),
        s3Key: zod_1.z.string().min(5),
        tipo: zod_1.z.string().default('inspeccion'),
        posicion: zod_1.z.number().int().min(1).max(10),
        tamBytes: zod_1.z.number().optional(),
        mimetype: zod_1.z.string().optional(),
    }).parse(req.body);
    const result = await (0, s3_service_1.confirmarPresignedFoto)({ ...body, tipo: body.tipo, inspectorId: req.user.inspectorId });
    res.json({ ok: true, data: result });
});
// GET /admin/s3/estadisticas
r.get('/admin/s3/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, s3_service_1.getEstadisticasFotos)(dias) });
});
// ══════════════════════════════════════════════════════════
// RODAID PAY SDK — Flujo preference → redirect → webhook
// ══════════════════════════════════════════════════════════
// POST /mp/sdk/preferencia — crear preferencia con SDK oficial
r.post('/mp/sdk/preferencia', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        transaccionId: zod_1.z.string().uuid(),
        vendedorId: zod_1.z.string().uuid().optional(),
        bicicletaId: zod_1.z.string().uuid().optional(),
        titulo: zod_1.z.string().min(3).max(200),
        descripcion: zod_1.z.string().optional(),
        monto: zod_1.z.coerce.number().positive().min(1),
        expiraHoras: zod_1.z.coerce.number().int().min(1).max(168).default(48),
    }).parse(req.body);
    const { queryOne: qo } = await import('../config/database');
    const comprador = await qo(`SELECT email, nombre, apellido FROM usuarios WHERE id=$1`, [req.user.sub]);
    // Token del vendedor para marketplace split (si tiene cuenta MP conectada)
    let vendedorMpToken;
    if (body.vendedorId) {
        const vend = await qo(`SELECT mp_access_token FROM mp_vendedores WHERE usuario_id=$1 AND activo=TRUE`, [body.vendedorId]);
        vendedorMpToken = vend?.mp_access_token;
    }
    const result = await (0, mp_sdk_service_1.crearPreferenciaPago)({
        transaccionId: body.transaccionId,
        compradorId: req.user.sub,
        compradorEmail: comprador?.email ?? req.user.email,
        compradorNombre: [comprador?.nombre, comprador?.apellido].filter(Boolean).join(' ') || 'Comprador',
        titulo: body.titulo,
        descripcion: body.descripcion,
        monto: body.monto,
        expiraHoras: body.expiraHoras,
        vendedorMpToken,
        ipComprador: req.ip,
        userAgent: req.headers['user-agent'],
    });
    res.status(201).json({ ok: true, data: result });
});
// GET /mp/sdk/pago/:id — estado de un pago por ID
r.get('/mp/sdk/pago/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const pago = await (0, mp_sdk_service_1.getPago)(req.params.id);
    if (!pago) {
        res.status(404).json({ ok: false, error: 'Pago no encontrado' });
        return;
    }
    res.json({ ok: true, data: pago });
});
// GET /mp/sdk/pago/tx/:txId — estado por transaccionId
r.get('/mp/sdk/pago/tx/:txId', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const pago = await (0, mp_sdk_service_1.getPagoPorTransaccion)(req.params.txId);
    if (!pago) {
        res.status(404).json({ ok: false, error: 'Sin pago para esta transacción' });
        return;
    }
    res.json({ ok: true, data: pago });
});
// GET /mp/retorno — back_url de MP (UX, no fuente de verdad)
r.get('/mp/retorno', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { status, payment_id, external_reference, preference_id } = req.query;
    const result = await (0, mp_sdk_service_1.procesarRetornoMP)({
        status, paymentId: payment_id,
        externalRef: external_reference, preferenceId: preference_id,
    });
    // Redirigir al frontend con el resultado provisional
    const baseUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar';
    const estado = result.estadoProvisional.toLowerCase();
    res.redirect(302, `${baseUrl}/pago/${estado}?tx=${result.transaccionId ?? ''}&esperando=${result.esperandoWebhook}`);
});
// POST /webhooks/mp/sdk — endpoint webhook con verificación de firma SDK
r.post('/webhooks/mp/sdk', rateLimiter_1.burstRateLimit, async (req, res) => {
    const xSig = req.headers['x-signature'] ?? '';
    const xReqId = req.headers['x-request-id'] ?? require('crypto').randomUUID();
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const result = await (0, mp_sdk_service_1.procesarWebhookSDK)({ rawBody, xSignature: xSig, xRequestId: xReqId });
    // SIEMPRE responder 200 (MP reintenta si recibe otro código)
    res.status(200).json({ ok: result.procesado, data: result });
});
// GET /admin/mp/sdk/resumen — métricas de pagos SDK
r.get('/admin/mp/sdk/resumen', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, mp_sdk_service_1.getResumenPagos)(dias) });
});
// POST /admin/mp/sdk/simular-webhook — test del flujo webhook completo
r.post('/admin/mp/sdk/simular-webhook', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { paymentId, status } = zod_1.z.object({
        paymentId: zod_1.z.string().default(String(Date.now())),
        status: zod_1.z.enum(['approved', 'rejected', 'pending']).default('approved'),
    }).parse(req.body);
    const payload = JSON.stringify({ type: 'payment', data: { id: paymentId, status }, action: 'payment.updated' });
    const result = await (0, mp_sdk_service_1.procesarWebhookSDK)({ rawBody: payload, xSignature: '', xRequestId: require('crypto').randomUUID() });
    res.json({ ok: true, data: result, simulacion: true });
});
// ══════════════════════════════════════════════════════════
// RODAID PAY — MercadoPago Business RODAID SAS
// ══════════════════════════════════════════════════════════
// GET /mp/cuenta — info de la cuenta RODAID Business
r.get('/mp/cuenta', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, mp_business_service_1.getCuentaRodaid)() });
});
// GET /mp/verificar — verificar credenciales con MP
r.get('/mp/verificar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, mp_business_service_1.verificarCuentaMP)() });
});
// GET /mp/connect — redirigir al vendedor al OAuth de MP
r.get('/mp/connect', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { url } = await (0, mp_business_service_1.generarUrlOAuth)(req.user.sub);
    res.redirect(302, url);
});
// GET /mp/callback — recibir callback OAuth de MP
r.get('/mp/callback', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { code, state, error } = req.query;
    const frontUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar';
    if (error) {
        res.redirect(302, `${frontUrl}/mp/error?msg=${encodeURIComponent(error)}`);
        return;
    }
    if (!code || !state) {
        res.status(400).json({ ok: false, error: 'code y state requeridos' });
        return;
    }
    const result = await (0, mp_business_service_1.procesarCallbackOAuth)({ code, state });
    if (result.ok) {
        res.redirect(302, `${frontUrl}/mp/conectado?mpEmail=${encodeURIComponent(result.mpEmail ?? '')}`);
    }
    else {
        res.redirect(302, `${frontUrl}/mp/error?msg=${encodeURIComponent(result.error ?? 'Error')}`);
    }
});
// GET /mp/estado — estado de conexión del usuario autenticado
r.get('/mp/estado', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { queryOne: q } = await import('../config/database');
    const vend = await q(`SELECT mp_user_id, mp_email, activo, expira_en, creado_en FROM mp_vendedores WHERE usuario_id=$1`, [req.user.sub]);
    res.json({ ok: true, data: {
            conectado: !!vend?.activo,
            mpEmail: vend?.mp_email,
            mpUserId: vend?.mp_user_id,
            expiraEn: vend?.expira_en,
            conectadoEn: vend?.creado_en,
        } });
});
// POST /mp/preferencia — crear preferencia de pago marketplace (split)
r.post('/mp/preferencia', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        transaccionId: zod_1.z.string().uuid(),
        vendedorId: zod_1.z.string().uuid(),
        bicicletaId: zod_1.z.string().uuid(),
        titulo: zod_1.z.string().min(3).max(200),
        monto: zod_1.z.coerce.number().positive().min(1),
        descripcion: zod_1.z.string().optional(),
    }).parse(req.body);
    const result = await (0, mp_business_service_1.crearPreferenciaMarketplace)({
        ...body, compradorId: req.user.sub,
    });
    res.json({ ok: true, data: result });
});
// GET /mp/mis-pagos — pagos del vendedor autenticado
r.get('/mp/mis-pagos', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { pagina, porPagina } = zod_1.z.object({
        pagina: zod_1.z.coerce.number().int().min(1).default(1),
        porPagina: zod_1.z.coerce.number().int().min(1).max(50).default(25),
    }).parse(req.query);
    res.json({ ok: true, ...(await (0, mp_business_service_1.getPagoVendedor)(req.user.sub, pagina, porPagina)) });
});
// POST /mp/reembolsar — reembolsar un pago
r.post('/mp/reembolsar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { pagoId, monto, motivo } = zod_1.z.object({
        pagoId: zod_1.z.string().uuid(),
        monto: zod_1.z.coerce.number().positive().optional(),
        motivo: zod_1.z.string().max(200).optional(),
    }).parse(req.body);
    res.json({ ok: true, data: await (0, mp_business_service_1.reembolsarPago)({ pagoId, monto, motivo }) });
});
// POST /webhooks/mp — recibir notificaciones de MP
r.post('/webhooks/mp', rateLimiter_1.burstRateLimit, async (req, res) => {
    const signature = req.headers['x-signature'];
    const eventId = req.headers['x-request-id'];
    const result = await (0, mp_business_service_1.procesarWebhookMP)({ payload: req.body, signature, eventId });
    // ── Bridge: conectar resultado MP → Escrow → Notificaciones ────────────
    if (result.procesado && result.pagoId && result.nuevoEstado) {
        const { procesarEventoMP } = await import('../services/mp.notif.bridge');
        const evento = req.body;
        const paymentId = String(evento?.data?.id ?? '');
        const transaccionId = req.body?.external_reference ?? null;
        const status = result.nuevoEstado === 'APROBADO' ? 'approved'
            : result.nuevoEstado === 'RECHAZADO' ? 'rejected'
                : 'pending';
        // Detectar si es pago de tasa CIT (external_reference empieza por 'CIT-')
        const esTasaCIT = String(transaccionId ?? '').startsWith('CIT-');
        const citId = esTasaCIT
            ? String(transaccionId).replace('CIT-', '')
            : undefined;
        procesarEventoMP({
            paymentId, status, transaccionId: esTasaCIT ? undefined : transaccionId,
            gateway: 'MP', esTaskaCIT: esTasaCIT, citId,
        }).catch(err => console.warn('[Bridge MP]', err.message));
    }
    res.json({ ok: result.procesado, data: result });
});
// GET /admin/mp/estadisticas — métricas de RODAID PAY
r.get('/admin/mp/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, mp_business_service_1.getEstadisticasRodaidPay)(dias) });
});
// GET /admin/mp/vendedores — listar vendedores conectados
r.get('/admin/mp/vendedores', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { query: q } = await import('../config/database');
    const vendedores = await q(`SELECT v.mp_user_id, v.mp_email, v.activo, v.expira_en, v.creado_en,
            u.nombre, u.apellido, u.email AS usuario_email
     FROM mp_vendedores v JOIN usuarios u ON u.id=v.usuario_id
     ORDER BY v.creado_en DESC`, []);
    res.json({ ok: true, data: vendedores, total: vendedores.length });
});
// ══════════════════════════════════════════════════════════
// CIFRADO — AES-256-GCM at-rest + in-transit
// ══════════════════════════════════════════════════════════
// GET /admin/cifrado/estadisticas — estado del cifrado en reposo
r.get('/admin/cifrado/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, encryption_service_1.getEstadisticasCifrado)() });
});
// POST /admin/cifrado/cifrar-campo — cifrar un campo específico
r.post('/admin/cifrado/cifrar-campo', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        tabla: zod_1.z.string().min(3),
        registroId: zod_1.z.string().uuid(),
        campo: zod_1.z.string().min(2),
        valor: zod_1.z.string().min(1),
    }).parse(req.body);
    await (0, encryption_service_1.cifrarCampo)(body);
    res.json({ ok: true, data: { cifrado: true, tabla: body.tabla, campo: body.campo } });
});
// POST /admin/cifrado/descifrar-registro — ver campos descifrados de un registro
r.post('/admin/cifrado/descifrar-registro', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { tabla, registroId } = zod_1.z.object({
        tabla: zod_1.z.string(),
        registroId: zod_1.z.string().uuid(),
    }).parse(req.body);
    const campos = await (0, encryption_service_1.descifrarCampos)(tabla, registroId);
    res.json({ ok: true, data: campos, total: Object.keys(campos).length });
});
// POST /admin/cifrado/rotar-claves — rotación de claves AES
r.post('/admin/cifrado/rotar-claves', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { versionAntigua, versionNueva, dryRun } = zod_1.z.object({
        versionAntigua: zod_1.z.coerce.number().int().min(1),
        versionNueva: zod_1.z.coerce.number().int().min(2),
        dryRun: zod_1.z.boolean().default(true), // default: true por seguridad
    }).parse(req.body);
    if (versionNueva <= versionAntigua) {
        res.status(400).json({ ok: false, error: 'versionNueva debe ser mayor a versionAntigua' });
        return;
    }
    const result = await (0, encryption_service_1.rotarClaves)({ versionAntigua, versionNueva, dryRun });
    res.json({ ok: true, data: result, dryRun,
        mensaje: dryRun ? 'Simulación — ningún campo modificado. Ejecutar con dryRun=false para aplicar.' : `✓ Rotados ${result.rotados} campos a v${versionNueva}` });
});
// POST /admin/cifrado/generar-clave — generar nueva clave AES-256
r.post('/admin/cifrado/generar-clave', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (_req, res) => {
    const clave = (0, encryption_service_1.generarClave)();
    res.json({ ok: true, data: clave,
        instruccion: 'Agregar a .env como ENCRYPTION_KEY=' + clave.keyHex });
});
// POST /admin/cifrado/probar — probar cifrado/descifrado (sin persistir)
r.post('/admin/cifrado/probar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { texto } = zod_1.z.object({ texto: zod_1.z.string().min(1).max(500) }).parse(req.body);
    const enc = (0, encryption_service_1.cifrar)(texto);
    const dec = (0, encryption_service_1.descifrar)(enc);
    const ok = dec === texto;
    res.json({ ok, data: {
            textoCifrado: enc.slice(0, 40) + '...',
            longitudEnc: enc.length,
            descifradoOk: ok,
            algoritmo: 'AES-256-GCM',
            ivBits: 96,
            tagBits: 128,
        } });
});
// GET /admin/cifrado/enmascarar-demo — demostración de enmascaramiento PII
r.get('/admin/cifrado/enmascarar-demo', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (_req, res) => {
    res.json({ ok: true, data: {
            dni: { original: '30123456', enmascarado: (0, encryption_service_1.enmascararDNI)('30123456') },
            cuil: { original: '20301234567', enmascarado: (0, encryption_service_1.enmascararDNI)('20301234567') },
            email: { original: 'federico@rodaid.com.ar', enmascarado: (0, encryption_service_1.enmascararEmail)('federico@rodaid.com.ar') },
            telefono: { original: '+542625551234', enmascarado: (0, encryption_service_1.enmascararTelefono)('+542625551234') },
        } });
});
// ══════════════════════════════════════════════════════════
// SLA — Monitoreo de respuesta del cross-reference (< 2s / 72h)
// ══════════════════════════════════════════════════════════
// GET /admin/sla/crossref — estado actual del SLA
r.get('/admin/sla/crossref', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const snapshot = await (0, sla_service_1.calcularSLA72h)(sla_service_1.ENDPOINT_XREF, true);
    res.json({ ok: true, data: snapshot });
});
// GET /admin/sla/crossref/status — health check resumido
r.get('/admin/sla/crossref/status', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const status = await (0, sla_service_1.getSLAStatus)(sla_service_1.ENDPOINT_XREF);
    res.status(status.ok ? 200 : 503).json({ ok: status.ok, data: status });
});
// GET /admin/sla/crossref/historial — historial de snapshots
r.get('/admin/sla/crossref/historial', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { horas } = zod_1.z.object({ horas: zod_1.z.coerce.number().int().min(1).max(720).default(72) }).parse(req.query);
    res.json({ ok: true, data: await (0, sla_service_1.getHistorialSLA)(sla_service_1.ENDPOINT_XREF, horas) });
});
// GET /admin/sla/crossref/latencias — percentiles en tiempo real
r.get('/admin/sla/crossref/latencias', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { minutos } = zod_1.z.object({ minutos: zod_1.z.coerce.number().int().min(1).max(1440).default(60) }).parse(req.query);
    res.json({ ok: true, data: await (0, sla_service_1.getLatenciasRecientes)(sla_service_1.ENDPOINT_XREF, minutos), objetivo: sla_service_1.SLA_OBJETIVO_MS, ventanaH: sla_service_1.VENTANA_H });
});
// POST /admin/sla/crossref/calcular — forzar recálculo del SLA
r.post('/admin/sla/crossref/calcular', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const snapshot = await (0, sla_service_1.calcularSLA72h)(sla_service_1.ENDPOINT_XREF, true);
    res.json({ ok: true, data: snapshot, recalculado: true });
});
// POST /admin/sla/crossref/reset — resetear métricas (testing)
r.post('/admin/sla/crossref/reset', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    await (0, sla_service_1.resetearMetricas)(sla_service_1.ENDPOINT_XREF);
    res.json({ ok: true, data: { reseteado: true, endpoint: sla_service_1.ENDPOINT_XREF } });
});
// POST /admin/sla/simular — inyectar métricas de prueba
r.post('/admin/sla/simular', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        cantidad: zod_1.z.coerce.number().int().min(1).max(10000).default(1000),
        pct_ok: zod_1.z.coerce.number().min(0).max(100).default(99.5), // % bajo 2s
        latencia_ok_ms: zod_1.z.coerce.number().default(450),
        latencia_slow_ms: zod_1.z.coerce.number().default(3500),
    }).parse(req.body);
    let inyectados = 0;
    const ahora = Date.now();
    const intervalo = sla_service_1.VENTANA_H * 3_600_000 / body.cantidad; // distribuir en 72h
    for (let i = 0; i < body.cantidad; i++) {
        const esBajo = Math.random() * 100 < body.pct_ok;
        const ms = esBajo
            ? Math.round(body.latencia_ok_ms * (0.5 + Math.random()))
            : Math.round(body.latencia_slow_ms * (0.8 + Math.random() * 0.4));
        const ts = ahora - (body.cantidad - i) * intervalo;
        await (0, sla_service_1.registrarMetrica)({
            endpoint: sla_service_1.ENDPOINT_XREF,
            latenciaMs: ms,
            httpStatus: 200,
            error: false,
            cacheHit: Math.random() > 0.7,
            certSubject: 'minseg-client-001',
            serial: 'SN-SIM-' + String(i).padStart(5, '0'),
        });
        inyectados++;
    }
    // Recalcular SLA con los datos inyectados
    const snapshot = await (0, sla_service_1.calcularSLA72h)(sla_service_1.ENDPOINT_XREF, true);
    res.json({ ok: true, data: { inyectados, snapshot } });
});
// ══════════════════════════════════════════════════════════
// MINSEG — Webhook inverso: recuperación de bicicletas
// ══════════════════════════════════════════════════════════
// POST /webhooks/minseg/recuperacion — evento dedicado para recuperaciones
// Alternativa especializada al handler genérico /webhooks/minseg
r.post('/webhooks/minseg/recuperacion', rateLimiter_1.burstRateLimit, async (req, res) => {
    const signature = req.headers['x-minseg-signature'] ?? '';
    const timestamp = req.headers['x-minseg-timestamp'] ?? '0';
    const eventId = req.headers['x-minseg-event-id']
        ?? require('crypto').createHash('sha256').update(JSON.stringify(req.body)).digest('hex').slice(0, 32);
    const ipOrigen = req.ip ?? req.headers['x-forwarded-for']?.split(',')[0]?.trim();
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const result = await (0, minseg_recuperacion_service_1.procesarRecuperacionMinSeg)({
        rawBody, signature, timestamp, eventId, ipOrigen,
    });
    // SIEMPRE responder 200 a MinSeg (para evitar reintentos infinitos)
    // Los estados NO_ENCONTRADO o ERROR se manejan por reintento nuestro
    res.status(200).json({
        ok: result.procesado || result.estado === 'NO_ENCONTRADO',
        estado: result.estado,
        eventId: result.eventId,
        recuperacionId: result.recuperacionId,
        serial: result.serial,
        citReactivado: result.citReactivado,
        mensaje: result.mensaje,
    });
});
// Admin: listar recuperaciones recibidas
r.get('/admin/minseg/recuperaciones', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const q = zod_1.z.object({
        estado: zod_1.z.string().optional(),
        serial: zod_1.z.string().optional(),
        pagina: zod_1.z.coerce.number().int().min(1).default(1),
        porPagina: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    }).parse(req.query);
    res.json({ ok: true, data: await (0, minseg_recuperacion_service_1.getRecuperacionesMinSeg)(q) });
});
// Admin: estadísticas de recuperaciones
r.get('/admin/minseg/recuperaciones/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, minseg_recuperacion_service_1.getEstadisticasRecuperaciones)(dias) });
});
// Admin: reprocesar eventos pendientes
r.post('/admin/minseg/recuperaciones/reprocesar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, minseg_recuperacion_service_1.reprocesarPendientes)() });
});
// Admin: simular recuperación (testing)
r.post('/admin/minseg/recuperaciones/simular', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        serial: zod_1.z.string().min(3),
        numero_expediente: zod_1.z.string().optional(),
        numero_denuncia: zod_1.z.string().optional(),
        lugar_recuperacion: zod_1.z.string().optional(),
        autoridad_actuante: zod_1.z.string().optional(),
    }).parse(req.body);
    const crypto2 = require('crypto');
    const eventId = crypto2.randomUUID();
    const payload = JSON.stringify({
        tipo: 'RECUPERACION_NOTIFICADA',
        serial: body.serial,
        numero_expediente: body.numero_expediente ?? `SIM-${Date.now()}`,
        numero_denuncia: body.numero_denuncia ?? null,
        fecha_recuperacion: new Date().toISOString(),
        lugar_recuperacion: body.lugar_recuperacion ?? 'San Martín, Mendoza',
        autoridad_actuante: body.autoridad_actuante ?? 'Comisaría 5ta San Martín (SIMULACIÓN)',
        descripcion: 'Recuperación simulada desde panel admin RODAID',
    });
    // Generar firma HMAC para que pase la verificación (usando secret local)
    const ts = Math.floor(Date.now() / 1000).toString();
    const bHash = crypto2.createHash('sha256').update(payload).digest('hex');
    const secret = process.env.MINSEG_WEBHOOK_SECRET ?? process.env.MINSEG_API_KEY ?? 'STUB_WEBHOOK_SECRET';
    const sig = crypto2.createHmac('sha256', secret).update(`${ts}.${bHash}`).digest('hex');
    const result = await (0, minseg_recuperacion_service_1.procesarRecuperacionMinSeg)({
        rawBody: payload,
        signature: sig,
        timestamp: ts,
        eventId,
        ipOrigen: req.ip,
    });
    res.json({ ok: true, data: result, simulacion: true });
});
// ══════════════════════════════════════════════════════════
// mTLS — POST /seguridad/cross-reference
// Endpoint exclusivo para el Ministerio de Seguridad.
// Requiere certificado de cliente emitido por RODAID CA.
// ══════════════════════════════════════════════════════════
// POST /seguridad/cross-reference
//   mTLS verificado en requireMtls → inyecta req.mtlsClient
//   Body: { serial, propietarioDNI?, propietarioNombre?, incluirHistorial? }
r.post('/seguridad/cross-reference', (0, sla_service_1.slaMiddleware)(), // ← mide latencia ANTES del handler
mtls_middleware_1.requireMtls, mtls_middleware_1.requireMtlsIpWhitelist, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        serial: zod_1.z.string().min(3).max(80),
        propietarioDNI: zod_1.z.string().min(7).max(15).optional(),
        propietarioNombre: zod_1.z.string().min(2).max(200).optional(),
        incluirHistorial: zod_1.z.boolean().default(false),
    }).parse(req.body);
    // Verificar permiso 'crossref' en el certificado
    const cliente = req.mtlsClient;
    if (!cliente.permisos.includes('crossref')) {
        res.status(403).json({
            ok: false,
            error: 'PERMISO_INSUFICIENTE',
            msg: `El certificado ${cliente.cn} no tiene permiso 'crossref'.`,
        });
        return;
    }
    const result = await (0, crossreference_service_1.crossReference)(body, cliente);
    // Código HTTP según resultado
    const status = result.alertas.bloqueado || result.alertas.alerta_activa ? 200
        : result.encontrado ? 200 : 404;
    res.status(status).json({ ok: true, data: result });
});
// GET /seguridad/cross-reference/stats — estadísticas (admin JWT normal)
r.get('/seguridad/cross-reference/stats', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, crossreference_service_1.getEstadisticasCrossRef)(dias) });
});
// GET /admin/mtls/certificados — listar certificados registrados
r.get('/admin/mtls/certificados', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { query: q } = await import('../config/database');
    const certs = await q(`SELECT id, organizacion, cn, thumbprint, permisos, activo,
            max_consultas_dia, valido_hasta, creado_en
     FROM mtls_certificados ORDER BY creado_en DESC`, []);
    res.json({ ok: true, data: certs });
});
// POST /admin/mtls/certificados — registrar nuevo certificado
r.post('/admin/mtls/certificados', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        organizacion: zod_1.z.string().min(3).max(100),
        cn: zod_1.z.string().min(3).max(100),
        certPem: zod_1.z.string().min(100),
        permisos: zod_1.z.array(zod_1.z.string()).default(['crossref']),
        maxConsultasDia: zod_1.z.coerce.number().int().positive().default(10000),
    }).parse(req.body);
    // Calcular thumbprint desde el PEM
    const forge = await import('node-forge');
    const cert = forge.default.pki.certificateFromPem(body.certPem);
    const der = forge.default.asn1.toDer(forge.default.pki.certificateToAsn1(cert)).getBytes();
    const crypto2 = await import('crypto');
    const thumb = crypto2.default.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
    const validoHasta = cert.validity.notAfter;
    const { queryOne: q1 } = await import('../config/database');
    const row = await q1(`INSERT INTO mtls_certificados (organizacion, cn, cert_pem, thumbprint, permisos, max_consultas_dia, valido_hasta)
     VALUES ($1,$2,$3,$4,$5::text[],$6,$7) ON CONFLICT (thumbprint) DO NOTHING RETURNING id`, [body.organizacion, body.cn, body.certPem, thumb, body.permisos, body.maxConsultasDia, validoHasta]);
    res.status(201).json({ ok: true, data: { id: row?.id, thumbprint: thumb, validoHasta } });
});
// PATCH /admin/mtls/certificados/:id/revocar — revocar certificado
r.patch('/admin/mtls/certificados/:id/revocar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { query: q } = await import('../config/database');
    await q('UPDATE mtls_certificados SET activo=FALSE WHERE id=$1', [req.params.id]);
    res.json({ ok: true, data: { revocado: true } });
});
// ══════════════════════════════════════════════════════════
// MINSEG — Protocolo de intercambio gubernamental
// ══════════════════════════════════════════════════════════
// GET /admin/minseg/protocolo — especificación completa del protocolo
r.get('/admin/minseg/protocolo', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (_req, res) => {
    res.json({ ok: true, data: minseg_protocol_service_1.PROTOCOLO_DESCRIPCION });
});
// GET /admin/minseg/estadisticas — métricas de intercambio
r.get('/admin/minseg/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(7) }).parse(req.query);
    res.json({ ok: true, data: await (0, minseg_protocol_service_1.getEstadisticasIntercambio)(dias) });
});
// GET /admin/minseg/historial — log de intercambios
r.get('/admin/minseg/historial', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const q = zod_1.z.object({
        tipo: zod_1.z.string().optional(),
        serial: zod_1.z.string().optional(),
        pagina: zod_1.z.coerce.number().int().min(1).default(1),
        porPagina: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    }).parse(req.query);
    res.json({ ok: true, data: await (0, minseg_protocol_service_1.getHistorialIntercambios)(q) });
});
// POST /admin/minseg/sync — sincronización manual
r.post('/admin/minseg/sync', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const result = await (0, minseg_protocol_service_1.sincronizarDiario)();
    res.json({ ok: true, data: result });
});
// POST /admin/minseg/cola/procesar — procesar reintentos pendientes
r.post('/admin/minseg/cola/procesar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, minseg_protocol_service_1.procesarColaPendiente)() });
});
// POST /admin/minseg/notificar-cit — notificar CIT manualmente (testing)
r.post('/admin/minseg/notificar-cit', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        numeroCIT: zod_1.z.string().min(5),
        citId: zod_1.z.string().uuid(),
        serial: zod_1.z.string().min(3),
        marca: zod_1.z.string().min(2),
        modelo: zod_1.z.string().min(2),
        propietarioDNI: zod_1.z.string().min(7),
        propietarioNombre: zod_1.z.string().min(3),
        inspectorId: zod_1.z.string().uuid(),
        tallerLocalidad: zod_1.z.string().default('San Martín'),
        txHashBFA: zod_1.z.string().default('0x' + 'a'.repeat(64)),
        fechaEmision: zod_1.z.string().default(new Date().toISOString()),
        validoHasta: zod_1.z.string().default(new Date(Date.now() + 2 * 365 * 86400000).toISOString()),
    }).parse(req.body);
    res.json({ ok: true, data: await (0, minseg_protocol_service_1.notificarCITMinSeg)(body) });
});
// POST /admin/minseg/consultar-serial — test de consulta manual
r.post('/admin/minseg/consultar-serial', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { serial } = zod_1.z.object({ serial: zod_1.z.string().min(3) }).parse(req.body);
    res.json({ ok: true, data: await (0, minseg_protocol_service_1.consultarSerialMinSeg)(serial) });
});
// POST /admin/minseg/verificar-firma — test de verificación de firma webhook
r.post('/admin/minseg/verificar-firma', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        signature: zod_1.z.string(), timestamp: zod_1.z.string(), rawBody: zod_1.z.string(),
    }).parse(req.body);
    const result = (0, minseg_protocol_service_1.verificarFirmaWebhook)({ signature: body.signature, timestamp: body.timestamp, body: body.rawBody });
    res.json({ ok: true, data: result });
});
// POST /webhooks/minseg — webhook entrante de MinSeg (NO requiere auth normal)
r.post('/webhooks/minseg', rateLimiter_1.burstRateLimit, async (req, res) => {
    const signature = req.headers['x-minseg-signature'] ?? '';
    const timestamp = req.headers['x-minseg-timestamp'] ?? '0';
    const eventId = req.headers['x-minseg-event-id'] ?? require('crypto').randomUUID();
    const ipOrigen = req.ip ?? req.headers['x-forwarded-for']?.split(',')[0]?.trim();
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const result = await (0, minseg_protocol_service_1.procesarWebhookMinSeg)({ body: rawBody, signature, timestamp, eventId, ipOrigen });
    res.status(result.procesado ? 200 : 400).json({
        ok: result.procesado,
        accion: result.accion,
        mensaje: result.mensaje,
    });
});
// ══════════════════════════════════════════════════════════
// CAPACITACIÓN — Módulos y examen online
// ══════════════════════════════════════════════════════════
// GET /capacitacion/modulos — módulos de estudio disponibles
r.get('/capacitacion/modulos', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { soloObligatorios } = zod_1.z.object({ soloObligatorios: zod_1.z.coerce.boolean().default(false) }).parse(req.query);
    res.json({ ok: true, data: await (0, capacitacion_service_1.getModulos)(soloObligatorios) });
});
// GET /capacitacion/modulos/:id — contenido de un módulo
r.get('/capacitacion/modulos/:id', rateLimiter_1.burstRateLimit, async (req, res) => {
    const m = await (0, capacitacion_service_1.getModulo)(req.params.id);
    if (!m) {
        res.status(404).json({ ok: false, error: 'Módulo no encontrado' });
        return;
    }
    res.json({ ok: true, data: m });
});
// POST /capacitacion/examen/iniciar — iniciar un examen
r.post('/capacitacion/examen/iniciar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const result = await (0, capacitacion_service_1.iniciarExamen)(req.user.sub);
    res.status(201).json({ ok: true, data: result,
        mensaje: `Examen iniciado. ${result.numPreguntas} preguntas, ${result.tiempoLimiteMin} minutos. Intento ${result.intento}.`
    });
});
// GET /capacitacion/examen/:id/pregunta — siguiente pregunta del examen
r.get('/capacitacion/examen/:id/pregunta', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const result = await (0, capacitacion_service_1.getPreguntaExamen)(req.params.id, req.user.sub);
    res.json({ ok: true, data: result });
});
// POST /capacitacion/examen/:id/responder — responder una pregunta
r.post('/capacitacion/examen/:id/responder', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { preguntaId, opcionId } = zod_1.z.object({
        preguntaId: zod_1.z.string().uuid(),
        opcionId: zod_1.z.string().uuid(),
    }).parse(req.body);
    const result = await (0, capacitacion_service_1.responderPregunta)({ sesionId: req.params.id, usuarioId: req.user.sub, preguntaId, opcionId });
    res.json({ ok: true, data: result });
});
// POST /capacitacion/examen/:id/finalizar — finalizar y calificar
r.post('/capacitacion/examen/:id/finalizar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const result = await (0, capacitacion_service_1.finalizarExamen)(req.params.id, req.user.sub);
    res.status(result.aprobado ? 200 : 422).json({ ok: result.aprobado, data: result,
        mensaje: result.aprobado
            ? `¡Aprobado! ${result.porcentaje}% (${result.correctas}/${result.puntajeMaximo}). Certificado: ${result.numeroCert}`
            : `Reprobado: ${result.porcentaje}% (mínimo ${70}%). Próximo intento disponible en 24 horas.`
    });
});
// GET /capacitacion/mi-historial — historial de exámenes y certificado
r.get('/capacitacion/mi-historial', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    res.json({ ok: true, data: await (0, capacitacion_service_1.getMiHistorial)(req.user.sub) });
});
// GET /capacitacion/examen/:id — detalle de una sesión (para review)
r.get('/capacitacion/examen/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const sesion = await (0, capacitacion_service_1.getSesionDetalle)(req.params.id, req.user.sub);
    if (!sesion) {
        res.status(404).json({ ok: false, error: 'Sesión no encontrada' });
        return;
    }
    res.json({ ok: true, data: sesion });
});
// Admin: estadísticas del sistema de exámenes
r.get('/admin/capacitacion/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, capacitacion_service_1.getEstadisticasExamen)() });
});
// Admin: preguntas de un módulo (con respuestas correctas)
r.get('/admin/capacitacion/modulos/:id/preguntas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    res.json({ ok: true, data: await (0, capacitacion_service_1.getPreguntasModulo)(req.params.id) });
});
// Admin: crear pregunta en el banco
r.post('/admin/capacitacion/modulos/:id/preguntas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        texto: zod_1.z.string().min(10),
        explicacion: zod_1.z.string().min(10),
        tipo: zod_1.z.enum(['opcion_multiple', 'verdadero_falso']).default('opcion_multiple'),
        dificultad: zod_1.z.enum(['BAJA', 'MEDIA', 'ALTA']).default('MEDIA'),
        puntos: zod_1.z.coerce.number().int().min(1).max(3).default(1),
        opciones: zod_1.z.array(zod_1.z.object({ texto: zod_1.z.string().min(2), esCorrecta: zod_1.z.boolean() })).min(2).max(6),
    }).parse(req.body);
    res.status(201).json({ ok: true, data: await (0, capacitacion_service_1.crearPregunta)({ moduloId: req.params.id, ...body }) });
});
// ══════════════════════════════════════════════════════════
// AUDITORÍA GPS — Detección de anomalías en inspecciones
// ══════════════════════════════════════════════════════════
// GET /admin/auditoria/anomalias — listado de anomalías pendientes
r.get('/admin/auditoria/anomalias', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const q = zod_1.z.object({
        riesgo: zod_1.z.enum(['BAJO', 'MEDIO', 'ALTO', 'CRITICO']).optional(),
        tallerId: zod_1.z.string().uuid().optional(),
        pagina: zod_1.z.coerce.number().int().min(1).default(1),
        porPagina: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    }).parse(req.query);
    const result = await (0, auditoria_gps_service_1.getAnomaliasPendientes)(q);
    res.json({ ok: true, data: result.items ?? result, total: result.total ?? result.length });
});
// POST /admin/auditoria/:id/resolver — resolver una anomalía
r.post('/admin/auditoria/:id/resolver', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        resolucion: zod_1.z.enum(['OK', 'FRAUDE', 'FALSO_POSITIVO']),
        notas: zod_1.z.string().max(300).optional(),
    }).parse(req.body);
    await (0, auditoria_gps_service_1.resolverAnomalia)(req.params.id, { ...body, revisadoPor: req.user.sub });
    res.json({ ok: true, data: { resolucion: body.resolucion, auditoria: req.params.id } });
});
// GET /admin/auditoria/estadisticas
r.get('/admin/auditoria/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, auditoria_gps_service_1.getEstadisticasAuditoria)(dias) });
});
// POST /admin/auditoria/auditar — auditar manualmente un CIT
r.post('/admin/auditoria/auditar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        citId: zod_1.z.string().uuid(),
        inspectorId: zod_1.z.string().uuid(),
        tallerId: zod_1.z.string().uuid(),
        inspLat: zod_1.z.number().optional(),
        inspLng: zod_1.z.number().optional(),
        propLat: zod_1.z.number().optional(),
        propLng: zod_1.z.number().optional(),
        deviceId: zod_1.z.string().optional(),
        ipAddress: zod_1.z.string().optional(),
    }).parse(req.body);
    const result = await (0, auditoria_gps_service_1.auditarInspeccionGPS)(body);
    res.json({ ok: true, data: result });
});
// GET /inspector/auditoria — historial de auditorías del inspector
r.get('/inspector/auditoria', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['INSPECTOR', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Rol INSPECTOR requerido' });
        return;
    }
    const inspectorId = req.user.inspectorId;
    if (!inspectorId) {
        res.status(400).json({ ok: false, error: 'Sin perfil inspector en JWT' });
        return;
    }
    res.json({ ok: true, data: await (0, auditoria_gps_service_1.getHistorialAuditoriaInspector)(inspectorId) });
});
// ══════════════════════════════════════════════════════════
// ALIADO — Panel de gestión
// ══════════════════════════════════════════════════════════
// GET /aliado/dashboard — panel principal con resumen completo
r.get('/aliado/dashboard', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['ALIADO', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Rol ALIADO requerido' });
        return;
    }
    const tallerId = req.user.tallerAliadoId ?? req.query.tallerId;
    if (!tallerId) {
        res.status(400).json({ ok: false, error: 'tallerId requerido' });
        return;
    }
    res.json({ ok: true, data: await (0, aliado_panel_service_1.getDashboardAliado)(tallerId) });
});
// GET /aliado/cits — CITs emitidos con filtros y paginación
r.get('/aliado/cits', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['ALIADO', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Rol ALIADO requerido' });
        return;
    }
    const tallerId = req.user.tallerAliadoId ?? req.query.tallerId;
    if (!tallerId) {
        res.status(400).json({ ok: false, error: 'tallerId requerido' });
        return;
    }
    const q = zod_1.z.object({
        pagina: zod_1.z.coerce.number().int().min(1).default(1),
        porPagina: zod_1.z.coerce.number().int().min(1).max(100).default(25),
        estado: zod_1.z.enum(['PENDIENTE', 'ACTIVO', 'VENCIDO', 'BLOQUEADO', 'RECHAZADO']).optional(),
        inspectorId: zod_1.z.string().uuid().optional(),
        desde: zod_1.z.string().optional(),
        hasta: zod_1.z.string().optional(),
        busqueda: zod_1.z.string().max(100).optional(),
    }).parse(req.query);
    res.json({ ok: true, ...(await (0, aliado_panel_service_1.getCITsTaller)(tallerId, q.pagina, q.porPagina)) });
});
// GET /aliado/retribucion — resumen de retribución acumulada
r.get('/aliado/retribucion', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['ALIADO', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Rol ALIADO requerido' });
        return;
    }
    const tallerId = req.user.tallerAliadoId ?? req.query.tallerId;
    if (!tallerId) {
        res.status(400).json({ ok: false, error: 'tallerId requerido' });
        return;
    }
    const [resumen, tendencia] = await Promise.all([
        (0, aliado_panel_service_1.getResumenRetribucion)(tallerId),
        (0, aliado_panel_service_1.getTendenciaMensual)(tallerId),
    ]);
    res.json({ ok: true, data: {
            resumen, tendencia,
            planes: aliado_panel_service_1.PLANES,
            tasaCIT: parseFloat(process.env.RODAID_TASA_CIT_ARS ?? '3000'),
        } });
});
// GET /aliado/retribucion/tendencia — tendencia mensual configurable
r.get('/aliado/retribucion/tendencia', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['ALIADO', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Rol ALIADO requerido' });
        return;
    }
    const tallerId = req.user.tallerAliadoId ?? req.query.tallerId;
    const { meses } = zod_1.z.object({ meses: zod_1.z.coerce.number().int().min(1).max(24).default(6) }).parse(req.query);
    res.json({ ok: true, data: await (0, aliado_panel_service_1.getTendenciaMensual)(tallerId) });
});
// GET /aliado/inspectores/metricas — rendimiento de cada inspector
r.get('/aliado/inspectores/metricas', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['ALIADO', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Rol ALIADO requerido' });
        return;
    }
    const tallerId = req.user.tallerAliadoId ?? req.query.tallerId;
    res.json({ ok: true, data: await (0, aliado_panel_service_1.getInspectoresMetricas)(tallerId) });
});
// GET /aliado/liquidaciones — historial de liquidaciones mensuales
r.get('/aliado/liquidaciones', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['ALIADO', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Rol ALIADO requerido' });
        return;
    }
    const tallerId = req.user.tallerAliadoId ?? req.query.tallerId;
    res.json({ ok: true, data: await (0, aliado_panel_service_1.getLiquidaciones)(tallerId) });
});
// GET /aliado/liquidaciones/calcular — calcular liquidación de un período (preview)
r.get('/aliado/liquidaciones/calcular', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['ALIADO', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Rol ALIADO requerido' });
        return;
    }
    const tallerId = req.user.tallerAliadoId ?? req.query.tallerId;
    const now = new Date();
    const { mes, año } = zod_1.z.object({
        mes: zod_1.z.coerce.number().int().min(1).max(12).default(now.getMonth() + 1),
        año: zod_1.z.coerce.number().int().default(now.getFullYear()),
    }).parse(req.query);
    res.json({ ok: true, data: await (0, aliado_panel_service_1.calcularLiquidacion)(tallerId, mes, año) });
});
// Admin: registrar retribución manual
r.post('/admin/aliado/retribucion', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        tallerId: zod_1.z.string().uuid(),
        citId: zod_1.z.string().uuid(),
        numeroCIT: zod_1.z.string(),
        inspectorId: zod_1.z.string().uuid().optional(),
        tasaCITARS: zod_1.z.coerce.number().positive().optional(),
    }).parse(req.body);
    const result = await (0, aliado_panel_service_1.registrarRetribucion)(body);
    res.status(201).json({ ok: true, data: result });
});
// Admin: planes de retribución disponibles
r.get('/admin/aliado/planes', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (_req, res) => {
    res.json({ ok: true, data: aliado_panel_service_1.PLANES });
});
// ══════════════════════════════════════════════════════════
// FIRMA — Validación pre-BFA (8 checks de integridad)
// ══════════════════════════════════════════════════════════
// POST /firma/cit/:citId/validar — ejecutar los 8 checks (sin mintear)
r.post('/firma/cit/:citId/validar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['INSPECTOR', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Requiere rol INSPECTOR o ADMIN' });
        return;
    }
    const result = await (0, firma_validacion_service_1.validarFirmaPreBFA)(req.params.citId);
    res.status(result.aprobado ? 200 : 422).json({
        ok: result.aprobado,
        data: {
            aprobado: result.aprobado,
            motivoRechazo: result.motivoRechazo,
            checksOk: result.checks.filter(c => c.ok).length,
            checksFail: result.checks.filter(c => !c.ok).length,
            checks: result.checks,
            validacionId: result.validacionId,
            duracionMs: result.duracionMs,
        },
    });
});
// GET /firma/cit/:citId/validaciones — historial de validaciones
r.get('/firma/cit/:citId/validaciones', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    res.json({ ok: true, data: await (0, firma_validacion_service_1.getHistorialValidaciones)(req.params.citId) });
});
// GET /admin/firma/validaciones/estadisticas
r.get('/admin/firma/validaciones/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, firma_validacion_service_1.getEstadisticasValidaciones)(dias) });
});
// POST /cit/:id/finalizar-seguro — wrapper que incluye validación pre-BFA
r.post('/cit/:id/finalizar-seguro', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { propietarioWallet } = zod_1.z.object({
        propietarioWallet: zod_1.z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    }).parse(req.body);
    const result = await (0, firma_validacion_service_1.finalizarCITConValidacion)(req.params.id, propietarioWallet);
    res.json({ ok: true, data: {
            cit: result.mintResult,
            validacion: {
                validacionId: result.validacion.validacionId,
                checksOk: result.validacion.checks.filter(c => c.ok).length,
                duracionMs: result.validacion.duracionMs,
            },
        } });
});
// ══════════════════════════════════════════════════════════
// FIRMA DIGITAL — CIT payload PKCS#12 / RSA-PSS
// ══════════════════════════════════════════════════════════
// POST /firma/cit — firmar el payload de un CIT
r.post('/firma/cit', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['INSPECTOR', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Rol INSPECTOR requerido' });
        return;
    }
    const body = zod_1.z.object({
        citId: zod_1.z.string().uuid(),
        numeroCIT: zod_1.z.string(),
        serial: zod_1.z.string(),
        marca: zod_1.z.string(),
        modelo: zod_1.z.string(),
        propietarioDNI: zod_1.z.string(),
        propietarioNombre: zod_1.z.string(),
        puntos: zod_1.z.record(zod_1.z.boolean()),
        hashSHA256PDF: zod_1.z.string().optional(),
        p12Base64: zod_1.z.string().optional(), // PKCS#12 del inspector (opcional)
        p12Password: zod_1.z.string().optional(),
    }).parse(req.body);
    const inspectorId = req.user.inspectorId ?? undefined;
    const tallerAliadoId = req.user.tallerAliadoId ?? '';
    const payload = (0, firma_service_1.construirPayloadCIT)({
        citId: body.citId,
        numeroCIT: body.numeroCIT,
        serial: body.serial,
        marca: body.marca,
        modelo: body.modelo,
        propietarioDNI: body.propietarioDNI,
        propietarioNombre: body.propietarioNombre,
        inspectorId: inspectorId ?? req.user.sub,
        tallerAliadoId,
        puntos: body.puntos,
        hashSHA256PDF: body.hashSHA256PDF,
        fechaEmision: new Date().toISOString(),
    });
    const p12Buffer = body.p12Base64 ? Buffer.from(body.p12Base64, 'base64') : undefined;
    const result = await (0, firma_service_1.firmarPayloadCIT)({
        payload,
        citId: body.citId,
        numeroCIT: body.numeroCIT,
        inspectorId,
        p12Buffer,
        p12Password: body.p12Password,
    });
    res.status(201).json({ ok: true, data: {
            firmaId: result.firmaId,
            firmaBase64url: result.firmaBase64url,
            payloadHash: result.payloadHash,
            certSerial: result.certSerial,
            certSubject: result.certSubject,
            algoritmo: result.algoritmo,
            firmadoEn: result.firmadoEn,
            validaHasta: result.validaHasta,
            p12Usado: !!p12Buffer,
        } });
});
// GET /firma/cit/:citId — verificar firma del payload de un CIT
r.get('/firma/cit/:citId', rateLimiter_1.burstRateLimit, async (req, res) => {
    const result = await (0, firma_service_1.verificarFirmaPayload)({ citId: req.params.citId });
    res.json({ ok: true, data: result });
});
// GET /firma/cit/:citId/historial — historial de firmas
r.get('/firma/cit/:citId/historial', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const historial = await (0, firma_service_1.getHistorialFirmas)(req.params.citId);
    res.json({ ok: true, data: historial });
});
// POST /firma/verificar — verificar firma con datos crudos (sin DB)
r.post('/firma/verificar', rateLimiter_1.burstRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        payloadJSON: zod_1.z.string().min(10),
        firmaBase64url: zod_1.z.string().min(10),
        certPEM: zod_1.z.string().min(50),
    }).parse(req.body);
    const result = await (0, firma_service_1.verificarFirmaPayload)(body);
    res.json({ ok: true, data: result });
});
// GET /firma/clave-publica — exportar clave pública para Web Crypto API
r.get('/firma/clave-publica', rateLimiter_1.burstRateLimit, async (_req, res) => {
    const pub = await (0, firma_service_1.exportarClavePublicaWebCrypto)();
    // No exponer el certPEM completo en el endpoint público
    res.json({ ok: true, data: {
            spkiBase64: pub.spkiBase64,
            jwk: pub.jwk,
            algorithm: pub.algorithm,
            hash: pub.hash,
            saltLength: pub.saltLength,
            certSerial: pub.certSerial,
            // Código de ejemplo para el cliente web:
            webCryptoImport: `await crypto.subtle.importKey('spki', base64ToArrayBuffer('${pub.spkiBase64.slice(0, 20)}...'), { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['verify'])`,
        } });
});
// GET /firma/cert-info — info del certificado activo
r.get('/firma/cert-info', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const pub = await (0, firma_service_1.exportarClavePublicaWebCrypto)();
    res.json({ ok: true, data: { certSerial: pub.certSerial, algorithm: pub.algorithm } });
});
// POST /firma/p12/info — leer metadata de un PKCS#12 sin persistirlo
r.post('/firma/p12/info', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { p12Base64, password } = zod_1.z.object({
        p12Base64: zod_1.z.string().min(10),
        password: zod_1.z.string().default(''),
    }).parse(req.body);
    try {
        const p12Info = (0, firma_service_1.cargarP12)(Buffer.from(p12Base64, 'base64'), password);
        const cert = p12Info.certificate;
        res.json({ ok: true, data: {
                thumbprint: p12Info.thumbprint,
                certSerial: cert.serialNumber,
                subject: cert.subject.getField('CN')?.value,
                issuer: cert.issuer.getField('CN')?.value,
                validDesde: cert.validity.notBefore,
                validHasta: cert.validity.notAfter,
                vigente: new Date() >= cert.validity.notBefore && new Date() <= cert.validity.notAfter,
                cadenaCerts: p12Info.cadena.length,
            } });
    }
    catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});
// Admin: revocar firma
r.post('/admin/firma/revocar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { firmaId, motivo } = zod_1.z.object({ firmaId: zod_1.z.string().uuid(), motivo: zod_1.z.string().min(5) }).parse(req.body);
    await (0, firma_service_1.revocarFirmaPayload)(firmaId, motivo);
    res.json({ ok: true, data: { revocada: true } });
});
// ══════════════════════════════════════════════════════════
// INSPECTOR & ALIADO — Auth y gestión
// ══════════════════════════════════════════════════════════
// GET /inspector/perfil — perfil del inspector autenticado
r.get('/inspector/perfil', ...auth_1.authenticated, async (req, res) => {
    if (req.user.rol !== 'INSPECTOR') {
        res.status(403).json({ ok: false, error: 'Rol INSPECTOR requerido' });
        return;
    }
    const { queryOne } = await import('../config/database');
    const perfil = await queryOne(`SELECT i.id AS inspector_id, i.taller_aliado_id, i.certificado, i.activo,
            i.cits_emitidos, i.ultimo_cit_en, i.fecha_alta,
            ta.nombre AS taller_nombre, ta.localidad, ta.provincia,
            ta.plan_aliado, ta.habilitado AS taller_habilitado,
            ta.nro_aliado
     FROM inspectores i JOIN talleres_aliados ta ON ta.id=i.taller_aliado_id
     WHERE i.usuario_id=$1`, [req.user.sub]);
    if (!perfil) {
        res.status(404).json({ ok: false, error: 'Sin perfil de inspector' });
        return;
    }
    res.json({ ok: true, data: {
            ...perfil,
            // Claims del JWT (sin necesidad de DB para validaciones rápidas)
            jwtInspectorId: req.user.inspectorId,
            jwtTallerAliadoId: req.user.tallerAliadoId,
            jwtTallerNombre: req.user.tallerNombre,
            permisos: (0, rbac_service_1.getPermissions)('INSPECTOR'),
        } });
});
// POST /inspector/refresh-token — renovar token con claims de inspector actualizados
r.post('/inspector/refresh-token', ...auth_1.authenticated, async (req, res) => {
    if (req.user.rol !== 'INSPECTOR') {
        res.status(403).json({ ok: false, error: 'Rol INSPECTOR requerido' });
        return;
    }
    const tokens = await (0, jwt_service_1.buildTokenPairInspector)(req.user.sub, req.user.email);
    res.json({ ok: true, data: tokens, message: 'Token de inspector renovado con claims actualizados' });
});
// GET /aliado/perfil — perfil del taller aliado del usuario autenticado
r.get('/aliado/perfil', ...auth_1.authenticated, async (req, res) => {
    if (req.user.rol !== 'ALIADO' && req.user.rol !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Rol ALIADO requerido' });
        return;
    }
    const { queryOne, query } = await import('../config/database');
    const [taller, inspectores] = await Promise.all([
        queryOne(`SELECT id, nombre, direccion, localidad, provincia, lat, lng, telefono,
              email, descripcion, plan_aliado, habilitado, nro_aliado,
              habilitado_en, creado_en
       FROM talleres_aliados WHERE propietario_id=$1 AND activo=TRUE LIMIT 1`, [req.user.sub]),
        query(`SELECT i.id, u.nombre, u.apellido, u.email, i.certificado, i.activo,
              i.cits_emitidos, i.ultimo_cit_en, i.fecha_alta
       FROM inspectores i JOIN usuarios u ON u.id=i.usuario_id
       WHERE i.taller_aliado_id=$1
       ORDER BY i.fecha_alta DESC`, [req.user.tallerAliadoId ?? '00000000-0000-0000-0000-000000000000']),
    ]);
    if (!taller) {
        res.status(404).json({ ok: false, error: 'Sin taller aliado vinculado' });
        return;
    }
    res.json({ ok: true, data: {
            taller, inspectores,
            jwtTallerAliadoId: req.user.tallerAliadoId,
            permisos: (0, rbac_service_1.getPermissions)('ALIADO'),
        } });
});
// GET /aliado/inspectores — listar inspectores del taller
r.get('/aliado/inspectores', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['ALIADO', 'ADMIN'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    const { query } = await import('../config/database');
    const tallerId = req.user.tallerAliadoId ?? req.query.taller_id;
    if (!tallerId) {
        res.status(400).json({ ok: false, error: 'taller_id requerido' });
        return;
    }
    const inspectores = await query(`SELECT i.id, i.usuario_id, u.nombre, u.apellido, u.email,
            i.certificado, i.activo, i.cits_emitidos, i.ultimo_cit_en, i.fecha_alta
     FROM inspectores i JOIN usuarios u ON u.id=i.usuario_id
     WHERE i.taller_aliado_id=$1 ORDER BY i.activo DESC, u.apellido`, [tallerId]);
    res.json({ ok: true, data: inspectores, total: inspectores.length });
});
// GET /talleres — talleres aliados públicos (para el mapa)
r.get('/talleres', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { localidad } = zod_1.z.object({ localidad: zod_1.z.string().optional() }).parse(req.query);
    const { query } = await import('../config/database');
    const cond = localidad ? `AND localidad ILIKE '%' || $2 || '%'` : '';
    const talleres = await query(`SELECT id, nombre, localidad, provincia, lat, lng, telefono, plan_aliado
     FROM talleres_aliados WHERE habilitado=TRUE AND activo=TRUE ${cond}
     ORDER BY nombre LIMIT 50`, localidad ? [true, localidad] : [true]);
    res.json({ ok: true, data: talleres });
});
// Admin: crear inspector y asignarlo a un taller
r.post('/admin/inspectores', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        usuarioId: zod_1.z.string().uuid(),
        tallerAliadoId: zod_1.z.string().uuid(),
        certificado: zod_1.z.boolean().default(false),
        notas: zod_1.z.string().max(500).optional(),
    }).parse(req.body);
    const { query, queryOne } = await import('../config/database');
    // Verificar que el usuario existe y cambiar su rol
    const u = await queryOne('SELECT id, email, rol FROM usuarios WHERE id=$1', [body.usuarioId]);
    if (!u) {
        res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
        return;
    }
    await query('BEGIN');
    try {
        const insp = await queryOne(`INSERT INTO inspectores (usuario_id, taller_aliado_id, certificado, activo, habilitado_por, notas)
       VALUES ($1,$2,$3,TRUE,$4,$5)
       ON CONFLICT (usuario_id) DO UPDATE SET taller_aliado_id=$2, certificado=$3, activo=TRUE, habilitado_por=$4
       RETURNING id`, [body.usuarioId, body.tallerAliadoId, body.certificado, req.user.sub, body.notas ?? null]);
        await query("UPDATE usuarios SET rol='INSPECTOR' WHERE id=$1", [body.usuarioId]);
        await query('COMMIT');
        res.status(201).json({ ok: true, data: { inspectorId: insp?.id, rol: 'INSPECTOR' } });
    }
    catch (e) {
        await query('ROLLBACK');
        throw e;
    }
});
// Admin: habilitar/deshabilitar inspector
r.patch('/admin/inspectores/:id/habilitar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { activo } = zod_1.z.object({ activo: zod_1.z.boolean() }).parse(req.body);
    const { query } = await import('../config/database');
    await query(`UPDATE inspectores SET activo=$2, habilitado_por=$3,
       fecha_alta=CASE WHEN $2 THEN NOW() ELSE fecha_alta END,
       fecha_baja=CASE WHEN NOT $2 THEN NOW() ELSE fecha_baja END
     WHERE id=$1`, [req.params.id, activo, req.user.sub]);
    res.json({ ok: true, data: { activo }, message: activo ? 'Inspector habilitado' : 'Inspector deshabilitado' });
});
// Admin: crear taller aliado
r.post('/admin/talleres', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        propietarioId: zod_1.z.string().uuid(),
        nombre: zod_1.z.string().min(3).max(100),
        localidad: zod_1.z.string().max(80).optional(),
        provincia: zod_1.z.string().max(60).default('Mendoza'),
        direccion: zod_1.z.string().max(200).optional(),
        telefono: zod_1.z.string().max(25).optional(),
        email: zod_1.z.string().email().optional(),
        planAliado: zod_1.z.enum(['PIONERO', 'CONSTRUCTOR', 'ESCALADOR']).default('PIONERO'),
    }).parse(req.body);
    const { queryOne } = await import('../config/database');
    const seq = await queryOne('SELECT COUNT(*)::text AS count FROM talleres_aliados', []);
    const nro = 'ALI-' + String(parseInt(seq?.count ?? '0') + 1).padStart(3, '0');
    const row = await queryOne(`INSERT INTO talleres_aliados
       (propietario_id, nombre, localidad, provincia, direccion, telefono, email, plan_aliado, nro_aliado, habilitado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, nro_aliado`, [body.propietarioId, body.nombre, body.localidad ?? null, body.provincia, body.direccion ?? null,
        body.telefono ?? null, body.email ?? null, body.planAliado, nro, req.user.sub]);
    // Cambiar rol del propietario a ALIADO
    const { query } = await import('../config/database');
    await query("UPDATE usuarios SET rol='ALIADO' WHERE id=$1", [body.propietarioId]);
    res.status(201).json({ ok: true, data: row });
});
// Admin: habilitar taller
r.patch('/admin/talleres/:id/habilitar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { habilitado } = zod_1.z.object({ habilitado: zod_1.z.boolean() }).parse(req.body);
    const { query } = await import('../config/database');
    await query('UPDATE talleres_aliados SET habilitado=$2, habilitado_por=$3, habilitado_en=CASE WHEN $2 THEN NOW() ELSE NULL END WHERE id=$1', [req.params.id, habilitado, req.user.sub]);
    res.json({ ok: true, data: { habilitado }, message: habilitado ? 'Taller habilitado' : 'Taller deshabilitado' });
});
// ══════════════════════════════════════════════════════════
// PREFERENCIAS DE NOTIFICACIÓN — Centro de preferencias
// ══════════════════════════════════════════════════════════
// GET /notificaciones/preferencias — centro de preferencias del usuario
r.get('/notificaciones/preferencias', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const prefs = await (0, notif_preferencias_service_1.getPreferenciasPorEvento)(req.user.sub);
    res.json({ ok: true, data: {
            preferencias: prefs,
            grupos: notif_preferencias_service_1.GRUPOS_ORDEN,
            meta: notif_preferencias_service_1.EVENTO_META,
        } });
});
// PUT /notificaciones/preferencias — actualizar una preferencia
r.put('/notificaciones/preferencias', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        evento: zod_1.z.string(),
        canal: zod_1.z.enum(['push', 'email', 'mxm', 'in_app']),
        activo: zod_1.z.boolean(),
        horaInicio: zod_1.z.number().int().min(0).max(23).optional(),
        horaFin: zod_1.z.number().int().min(0).max(23).optional(),
    }).parse(req.body);
    await (0, notif_preferencias_service_1.setPreferencia)(req.user.sub, body.evento, body.canal, body.activo, body.horaInicio !== undefined ? { horaInicio: body.horaInicio, horaFin: body.horaFin } : undefined);
    res.json({ ok: true, data: { actualizado: true, evento: body.evento, canal: body.canal, activo: body.activo } });
});
// PUT /notificaciones/preferencias/bulk — actualizar múltiples a la vez
r.put('/notificaciones/preferencias/bulk', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        preferencias: zod_1.z.array(zod_1.z.object({
            evento: zod_1.z.string(),
            canal: zod_1.z.enum(['push', 'email', 'mxm', 'in_app']),
            activo: zod_1.z.boolean(),
        })).min(1).max(72), // max: 18 eventos × 4 canales
    }).parse(req.body);
    const result = await (0, notif_preferencias_service_1.setPreferenciasBulk)(req.user.sub, body.preferencias);
    res.json({ ok: true, data: result });
});
// DELETE /notificaciones/preferencias — resetear a defaults
r.delete('/notificaciones/preferencias', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    await (0, notif_preferencias_service_1.resetarPreferencias)(req.user.sub);
    res.json({ ok: true, data: { reseteado: true }, message: 'Preferencias restauradas a valores por defecto' });
});
// POST /notificaciones/preferencias/toggle-email — activar/desactivar todos los emails
r.post('/notificaciones/preferencias/toggle-email', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { activo } = zod_1.z.object({ activo: zod_1.z.boolean() }).parse(req.body);
    const count = await (0, notif_preferencias_service_1.toggleTodosEmail)(req.user.sub, activo);
    res.json({ ok: true, data: { actualizados: count, activo },
        message: activo ? `${count} emails de RODAID activados` : `${count} emails de RODAID desactivados`,
    });
});
// POST /notificaciones/preferencias/toggle-push — activar/desactivar todos los push
r.post('/notificaciones/preferencias/toggle-push', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { activo } = zod_1.z.object({ activo: zod_1.z.boolean() }).parse(req.body);
    const count = await (0, notif_preferencias_service_1.toggleTodosPush)(req.user.sub, activo);
    res.json({ ok: true, data: { actualizados: count, activo } });
});
// GET /notificaciones/unsubscribe?token=... — one-click unsubscribe desde email
r.get('/notificaciones/unsubscribe', async (req, res) => {
    const { token } = zod_1.z.object({ token: zod_1.z.string().min(20) }).parse(req.query);
    const result = await (0, notif_preferencias_service_1.procesarUnsubToken)(token);
    // Respuesta amigable para el browser
    const frontendUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar';
    if (result.ok) {
        res.redirect(302, `${frontendUrl}/notificaciones/preferencias?unsub=ok&evento=${result.evento ?? 'todos'}&canal=${result.canal}`);
    }
    else {
        res.redirect(302, `${frontendUrl}/notificaciones/preferencias?unsub=error&msg=${encodeURIComponent(result.mensaje)}`);
    }
});
// POST /notificaciones/preferencias/unsub-link — generar link de desuscripción
r.post('/notificaciones/preferencias/unsub-link', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { evento } = zod_1.z.object({ evento: zod_1.z.string().optional() }).parse(req.body);
    const link = await (0, notif_preferencias_service_1.getLinkDesuscripcion)(req.user.sub, evento);
    res.json({ ok: true, data: { link } });
});
// Admin: estadísticas de preferencias
r.get('/admin/notificaciones/preferencias/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, notif_preferencias_service_1.getEstadisticasPreferencias)() });
});
// Admin: metadata de eventos y canales
r.get('/admin/notificaciones/preferencias/meta', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: { eventos: notif_preferencias_service_1.EVENTO_META, grupos: notif_preferencias_service_1.GRUPOS_ORDEN } });
});
// ══════════════════════════════════════════════════════════
// EMAIL — Templates transaccionales
// ══════════════════════════════════════════════════════════
// GET /admin/email/templates — lista de templates disponibles
r.get('/admin/email/templates', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: (0, email_sender_1.listTemplates)() });
});
// GET /admin/email/preview?template=citEmitido — preview HTML
r.get('/admin/email/preview', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { template } = zod_1.z.object({ template: zod_1.z.string() }).parse(req.query);
    const datosDemo = {
        citEmitido: { nombre: 'Federico', numeroCIT: 'RCIT-2026-001', serial: 'SN-TREK-001', marca: 'Trek', modelo: 'Marlin 5', txHash: '0xabcdef1234567890abcdef1234567890abcdef12', fechaVencimiento: '31/05/2028' },
        citRechazado: { nombre: 'Federico', numeroCIT: 'RCIT-2026-002', serial: 'SN-001', marca: 'Trek', modelo: 'FX', motivo: 'Rodado en base de denuncias MinSeg', alertaMinSeg: true },
        citPorVencer: { nombre: 'Federico', numeroCIT: 'RCIT-2026-001', serial: 'SN-TREK-001', marca: 'Trek', modelo: 'Marlin', diasRestantes: 7, fechaVencimiento: '07/06/2026' },
        citVencido: { nombre: 'Federico', numeroCIT: 'RCIT-2026-001', serial: 'SN-001', marca: 'Trek', modelo: 'FX' },
        tasaConfirmada: { nombre: 'Federico', montoARS: 3000, pagoId: 'aabb-1122-3344', numeroCIT: 'RCIT-2026-001' },
        pagoRechazado: { nombre: 'Federico', montoARS: 3000, motivo: 'Fondos insuficientes' },
        denunciaRegistrada: { nombre: 'Federico', serial: 'SN-TREK-001', marca: 'Trek', modelo: 'Marlin', numeroDenuncia: 'DEN-2026-001', fecha: '01/06/2026 15:30' },
        biciRecuperada: { nombre: 'Federico', serial: 'SN-TREK-001', marca: 'Trek', modelo: 'Marlin' },
        ventaConfirmada: { nombre: 'Federico', marca: 'Trek', modelo: 'Marlin', serial: 'SN-001', montoARS: 380000, comisionARS: 9500 },
        compraCompletada: { nombre: 'Juan', marca: 'Trek', modelo: 'Marlin', serial: 'SN-001', montoARS: 380000, numeroCIT: 'RCIT-2026-001' },
        nuevaOferta: { nombre: 'Federico', marca: 'Trek', modelo: 'Marlin', serial: 'SN-001', ofertaARS: 350000, publicacionId: 'pub-001' },
        disputaAbierta: { nombre: 'Federico', disputaId: 'dis-001', motivo: 'No recibí la bici', rol: 'comprador' },
        disputaResuelta: { nombre: 'Federico', disputaId: 'dis-001', resolucion: 'Reembolso al comprador', rol: 'comprador' },
        nftTransferido: { nombre: 'Juan', numeroCIT: 'RCIT-2026-001', serial: 'SN-001', txHash: '0xabcdef1234567890abcdef1234567890abcdef12' },
        bienvenida: { nombre: 'Federico' },
        verificacionEmail: { nombre: 'Federico', url: 'https://rodaid.com.ar/verify?token=abc123', expiraHoras: 24 },
        resetPassword: { nombre: 'Federico', url: 'https://rodaid.com.ar/reset?token=abc123', expiraMinutos: 60 },
        passwordCambiado: { nombre: 'Federico', fecha: '01/06/2026 15:30', ip: '192.168.1.1' },
        alertaLoginNuevoDispositivo: { nombre: 'Federico', dispositivo: 'Chrome / macOS', ip: '192.168.1.1', fecha: '01/06/2026 15:30', revocarUrl: 'https://rodaid.com.ar/sesiones' },
        codigoVerificacion2FA: { nombre: 'Federico', codigo: '847263', expiraMin: 10 },
    };
    const datos = datosDemo[template];
    if (!datos) {
        res.status(404).json({ ok: false, error: 'Template no encontrado. Templates disponibles: ' + Object.keys(datosDemo).join(', ') });
        return;
    }
    const html = (0, email_sender_1.renderPreview)(template, datos);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});
// POST /admin/email/test — enviar email de prueba
r.post('/admin/email/test', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        to: zod_1.z.string().email(),
        template: zod_1.z.string(),
        datos: zod_1.z.record(zod_1.z.unknown()).optional(),
    }).parse(req.body);
    const datosDefecto = {
        nombre: 'Admin Test', numeroCIT: 'RCIT-TEST-001', serial: 'SN-TEST', marca: 'Trek', modelo: 'Test',
        txHash: '0x' + 'a'.repeat(64), diasRestantes: 7, fechaVencimiento: '30/06/2026',
        montoARS: 3000, pagoId: 'test-pago', motivo: 'Prueba', numeroDenuncia: 'DEN-TEST',
        fecha: new Date().toLocaleString('es-AR'), url: 'https://rodaid.com.ar/test',
        expiraHoras: 24, expiraMinutos: 60, codigo: '123456', expiraMin: 10,
        comisionARS: 75, ofertaARS: 280000, publicacionId: 'pub-test',
        disputaId: 'dis-test', resolucion: 'Test resolución', rol: 'comprador',
        dispositivo: 'Chrome / macOS', ip: '127.0.0.1', revocarUrl: 'https://rodaid.com.ar',
    };
    const result = await (0, email_sender_1.sendEmail)({ to: body.to, template: body.template, datos: { ...datosDefecto, ...body.datos } });
    res.json({ ok: result.ok, data: result });
});
// GET /admin/email/estadisticas
r.get('/admin/email/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, email_sender_1.getEmailStats)(dias) });
});
// ══════════════════════════════════════════════════════════
// CANAL MxM — Notificaciones gubernamentales
// ══════════════════════════════════════════════════════════
// GET /admin/mxm/canal/estado — estado del canal y estadísticas
r.get('/admin/mxm/canal/estado', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getRedis } = await import('../config/redis');
    const redis = getRedis();
    const [stats, pending, delivered, failed] = await Promise.all([
        require('../config/database').query(`SELECT COUNT(*) FILTER(WHERE mxm_estado='ENTREGADA')::int AS entregadas, COUNT(*) FILTER(WHERE mxm_estado='FALLIDA')::int AS fallidas, COUNT(*) FILTER(WHERE mxm_estado='PENDIENTE')::int AS pendientes, COUNT(*)::int AS total FROM mxm_notif_envios WHERE creado_en>NOW()-INTERVAL'24h'`, []),
        redis.get('mxm:cb:estado'),
        redis.get('mxm:cb:health'),
        require('../config/database').query(`SELECT COUNT(*)::int AS count FROM mxm_notif_queue WHERE estado IN ('PENDIENTE','FALLIDA')`, []),
    ]);
    const s = stats[0] || {};
    res.json({ ok: true, data: {
            modoEnvio: !!process.env.MXM_NOTIF_URL ? 'LIVE' : 'STUB',
            notifUrl: process.env.MXM_NOTIF_URL ?? '(no configurado — STUB)',
            circuitState: pending ?? 'CLOSED',
            healthState: delivered ?? 'UP',
            ultimas24h: {
                total: s.total ?? 0,
                entregadas: s.entregadas ?? 0,
                fallidas: s.fallidas ?? 0,
                pendientes: s.pendientes ?? 0,
                tasaEntrega: s.total > 0 ? Math.round(s.entregadas / s.total * 100) : 100,
            },
            colaActual: { pendientes: failed[0]?.count ?? 0 },
        } });
});
// GET /admin/mxm/canal/historial — historial de envíos
r.get('/admin/mxm/canal/historial', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { limite, estado } = zod_1.z.object({
        limite: zod_1.z.coerce.number().int().max(100).default(50),
        estado: zod_1.z.enum(['ENTREGADA', 'FALLIDA', 'PENDIENTE', 'IGNORADA']).optional(),
    }).parse(req.query);
    const cond = estado ? `AND mxm_estado='${estado}'` : '';
    const rows = await require('../config/database').query(`SELECT id,usuario_id,titulo,tipo_mxm,canal_mxm,validez_legal,mxm_notif_id,mxm_estado,http_status,error_msg,enviado_en FROM mxm_notif_envios WHERE 1=1 ${cond} ORDER BY creado_en DESC LIMIT $1`, [limite]);
    res.json({ ok: true, data: rows, total: rows.length });
});
// POST /admin/mxm/canal/reintentar — reintentar envíos fallidos
r.post('/admin/mxm/canal/reintentar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    // Marcar como PENDIENTE para que procesarColaMxM los reintente
    const result = await require('../config/database').query(`UPDATE mxm_notif_envios SET mxm_estado='PENDIENTE'
     WHERE mxm_estado='FALLIDA' AND intentos<4
     RETURNING id`, []);
    res.json({ ok: true, data: { reintentados: result.length } });
});
// GET /mxm/canal/mis-notificaciones — notificaciones del usuario (con estado MxM)
r.get('/mxm/canal/mis-notificaciones', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { limite } = zod_1.z.object({ limite: zod_1.z.coerce.number().int().max(50).default(20) }).parse(req.query);
    const rows = await require('../config/database').query(`SELECT n.id,n.tipo,n.titulo,n.cuerpo,n.leida,n.creado_en,
            e.mxm_notif_id,e.mxm_estado,e.enviado_en AS mxm_enviado_en
     FROM notificaciones n
     LEFT JOIN mxm_notif_envios e ON e.notificacion_id=n.id
     WHERE n.usuario_id=$1
     ORDER BY n.creado_en DESC LIMIT $2`, [req.user.sub, limite]);
    res.json({ ok: true, data: rows, total: rows.length });
});
// ══════════════════════════════════════════════════════════
// CIT TRIGGERS — Notificaciones automáticas
// ══════════════════════════════════════════════════════════
// POST /admin/triggers/cit-aprobado — disparar manualmente (testing)
r.post('/admin/triggers/cit-aprobado', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        citId: zod_1.z.string().uuid(),
        usuarioId: zod_1.z.string().uuid(),
        numeroCIT: zod_1.z.string().default('RCIT-TEST-001'),
        serial: zod_1.z.string().default('SN-TEST-001'),
        marca: zod_1.z.string().default('Trek'),
        modelo: zod_1.z.string().default('Marlin'),
        txHash: zod_1.z.string().default('0x' + 'a'.repeat(64)),
    }).parse(req.body);
    (0, cit_triggers_service_1.triggerCITAprobado)(body);
    res.json({ ok: true, message: 'Trigger CITAprobado disparado (fire-and-forget)' });
});
// POST /admin/triggers/cit-rechazado
r.post('/admin/triggers/cit-rechazado', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        citId: zod_1.z.string().uuid(),
        usuarioId: zod_1.z.string().uuid(),
        numeroCIT: zod_1.z.string().default('RCIT-TEST-001'),
        serial: zod_1.z.string().default('SN-TEST-001'),
        marca: zod_1.z.string().default('Trek'),
        modelo: zod_1.z.string().default('Marlin'),
        motivoRechazo: zod_1.z.string().default('Alerta del Ministerio de Seguridad'),
        alertaMinSeg: zod_1.z.boolean().default(false),
    }).parse(req.body);
    (0, cit_triggers_service_1.triggerCITRechazado)(body);
    res.json({ ok: true, message: 'Trigger CITRechazado disparado' });
});
// POST /admin/triggers/alerta-robo
r.post('/admin/triggers/alerta-robo', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        citId: zod_1.z.string().uuid(),
        usuarioId: zod_1.z.string().uuid(),
        serial: zod_1.z.string(),
        marca: zod_1.z.string(),
        modelo: zod_1.z.string(),
        numeroDenuncia: zod_1.z.string(),
        provincia: zod_1.z.string().optional(),
        localidad: zod_1.z.string().optional(),
    }).parse(req.body);
    (0, cit_triggers_service_1.triggerAlertaRobo)(body);
    res.json({ ok: true, message: 'Trigger AlertaRobo disparado' });
});
// POST /admin/triggers/vencimientos — cron diario
r.post('/admin/triggers/vencimientos', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const result = await (0, cit_triggers_service_1.procesarVencimientosProximos)();
    res.json({ ok: true, data: result });
});
// POST /admin/triggers/marcar-vencidos — marcar CITs expirados
r.post('/admin/triggers/marcar-vencidos', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const count = await (0, cit_triggers_service_1.marcarCITsVencidos)();
    res.json({ ok: true, data: { marcados: count } });
});
// GET /admin/triggers/cits-vencidos — listar CITs activos pero vencidos
r.get('/admin/triggers/cits-vencidos', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, cit_triggers_service_1.getCITsVencidos)() });
});
// GET /cit/:id/alertas — historial de alertas de vencimiento enviadas
r.get('/cit/:id/alertas', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    res.json({ ok: true, data: await (0, cit_triggers_service_1.getAlertasVencimiento)(req.params.id) });
});
// ══════════════════════════════════════════════════════════
// DEVICE TOKENS — Gestión unificada (FCM + APNs)
// ══════════════════════════════════════════════════════════
// POST /usuarios/device-token — registrar token (cualquier proveedor)
r.post('/usuarios/device-token', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        token: zod_1.z.string().min(10),
        proveedor: zod_1.z.enum(['FCM', 'APNS']),
        plataforma: zod_1.z.enum(['WEB', 'ANDROID', 'IOS']),
        dispositivo: zod_1.z.string().max(200).optional(),
        appVersion: zod_1.z.string().max(20).optional(),
        locale: zod_1.z.string().max(10).optional(),
        apnsEnv: zod_1.z.enum(['sandbox', 'production']).optional(),
        bundleId: zod_1.z.string().max(100).optional(),
    }).parse(req.body);
    const result = await (0, device_token_service_1.registrarDeviceToken)({ usuarioId: req.user.sub, ...body });
    res.status(result.nuevo ? 201 : 200).json({ ok: true, data: result,
        message: result.nuevo ? 'Token registrado' : 'Token actualizado',
    });
});
// DELETE /usuarios/device-token — desactivar un token (logout de dispositivo)
r.delete('/usuarios/device-token', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { token } = zod_1.z.object({ token: zod_1.z.string().min(10) }).parse(req.body);
    const ok = await (0, device_token_service_1.desactivarToken)(token, req.user.sub, 'LOGOUT');
    res.json({ ok: true, data: { desactivado: ok } });
});
// DELETE /usuarios/device-tokens — logout completo (desactivar todos)
r.delete('/usuarios/device-tokens', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const count = await (0, device_token_service_1.desactivarTodosLosTokens)(req.user.sub, 'LOGOUT');
    res.json({ ok: true, data: { desactivados: count },
        message: `${count} token(s) desactivados. Necesitarás registrarte de nuevo en cada dispositivo.`
    });
});
// GET /usuarios/device-tokens — listar tokens del usuario
r.get('/usuarios/device-tokens', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { soloActivos } = zod_1.z.object({ soloActivos: zod_1.z.coerce.boolean().default(true) }).parse(req.query);
    const tokens = await (0, device_token_service_1.getTokensUsuario)(req.user.sub, { soloActivos });
    // No exponer el token raw — solo metadata
    const safe = tokens.map(({ token: _, ...t }) => ({
        ...t,
        tokenPreview: _.slice(0, 8) + '...' + _.slice(-4),
    }));
    res.json({ ok: true, data: safe, total: safe.length });
});
// POST /usuarios/device-token/rotar — FCM token refresh
r.post('/usuarios/device-token/rotar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        tokenViejo: zod_1.z.string().min(10),
        tokenNuevo: zod_1.z.string().min(10),
        plataforma: zod_1.z.enum(['WEB', 'ANDROID', 'IOS']),
        proveedor: zod_1.z.enum(['FCM', 'APNS']).default('FCM'),
        dispositivo: zod_1.z.string().max(200).optional(),
        appVersion: zod_1.z.string().max(20).optional(),
    }).parse(req.body);
    const result = await (0, device_token_service_1.rotarToken)({ usuarioId: req.user.sub, ...body });
    res.json({ ok: true, data: result });
});
// Admin: enviar push a un usuario
r.post('/admin/device-tokens/push', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        usuarioId: zod_1.z.string().uuid(),
        titulo: zod_1.z.string(),
        cuerpo: zod_1.z.string(),
        plataformas: zod_1.z.array(zod_1.z.enum(['WEB', 'ANDROID', 'IOS'])).optional(),
        badge: zod_1.z.coerce.number().int().optional(),
        datos: zod_1.z.record(zod_1.z.string()).optional(),
    }).parse(req.body);
    const { usuarioId, titulo, cuerpo, plataformas, badge, datos } = body;
    const result = await (0, device_token_service_1.enviarPush)(usuarioId, { titulo, cuerpo, badge, datos }, { plataformas });
    res.json({ ok: true, data: result });
});
// Admin: batch push a múltiples usuarios
r.post('/admin/device-tokens/push-batch', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        usuarioIds: zod_1.z.array(zod_1.z.string().uuid()).min(1).max(500),
        titulo: zod_1.z.string(),
        cuerpo: zod_1.z.string(),
        plataformas: zod_1.z.array(zod_1.z.enum(['WEB', 'ANDROID', 'IOS'])).optional(),
        concurrencia: zod_1.z.coerce.number().int().min(1).max(50).default(10),
    }).parse(req.body);
    const result = await (0, device_token_service_1.enviarPushMultiple)(body.usuarioIds, { titulo: body.titulo, cuerpo: body.cuerpo }, { plataformas: body.plataformas, concurrencia: body.concurrencia });
    res.json({ ok: true, data: result });
});
// Admin: estadísticas de device tokens
r.get('/admin/device-tokens/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, device_token_service_1.getEstadisticas)() });
});
// Admin: limpieza de tokens inactivos
r.post('/admin/device-tokens/limpiar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().min(7).max(365).default(90) }).parse(req.body);
    res.json({ ok: true, data: await (0, device_token_service_1.limpiarTokensInactivos)(dias) });
});
// ══════════════════════════════════════════════════════════
// APNs — Apple Push Notifications (iOS nativo)
// ══════════════════════════════════════════════════════════
// POST /usuarios/apns-token — registrar token APNs nativo (app iOS sin Firebase)
r.post('/usuarios/apns-token', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        deviceToken: zod_1.z.string().min(64).max(200),
        entorno: zod_1.z.enum(['sandbox', 'production']).default('sandbox'),
        bundleId: zod_1.z.string().max(100).optional(),
        dispositivo: zod_1.z.string().max(200).optional(),
        appVersion: zod_1.z.string().max(20).optional(),
    }).parse(req.body);
    const result = await (0, apns_service_1.registrarTokenAPNs)({ usuarioId: req.user.sub, ...body });
    res.status(result.nuevo ? 201 : 200).json({ ok: true, data: result,
        message: result.nuevo ? 'Token APNs registrado' : 'Token APNs actualizado',
    });
});
// GET /admin/apns/estado — estado del servicio APNs
r.get('/admin/apns/estado', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: {
            modo: (0, apns_service_1.getModoAPNs)(),
            entorno: (0, apns_service_1.getApnsEnv)(),
            bundleId: (0, apns_service_1.getBundleId)(),
            credenciales: {
                APNS_KEY_ID: !!process.env.APNS_KEY_ID,
                APNS_TEAM_ID: !!process.env.APNS_TEAM_ID,
                APNS_PRIVATE_KEY: !!process.env.APNS_PRIVATE_KEY,
                APNS_BUNDLE_ID: !!process.env.APNS_BUNDLE_ID,
            },
        } });
});
// POST /admin/apns/push-test — enviar push de prueba iOS
r.post('/admin/apns/push-test', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        deviceToken: zod_1.z.string().min(64),
        tipo: zod_1.z.enum(['alert', 'background', 'cit', 'denuncia', 'venta']).default('alert'),
        titulo: zod_1.z.string().optional(),
        cuerpo: zod_1.z.string().optional(),
        entorno: zod_1.z.enum(['sandbox', 'production']).default('sandbox'),
    }).parse(req.body);
    let payload;
    switch (body.tipo) {
        case 'cit':
            payload = (0, apns_service_1.payloadCITEmitido)('RCIT-TEST-001', 'Trek', 'Marlin');
            break;
        case 'denuncia':
            payload = (0, apns_service_1.payloadDenunciaRobo)('SN-TEST-XXXX', 'DEN-2026-001');
            break;
        case 'background':
            payload = (0, apns_service_1.payloadBackground)('SYNC', { ts: Date.now() });
            break;
        case 'venta':
            payload = (0, apns_service_1.payloadVenta)('Trek', 'Marlin', 370500);
            break;
        default:
            payload = { titulo: body.titulo ?? 'RODAID Test', cuerpo: body.cuerpo ?? 'Notificación de prueba APNs.', badge: 1, sound: 'default' };
    }
    const result = await (0, apns_service_1.enviarAPNsToken)(body.deviceToken, payload, {
        entorno: body.entorno,
    });
    res.json({ ok: true, data: result, modo: (0, apns_service_1.getModoAPNs)() });
});
// GET /admin/apns/estadisticas
r.get('/admin/apns/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    const stats = await (0, apns_service_1.getEstadisticasAPNs)(dias);
    res.json({ ok: true, data: { ...stats, modo: (0, apns_service_1.getModoAPNs)(), entorno: (0, apns_service_1.getApnsEnv)() } });
});
// ══════════════════════════════════════════════════════════
// FCM — Firebase Cloud Messaging (Push Notifications)
// ══════════════════════════════════════════════════════════
// MxM CIRCUIT BREAKER — Fallback y health monitoring
// ══════════════════════════════════════════════════════════
// GET /mxm/health — estado del circuit breaker (público — frontend lo necesita sin auth)
r.get('/mxm/health', rateLimiter_1.burstRateLimit, async (_req, res) => {
    const circuito = await (0, mxm_circuit_service_1.getEstadoCircuito)();
    res.set('Cache-Control', 'no-cache, no-store');
    res.set('X-MxM-Circuit', circuito.estado);
    res.set('X-MxM-Health', circuito.health);
    res.json({ ok: true, data: {
            estado: circuito.estado,
            health: circuito.health,
            mxmDisponible: circuito.estado !== 'OPEN',
            fallbackActivo: circuito.estado === 'OPEN',
            latenciaMs: circuito.latenciaMs,
            abiertoDesdeSec: circuito.abiertoDesdeSec,
            features: {
                login: circuito.estado !== 'OPEN',
                tokenRefresh: circuito.estado !== 'OPEN',
                notificaciones: circuito.estado !== 'OPEN' && circuito.health !== 'DEGRADED',
                tramites: circuito.estado !== 'OPEN' && circuito.health !== 'DEGRADED',
                pagos: circuito.estado === 'CLOSED' && circuito.health === 'UP',
                identidad: true, // siempre disponible (cache DB)
            },
        } });
});
// GET /mxm/health/feature/:feature — disponibilidad de una feature específica
r.get('/mxm/health/feature/:feature', rateLimiter_1.burstRateLimit, async (req, res) => {
    const feature = req.params.feature.toUpperCase();
    const validos = ['LOGIN', 'TOKEN_REFRESH', 'NOTIFICACIONES', 'TRAMITES', 'PAGOS', 'IDENTIDAD', 'WEBHOOK'];
    if (!validos.includes(feature)) {
        res.status(400).json({ ok: false, error: 'Feature inválida' });
        return;
    }
    const result = await (0, mxm_circuit_service_1.featureDisponible)(feature);
    res.json({ ok: true, data: result });
});
// POST /mxm/token/extender-fallback — extender token cuando MxM está caído
r.post('/mxm/token/extender-fallback', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { disponible } = await (0, mxm_circuit_service_1.featureDisponible)('TOKEN_REFRESH');
    if (disponible) {
        res.status(400).json({ ok: false, error: 'MxM está disponible — usá /mxm/token/renovar', code: 'MXM_AVAILABLE' });
        return;
    }
    const result = await (0, mxm_circuit_service_1.extenderTokenExistente)(req.user.sub);
    res.json({ ok: true, data: result,
        message: result.extendido
            ? `Token extendido hasta ${result.nuevaExpiracion?.toLocaleString('es-AR')}. MxM no disponible temporalmente.`
            : 'No se pudo extender el token — reconectá tu cuenta MxM',
    });
});
// Admin: ejecutar health check manual
r.post('/admin/mxm/health/check', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const result = await (0, mxm_circuit_service_1.checkHealthMxM)();
    const circuito = await (0, mxm_circuit_service_1.getEstadoCircuito)();
    res.json({ ok: true, data: { health: result, circuito } });
});
// Admin: historial de health checks
r.get('/admin/mxm/health/historial', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { limite } = zod_1.z.object({ limite: zod_1.z.coerce.number().int().max(200).default(50) }).parse(req.query);
    res.json({ ok: true, data: await (0, mxm_circuit_service_1.getHealthHistory)(limite) });
});
// Admin: estadísticas de uptime
r.get('/admin/mxm/health/uptime', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { horas } = zod_1.z.object({ horas: zod_1.z.coerce.number().int().max(720).default(24) }).parse(req.query);
    res.json({ ok: true, data: await (0, mxm_circuit_service_1.getUptimeStats)(horas) });
});
// Admin: reset manual del circuit breaker
r.post('/admin/mxm/circuit/reset', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    await (0, mxm_circuit_service_1.registrarExito)();
    res.json({ ok: true, data: { reseteado: true }, message: 'Circuit breaker reseteado a CLOSED' });
});
// Admin: abrir circuit manualmente (para mantenimiento programado)
r.post('/admin/mxm/circuit/abrir', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { motivo } = zod_1.z.object({ motivo: zod_1.z.string().min(5) }).parse(req.body);
    await (0, mxm_circuit_service_1.registrarFallo)(`Apertura manual: ${motivo}`, 'admin');
    await (0, mxm_circuit_service_1.registrarFallo)(`Apertura manual: ${motivo}`, 'admin');
    await (0, mxm_circuit_service_1.registrarFallo)(`Apertura manual: ${motivo}`, 'admin'); // 3 fallos → OPEN
    res.json({ ok: true, data: { abierto: true }, message: 'Circuit abierto manualmente — fallback activo' });
});
// ══════════════════════════════════════════════════════════
// MxM TOKEN REFRESH — Renovación automática
// ══════════════════════════════════════════════════════════
// GET /mxm/token/estado — estado del token del usuario actual
r.get('/mxm/token/estado', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const result = await (0, mxm_token_refresh_service_1.getAccessTokenConRenovacion)(req.user.sub);
    // No exponer el token — solo el estado
    res.set('X-MxM-Token-Origen', result.origen);
    res.set('X-MxM-Renovado', result.renovado ? '1' : '0');
    res.json({ ok: true, data: {
            tieneToken: !!result.token,
            origen: result.origen,
            renovado: result.renovado,
            expiraEn: result.expiraEn,
            minutosRestantes: result.expiraEn
                ? Math.max(0, Math.round((result.expiraEn.getTime() - Date.now()) / 60_000))
                : null,
        } });
});
// POST /mxm/token/renovar — forzar renovación del token del usuario
r.post('/mxm/token/renovar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    // Invalidar cache Redis para forzar refresh real
    const { getRedis } = await import('../config/redis');
    const redis = getRedis();
    await redis.del('mxm:access_token:' + req.user.sub);
    const result = await (0, mxm_token_refresh_service_1.getAccessTokenConRenovacion)(req.user.sub);
    res.json({ ok: true, data: {
            renovado: result.renovado,
            tieneToken: !!result.token,
            origen: result.origen,
        }, message: result.renovado
            ? '✓ Token MxM renovado exitosamente'
            : !!result.token
                ? 'Token aún vigente — no era necesario renovar'
                : '⚠ Sin token disponible — reconectá tu cuenta MxM',
    });
});
// GET /mxm/token/historial — historial de renovaciones del usuario
r.get('/mxm/token/historial', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const historial = await (0, mxm_token_refresh_service_1.getHistorialRenovaciones)(req.user.sub);
    res.json({ ok: true, data: historial });
});
// POST /mxm/token/invalidar — desconectar y limpiar tokens (logout MxM)
r.post('/mxm/token/invalidar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { motivo } = zod_1.z.object({ motivo: zod_1.z.string().max(200).optional() }).parse(req.body);
    await (0, mxm_token_refresh_service_1.invalidarToken)(req.user.sub, motivo ?? 'Solicitud del usuario');
    res.json({ ok: true, data: { invalidado: true },
        message: 'Token MxM invalidado. Reconectá tu cuenta MxM cuando lo necesites.' });
});
// Admin: estado de todos los tokens
r.get('/admin/mxm/tokens/estado', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, mxm_token_refresh_service_1.getEstadoTokens)() });
});
// Admin: estadísticas de renovaciones
r.get('/admin/mxm/tokens/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { horas } = zod_1.z.object({ horas: zod_1.z.coerce.number().int().min(1).max(168).default(24) }).parse(req.query);
    res.json({ ok: true, data: await (0, mxm_token_refresh_service_1.getEstadisticasRenovaciones)(horas) });
});
// Admin: procesar renovaciones proactivas
r.post('/admin/mxm/tokens/renovar-proximos', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { buffer } = zod_1.z.object({ buffer: zod_1.z.coerce.number().int().min(5).max(60).default(15) }).parse(req.body);
    const result = await (0, mxm_token_refresh_service_1.renovarTokensProximos)({ bufferMinutos: buffer });
    res.json({ ok: true, data: result,
        message: `${result.renovados} token(s) renovados de ${result.procesados} procesados`
    });
});
// Admin: invalidar token de un usuario específico
r.post('/admin/mxm/tokens/invalidar/:userId', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { motivo } = zod_1.z.object({ motivo: zod_1.z.string().optional() }).parse(req.body);
    await (0, mxm_token_refresh_service_1.invalidarToken)(req.params.userId, motivo ?? 'Invalidado por admin');
    res.json({ ok: true, data: { invalidado: true } });
});
// ══════════════════════════════════════════════════════════
// MxM TRÁMITES — Expediente CIT en sistema provincial
// ══════════════════════════════════════════════════════════
// POST /mxm/tramites — crear expediente CIT en el sistema provincial
r.post('/mxm/tramites', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        citId: zod_1.z.string().uuid(),
        tipoTramite: zod_1.z.enum(['REGISTRO_CIT', 'TRANSFERENCIA_CIT', 'BAJA_CIT', 'DENUNCIA_ROBO', 'ACTUALIZACION']).default('REGISTRO_CIT'),
        descripcion: zod_1.z.string().max(2000).optional(),
        leyRef: zod_1.z.string().max(20).optional(),
        datosExtra: zod_1.z.record(zod_1.z.unknown()).optional(),
    }).parse(req.body);
    const result = await (0, mxm_tramites_service_1.crearTramite)({
        usuarioId: req.user.sub,
        citId: body.citId,
        tipoTramite: body.tipoTramite,
        descripcion: body.descripcion,
        leyRef: body.leyRef,
        datosExtra: body.datosExtra,
    });
    res.status(201).json({ ok: true, data: result });
});
// GET /mxm/tramites/mis-tramites — historial del usuario
r.get('/mxm/tramites/mis-tramites', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const tramites = await (0, mxm_tramites_service_1.getTramitesUsuario)(req.user.sub);
    res.json({ ok: true, data: tramites, total: tramites.length });
});
// GET /mxm/tramites/cit/:citId — expediente de un CIT
r.get('/mxm/tramites/cit/:citId', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const tramite = await (0, mxm_tramites_service_1.getTramitePorCIT)(req.params.citId);
    res.json({ ok: true, data: tramite ?? null });
});
// GET /mxm/tramites/:id — detalle del trámite
r.get('/mxm/tramites/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const tramite = await (0, mxm_tramites_service_1.getTramite)(req.params.id);
    if (!tramite) {
        res.status(404).json({ ok: false, error: 'Trámite no encontrado' });
        return;
    }
    if (tramite.usuarioId !== req.user.sub && req.user.rol !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    res.json({ ok: true, data: tramite });
});
// GET /mxm/tramites/:id/historial
r.get('/mxm/tramites/:id/historial', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const tramite = await (0, mxm_tramites_service_1.getTramite)(req.params.id);
    if (!tramite) {
        res.status(404).json({ ok: false, error: 'No encontrado' });
        return;
    }
    if (tramite.usuarioId !== req.user.sub && req.user.rol !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    const historial = await (0, mxm_tramites_service_1.getHistorialTramite)(req.params.id);
    res.json({ ok: true, data: historial });
});
// POST /mxm/tramites/webhook — MxM notifica cambio de estado
r.post('/mxm/tramites/webhook', (req, res, next) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
        req.rawBody = raw;
        try {
            req.body = JSON.parse(raw || '{}');
        }
        catch {
            req.body = {};
        }
        next();
    });
}, async (req, res) => {
    res.status(200).send('OK');
    await (0, mxm_tramites_service_1.procesarWebhookTramite)({
        rawBody: req.rawBody ?? '',
        xSignature: req.headers['x-mxm-signature'] ?? null,
        payload: req.body,
    });
});
// POST /mxm/tramites/stub/avanzar — simular avance de estado (solo STUB)
r.post('/mxm/tramites/stub/avanzar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { tramiteId } = zod_1.z.object({ tramiteId: zod_1.z.string().uuid() }).parse(req.body);
    const tramite = await (0, mxm_tramites_service_1.getTramite)(tramiteId);
    if (!tramite) {
        res.status(404).json({ ok: false, error: 'No encontrado' });
        return;
    }
    if (tramite.usuarioId !== req.user.sub) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    const result = await (0, mxm_tramites_service_1.stubAvanzarEstado)(tramiteId);
    res.json({ ok: true, data: result });
});
// Admin: estadísticas
r.get('/admin/mxm/tramites/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, mxm_tramites_service_1.getEstadisticasTramites)(dias) });
});
// Admin: ver todos los trámites de un CIT (con detalle)
r.get('/admin/mxm/tramites/cit/:citId', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const t = await (0, mxm_tramites_service_1.getTramitePorCIT)(req.params.citId);
    res.json({ ok: true, data: t ?? null });
});
// ══════════════════════════════════════════════════════════
// MxM NOTIFICACIONES — Canal gubernamental
// ══════════════════════════════════════════════════════════
// POST /mxm/notificaciones — enviar notificación MxM al usuario autenticado
// (o a otro usuario si es admin)
r.post('/mxm/notificaciones', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        usuarioId: zod_1.z.string().uuid().optional(), // admin puede enviar a otro
        tipo: zod_1.z.enum([
            'CIT_APROBADO', 'CIT_RECHAZADO', 'CIT_POR_VENCER',
            'TASA_CONFIRMADA', 'PAGO_RECHAZADO',
            'DENUNCIA_REGISTRADA', 'BICI_RECUPERADA',
            'NUEVA_OFERTA', 'VENTA_CONFIRMADA', 'COMPRA_COMPLETADA',
            'NFT_TRANSFERIDO', 'DISPUTA_ABIERTA', 'DISPUTA_RESUELTA', 'SISTEMA_GENERAL',
        ]).default('SISTEMA_GENERAL'),
        titulo: zod_1.z.string().min(5).max(200),
        cuerpo: zod_1.z.string().min(10).max(2000),
        tipoMxM: zod_1.z.enum(['INFORMATIVA', 'ACCION_REQUERIDA', 'URGENTE', 'LEGAL']).default('INFORMATIVA'),
        canalMxM: zod_1.z.enum(['push_email', 'push', 'email', 'sms']).default('push_email'),
        validezLegal: zod_1.z.boolean().default(false),
        datos: zod_1.z.record(zod_1.z.unknown()).optional(),
        enviarMxM: zod_1.z.boolean().default(true),
    }).parse(req.body);
    // Solo admin puede especificar otro usuarioId
    const targetId = (req.user.rol === 'ADMIN' && body.usuarioId)
        ? body.usuarioId
        : req.user.sub;
    const result = await (0, mxm_notificaciones_service_1.notificarCiudadano)({
        usuarioId: targetId,
        tipo: body.tipo,
        titulo: body.titulo,
        cuerpo: body.cuerpo,
        tipoMxM: body.tipoMxM,
        canalMxM: body.canalMxM,
        validezLegal: body.validezLegal,
        datos: body.datos,
        enviarMxM: body.enviarMxM,
    });
    res.status(201).json({ ok: true, data: result,
        message: result.enviada
            ? '✓ Notificación enviada via MxM'
            : result.esStub
                ? '⚠ STUB: notificación simulada (configurar MXM_NOTIF_URL)'
                : '📥 Notificación guardada — se enviará cuando MxM esté disponible',
    });
});
// GET /mxm/notificaciones — mis notificaciones (alias amigable)
r.get('/mxm/notificaciones', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const q = zod_1.z.object({
        soloNoLeidas: zod_1.z.coerce.boolean().default(false),
        limite: zod_1.z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    const notifs = await (0, mxm_notificaciones_service_1.getNotificacionesUsuario)(req.user.sub, q);
    res.json({ ok: true, data: notifs, total: notifs.length });
});
// PATCH /mxm/notificaciones/:id/leer
r.patch('/mxm/notificaciones/:id/leer', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const ok = await (0, mxm_notificaciones_service_1.marcarLeida)(req.params.id, req.user.sub);
    res.json({ ok, data: { leida: ok } });
});
// PATCH /mxm/notificaciones/leer-todas
r.patch('/mxm/notificaciones/leer-todas', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const count = await (0, mxm_notificaciones_service_1.marcarTodasLeidas)(req.user.sub);
    res.json({ ok: true, data: { marcadas: count } });
});
// Admin: enviar a usuario específico (bulk o individual)
r.post('/admin/mxm/notificaciones/broadcast', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        usuariosIds: zod_1.z.array(zod_1.z.string().uuid()).min(1).max(100),
        titulo: zod_1.z.string().min(5).max(200),
        cuerpo: zod_1.z.string().min(10).max(2000),
        tipoMxM: zod_1.z.enum(['INFORMATIVA', 'ACCION_REQUERIDA', 'URGENTE', 'LEGAL']).default('INFORMATIVA'),
        urgente: zod_1.z.boolean().default(false),
    }).parse(req.body);
    const results = await Promise.allSettled(body.usuariosIds.map(uid => (0, mxm_notificaciones_service_1.notifSistema)({
        usuarioId: uid,
        titulo: body.titulo,
        cuerpo: body.cuerpo,
        urgente: body.urgente,
    })));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    res.json({ ok: true, data: { enviadas: ok, total: body.usuariosIds.length } });
});
// Admin: procesar cola de envíos MxM
r.post('/admin/mxm/notificaciones/procesar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const result = await (0, mxm_notificaciones_service_1.procesarColaMxM)();
    res.json({ ok: true, data: result });
});
// Admin: estadísticas de la cola MxM
r.get('/admin/mxm/notificaciones/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, mxm_notificaciones_service_1.getEstadisticasMxM)(dias) });
});
// ══════════════════════════════════════════════════════════
// MxM PAGOS — Tasa CIT (Ley 9556)
// ══════════════════════════════════════════════════════════
// POST /mxm/pagos — iniciar pago de tasa CIT vía gateway MxM
r.post('/mxm/pagos', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        citId: zod_1.z.string().uuid().optional(),
        bicicletaId: zod_1.z.string().uuid().optional(),
        returnUrl: zod_1.z.string().url().optional(),
    }).parse(req.body);
    const result = await (0, mxm_pagos_service_1.iniciarPago)({
        usuarioId: req.user.sub,
        citId: body.citId,
        bicicletaId: body.bicicletaId,
        returnUrl: body.returnUrl,
    });
    res.status(201).json({ ok: true, data: result,
        message: result.esStub
            ? '⚠ STUB: usá POST /mxm/pagos/stub/confirmar para simular la confirmación.'
            : 'Pago iniciado. Redirigí al usuario al link de pago MxM.',
    });
});
// GET /mxm/pagos/calcular — preview de tasa antes de iniciar (sin autenticar)
r.get('/mxm/pagos/calcular', async (req, res) => {
    const { plan } = zod_1.z.object({ plan: zod_1.z.enum(['LIBRE', 'ESTANDAR', 'PREMIUM']).default('LIBRE') }).parse(req.query);
    res.json({ ok: true, data: (0, mxm_pagos_service_1.calcularTasa)(plan) });
});
// GET /mxm/pagos/:id — estado del pago
r.get('/mxm/pagos/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const pago = await (0, mp_sdk_service_1.getPago)(req.params.id);
    if (!pago) {
        res.status(404).json({ ok: false, error: 'Pago no encontrado' });
        return;
    }
    if (pago.usuarioId !== req.user.sub) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    res.json({ ok: true, data: pago });
});
// GET /mxm/pagos/mis-pagos — historial del usuario
r.get('/mxm/pagos/mis-pagos/list', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const pagos = await (0, mxm_pagos_service_1.getPagosUsuario)(req.user.sub);
    res.json({ ok: true, data: pagos });
});
// POST /mxm/pagos/webhook — MxM notifica el resultado del pago
r.post('/mxm/pagos/webhook', (req, res, next) => {
    // Capturar raw body para validar firma HMAC-SHA256
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
        req.rawBody = raw;
        try {
            req.body = JSON.parse(raw || '{}');
        }
        catch {
            req.body = {};
        }
        next();
    });
}, async (req, res) => {
    // MxM requiere 200 inmediato
    res.status(200).send('OK');
    await (0, mxm_pagos_service_1.procesarWebhookPago)({
        rawBody: req.rawBody ?? '',
        xSignature: req.headers['x-mxm-signature'] ?? req.headers['x-signature'] ?? null,
        payload: req.body,
    });
});
// POST /mxm/pagos/stub/confirmar — simular confirmación (solo STUB)
r.post('/mxm/pagos/stub/confirmar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { pagoId } = zod_1.z.object({ pagoId: zod_1.z.string().uuid() }).parse(req.body);
    const pago = await (0, mxm_pagos_service_1.getPago)(pagoId);
    if (!pago) {
        res.status(404).json({ ok: false, error: 'Pago no encontrado' });
        return;
    }
    if (pago.usuarioId !== req.user.sub) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    if (!pago.esStub && process.env.NODE_ENV === 'production') {
        res.status(400).json({ ok: false, error: 'Solo disponible en modo STUB' });
        return;
    }
    const result = await (0, mxm_pagos_service_1.stubConfirmarPago)(pagoId);
    res.json({ ok: true, data: result, message: 'STUB: tasa CIT confirmada' });
});
// Admin: estadísticas de pagos
r.get('/admin/mxm/pagos/estadisticas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, mxm_pagos_service_1.getEstadisticasPagos)(dias) });
});
// Admin: expirar pagos vencidos
r.post('/admin/mxm/pagos/expirar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const count = await (0, mxm_pagos_service_1.expirarPagosPendientes)();
    res.json({ ok: true, data: { expirados: count } });
});
// Admin: pagos de un CIT específico
r.get('/admin/mxm/pagos/cit/:citId', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    res.json({ ok: true, data: await (0, mxm_pagos_service_1.getPagosCIT)(req.params.citId) });
});
// ══════════════════════════════════════════════════════════
// MxM — Identidad y nivel de verificación
// ══════════════════════════════════════════════════════════
// GET /mxm/identidad — identidad completa del usuario autenticado
r.get('/mxm/identidad', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { refresh } = zod_1.z.object({ refresh: zod_1.z.coerce.boolean().default(false) }).parse(req.query);
    const identidad = await (0, mxm_identidad_service_1.getIdentidadMxM)(req.user.sub, { forzarRefresh: refresh });
    res.setHeader('X-MxM-Nivel', String(identidad.nivel));
    res.setHeader('X-MxM-Conectado', identidad.conectado ? '1' : '0');
    res.setHeader('X-Cache-Hit', identidad.token.origen === 'cache' ? '1' : '0');
    res.json({ ok: true, data: identidad });
});
// DELETE /mxm/identidad/cache — invalidar caché de identidad
r.delete('/mxm/identidad/cache', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    await (0, mxm_identidad_service_1.invalidarCache)(req.user.sub);
    res.json({ ok: true, data: { invalidado: true } });
});
// GET /mxm/nivel/:serial — nivel del propietario actual de un CIT (público, sin PII)
r.get('/mxm/nivel/:serial', rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const result = await (0, mxm_identidad_service_1.getNivelPorSerial)(req.params.serial);
    res.setHeader('X-MxM-Nivel', String(result.nivelPropietario));
    res.json({ ok: true, data: result });
});
// GET /admin/mxm/niveles — resumen de niveles de toda la plataforma
r.get('/admin/mxm/niveles', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const resumen = await (0, mxm_identidad_service_1.getResumenNivelesMxM)();
    res.json({ ok: true, data: resumen });
});
// GET /admin/mxm/identidad/:userId — identidad de cualquier usuario (admin)
r.get('/admin/mxm/identidad/:userId', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const identidad = await (0, mxm_identidad_service_1.getIdentidadMxM)(req.params.userId, { forzarRefresh: true });
    res.json({ ok: true, data: identidad });
});
// ══════════════════════════════════════════════════════════
// AUTH — Registro, Login, Tokens
// ══════════════════════════════════════════════════════════
// Público — sin JWT
r.post('/auth/register', rateLimiter_1.registerRateLimit, auth_controller_1.register);
r.get('/auth/verify-email', auth_controller_1.verifyEmail);
r.post('/auth/resend-verification', rateLimiter_1.registerRateLimit, auth_controller_1.resendVerification);
r.post('/auth/forgot-password', rateLimiter_1.loginRateLimit, auth_controller_1.forgotPassword);
r.post('/auth/reset-password', rateLimiter_1.loginRateLimit, auth_controller_1.resetPassword);
r.post('/auth/login', rateLimiter_1.loginRateLimit, auth_controller_1.login);
r.post('/auth/refresh', rateLimiter_1.refreshRateLimit, auth_controller_1.refresh);
r.post('/auth/logout', auth_controller_1.logout);
// OAuth MxM (Gobierno de Mendoza)
r.get('/auth/mxm', auth_controller_1.mxmAuthorize);
r.get('/auth/mxm/callback', auth_controller_1.mxmCallback);
// Autenticados
r.post('/auth/logout-all', ...auth_1.authenticated, rateLimiter_1.userRateLimit, auth_controller_1.logoutAll);
r.post('/auth/change-password', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('usuario:update:own'), auth_controller_1.changePassword);
r.get('/auth/password/history', ...auth_1.authenticated, rateLimiter_1.userRateLimit, auth_controller_1.passwordHistory);
r.get('/auth/me', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('usuario:read:own'), auth_controller_1.me);
r.get('/auth/mxm/status', ...auth_1.authenticated, rateLimiter_1.userRateLimit, auth_controller_1.mxmStatus);
r.post('/auth/mxm/desconectar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, auth_controller_1.mxmDesconectar);
r.get('/auth/mxm/audit', ...auth_1.authenticated, rateLimiter_1.userRateLimit, auth_controller_1.mxmAuditLog);
// ── 2FA — autenticación de dos factores ────────────────────
r.get('/auth/2fa/status', ...auth_1.authenticated, rateLimiter_1.userRateLimit, twofa_controller_1.twoFAStatus);
r.post('/auth/2fa/setup', ...auth_1.authenticated, rateLimiter_1.userRateLimit, twofa_controller_1.twoFASetup);
r.post('/auth/2fa/confirm', ...auth_1.authenticated, rateLimiter_1.userRateLimit, twofa_controller_1.twoFAConfirm);
r.post('/auth/2fa/validate', rateLimiter_1.loginRateLimit, twofa_controller_1.twoFAValidate);
r.delete('/auth/2fa', ...auth_1.authenticated, rateLimiter_1.userRateLimit, twofa_controller_1.twoFADisable);
r.post('/auth/2fa/backup/regenerate', ...auth_1.authenticated, rateLimiter_1.userRateLimit, twofa_controller_1.twoFARegenerateBackup);
// Gestión de sesiones
r.get('/auth/sessions', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getUserSessions } = await import('../services/session.service');
    const sessions = await getUserSessions(req.user.sub);
    res.json({ ok: true, data: sessions });
});
r.delete('/auth/sessions/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { revokeSessionById } = await import('../services/session.service');
    const revoked = await revokeSessionById(req.params.id, req.user.sub);
    res.json({ ok: revoked, data: { revoked, message: revoked ? 'Sesión cerrada' : 'No encontrada' } });
});
// ══════════════════════════════════════════════════════════
// CIT — Certificado de Identidad Técnica (Ley 9556)
// ══════════════════════════════════════════════════════════
// ── Verificador Público BFA ───────────────────────────────
// Consulta el índice on-chain — sin auth, sin rate limit de usuario
// Endpoint para tokenURI del contrato ERC-721 (acceso público sin auth)
r.get('/cit/metadata/:tokenId', async (req, res) => {
    const tokenId = parseInt(req.params.tokenId);
    if (isNaN(tokenId))
        return res.status(400).json({ error: 'tokenId inválido' });
    const row = await (await import('../config/database')).queryOne(`SELECT c.numero_cit, c.hash_sha256, c.ipfs_metadata_cid, c.token_uri,
            b.marca, b.modelo, b.anio, b.tipo::text, b.color, b.numero_serie AS serial,
            u.nombre||' '||u.apellido AS propietario,
            ui.nombre||' '||ui.apellido AS inspector,
            ta.nombre AS taller, c.puntos AS total_puntos, c.fecha_emision, c.bfa_tx_hash
     FROM cits c
     JOIN bicicletas b ON b.id=c.bicicleta_id
     JOIN usuarios u ON u.id=c.propietario_id
     JOIN inspectores i ON i.id=c.inspector_id
     JOIN usuarios ui ON ui.id=i.usuario_id
     JOIN talleres_aliados ta ON ta.id=c.taller_aliado_id
     WHERE c.nft_token_id=$1`, [tokenId]);
    if (!row)
        return res.status(404).json({ error: 'Token no encontrado' });
    // Retornar metadata ERC-721 directamente (sin wrapper ok:true)
    const { buildNFTMetadata } = await import('../services/ipfs.service');
    const meta = buildNFTMetadata({
        numeroCIT: row.numero_cit, serial: row.serial, hashSHA256: row.hash_sha256,
        marca: row.marca, modelo: row.modelo, anio: row.anio, tipo: row.tipo, color: row.color,
        propietarioNombre: row.propietario, inspectorNombre: row.inspector,
        tallerNombre: row.taller, tallerLocalidad: '', totalPuntos: row.total_puntos,
        fechaEmision: row.fecha_emision?.toISOString() ?? new Date().toISOString(),
        nftTokenId: tokenId, bfaTxHash: row.bfa_tx_hash ?? undefined,
    }, undefined, undefined);
    res.json(meta);
});
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// ADMIN: Fuentes tipográficas
// ══════════════════════════════════════════════════════════
// GET /admin/font/info — info sobre la fuente actualmente cargada
r.get('/admin/font/info', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const info = await (0, font_service_1.getFontInfo)();
    res.json({ ok: true, data: info });
});
// POST /admin/font/invalidar-cache — forzar recarga de fuentes
r.post('/admin/font/invalidar-cache', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (_req, res) => {
    (0, font_service_1.invalidarCacheFuentes)();
    res.json({ ok: true, data: { message: 'Caché de fuentes invalidado — próximo PDF usará fuente actualizada' } });
});
// QR CODE — /verificar/:serial
// ══════════════════════════════════════════════════════════
// GET /cit/:id/qr.png — QR como imagen PNG (embed en apps, email)
r.get('/cit/:id/qr.png', rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const { queryOne: qOne } = await import('../config/database');
    const row = await qOne(`SELECT b.numero_serie FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id WHERE c.id=$1`, [req.params.id]);
    if (!row) {
        res.status(404).json({ ok: false, error: 'CIT no encontrado' });
        return;
    }
    const qr = await (0, qr_service_1.generarQR)(row.numero_serie, {
        moduleSize: parseInt(String(req.query.size ?? '6')),
        errorCorrectionLevel: req.query.ecl ?? 'M',
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(qr.bufferPNG.length));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-QR-URL', qr.url);
    res.send(qr.bufferPNG);
});
// GET /cit/:id/qr.svg — QR vectorial (impresión de alta calidad)
r.get('/cit/:id/qr.svg', rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const { queryOne: qOne } = await import('../config/database');
    const row = await qOne(`SELECT b.numero_serie FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id WHERE c.id=$1`, [req.params.id]);
    if (!row) {
        res.status(404).json({ ok: false, error: 'CIT no encontrado' });
        return;
    }
    const qr = await (0, qr_service_1.generarQR)(row.numero_serie, { errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-QR-URL', qr.url);
    res.send(qr.svg);
});
// GET /qr/:serial — QR directo por serial (para apps externas)
r.get('/qr/:serial', rateLimiter_1.burstRateLimit, rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const serial = decodeURIComponent(req.params.serial).toUpperCase();
    const fmt = req.query.fmt ?? 'png';
    const qr = await (0, qr_service_1.generarQR)(serial);
    if (fmt === 'svg') {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(qr.svg);
    }
    else if (fmt === 'json') {
        res.json({ ok: true, data: { url: qr.url, dataUriPNG: qr.dataUriPNG, sizePx: qr.sizePx } });
    }
    else {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', String(qr.bufferPNG.length));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-QR-URL', qr.url);
        res.send(qr.bufferPNG);
    }
});
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// ADMIN: Gestión de IPs (bloqueos + whitelist)
// ══════════════════════════════════════════════════════════
r.get('/admin/ip/stats', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const stats = await (0, publicMiddleware_1.getIPStats)();
    res.json({ ok: true, data: stats });
});
r.post('/admin/ip/bloquear', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { ip, motivo, horas } = zod_1.z.object({
        ip: zod_1.z.string().min(7),
        motivo: zod_1.z.string().min(10),
        horas: zod_1.z.number().optional(),
    }).parse(req.body);
    await (0, publicMiddleware_1.bloquearIP)(ip, motivo, horas);
    res.json({ ok: true, data: { bloqueada: ip } });
});
r.delete('/admin/ip/bloquear/:ip', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    await (0, publicMiddleware_1.desbloquearIP)(decodeURIComponent(req.params.ip));
    res.json({ ok: true, data: { desbloqueada: req.params.ip } });
});
r.post('/admin/ip/whitelist', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { ipCidr, nombre } = zod_1.z.object({
        ipCidr: zod_1.z.string().min(7),
        nombre: zod_1.z.string().min(3),
    }).parse(req.body);
    await (0, publicMiddleware_1.agregarWhitelist)(ipCidr, nombre);
    res.json({ ok: true, data: { agregada: ipCidr, nombre } });
});
// VERIFICADOR PÚBLICO — GET /api/verificar/:serial
// ══════════════════════════════════════════════════════════
// GET /verificar/:serial — por número de serie de la bicicleta
r.use('/verificar', publicMiddleware_1.requestId, publicMiddleware_1.corsPublico, publicMiddleware_1.securityHeaders);
r.use('/verificar', publicMiddleware_1.checkIPReputacion);
r.get('/verificar/:serial', rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const serial = decodeURIComponent(req.params.serial).toUpperCase();
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] ?? req.ip;
    const userAgent = req.headers['user-agent'];
    const origen = String(req.query.origen ?? 'API').toUpperCase().slice(0, 10);
    const result = await (0, verificador_service_1.verificarSerial)(serial, ip, userAgent, origen);
    const httpCode = result.encontrado ? 200 : 404;
    res.status(httpCode).json({ ok: result.encontrado, data: result });
});
// GET /verificar/numero/:numeroCIT — por número de certificado (RCIT-2026-00049)
r.get('/verificar/numero/:numeroCIT', rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const numeroCIT = decodeURIComponent(req.params.numeroCIT).toUpperCase();
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] ?? req.ip;
    const result = await (0, verificador_service_1.verificarNumeroCIT)(numeroCIT, ip, req.headers['user-agent']);
    res.status(result.encontrado ? 200 : 404).json({ ok: result.encontrado, data: result });
});
// GET /verificar/codigo/:codigo — por código de verificación RODAID
r.get('/verificar/codigo/:codigo', rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const codigo = decodeURIComponent(req.params.codigo);
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] ?? req.ip;
    const result = await (0, verificador_service_1.verificarCodigo)(codigo, ip, req.headers['user-agent'], 'CODIGO');
    res.status(result.encontrado ? 200 : 404).json({ ok: result.encontrado, data: result });
});
// Admin: invalidar caché
r.delete('/admin/verificador/cache', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { serial, numeroCIT } = zod_1.z.object({ serial: zod_1.z.string().optional(), numeroCIT: zod_1.z.string().optional() }).parse(req.query);
    await (0, verificador_service_1.invalidarCacheVerificador)(serial, numeroCIT);
    res.json({ ok: true, data: { message: 'Caché del verificador invalidado' } });
});
// Admin: estadísticas de verificaciones
r.get('/admin/verificador/stats', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const dias = parseInt(String(req.query.dias ?? '7'));
    const stats = await (0, verificador_service_1.getVerificacionesStats)(dias);
    res.json({ ok: true, data: stats });
});
// SELLO TEMPORAL — RFC 3161 + Gobierno de Mendoza
// ══════════════════════════════════════════════════════════
// POST /cit/:id/sello — emitir sello temporal sobre el PDF del CIT
r.post('/cit/:id/sello', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const citId = req.params.id;
    const { cargarCITParaPDF, generarPDFPuppeteer } = await import('../services/pdf.puppeteer.service');
    const datos = await cargarCITParaPDF(citId);
    if (!datos) {
        res.status(404).json({ ok: false, error: 'CIT no encontrado' });
        return;
    }
    const pdfRes = await generarPDFPuppeteer(datos);
    const hash = require('crypto').createHash('sha256').update(pdfRes.buffer).digest('hex');
    const sello = await (0, sello_service_1.sellarDocumento)({ citId, numeroCIT: datos.numeroCIT,
        documentoHash: hash, pdfBuffer: pdfRes.buffer });
    res.json({ ok: true, data: sello });
});
// GET /cit/:id/sello — info del sello temporal (JSON)
r.get('/cit/:id/sello', ...auth_1.authenticated, async (req, res) => {
    const sello = await (0, sello_service_1.getSelloCIT)(req.params.id);
    if (!sello) {
        res.status(404).json({ ok: false, error: 'Sin sello temporal para este CIT' });
        return;
    }
    res.json({ ok: true, data: {
            selloId: sello.id,
            codigoVerif: sello.codigo_verif,
            selladoEn: sello.sellado_en,
            modo: sello.modo,
            tsaUrl: sello.tsa_url,
        } });
});
// GET /cit/:id/sello.tst — descargar el Time Stamp Token DER
r.get('/cit/:id/sello.tst', ...auth_1.authenticated, async (req, res) => {
    const sello = await (0, sello_service_1.getSelloCIT)(req.params.id);
    if (!sello?.tst_hex) {
        res.status(404).json({ ok: false, error: 'TST no disponible' });
        return;
    }
    const derBuf = Buffer.from(sello.tst_hex, 'hex');
    res.setHeader('Content-Type', 'application/timestamp-reply');
    res.setHeader('Content-Disposition', `attachment; filename="CIT-${req.params.id}.tst"`);
    res.setHeader('Content-Length', String(derBuf.length));
    res.send(derBuf);
});
// POST /verificar-sello — verificar PDF contra sello temporal (público)
r.post('/verificar-sello', publicMiddleware_1.requestId, publicMiddleware_1.corsPublico, publicMiddleware_1.securityHeaders, publicMiddleware_1.checkIPReputacion, rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const { pdfBase64, codigoVerif, citId } = zod_1.z.object({
        pdfBase64: zod_1.z.string().min(100),
        codigoVerif: zod_1.z.string().optional(),
        citId: zod_1.z.string().uuid().optional(),
    }).parse(req.body);
    const pdfBuf = Buffer.from(pdfBase64, 'base64');
    const result = await (0, sello_service_1.verificarSello)(pdfBuf, codigoVerif, citId);
    res.json({ ok: result.valida, data: result });
});
// GET /verificar/sello/:codigo — verificar por código de verificación (público)
r.get('/verificar/sello/:codigo', rateLimiter_1.burstRateLimit, rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const sello = await (0, sello_service_1.buscarPorCodigo)(decodeURIComponent(req.params.codigo));
    if (!sello) {
        res.status(404).json({ ok: false, error: 'Código de verificación no encontrado' });
        return;
    }
    res.json({ ok: true, data: {
            citId: sello.cit_id,
            codigoVerif: sello.codigo_verif,
            selladoEn: sello.sellado_en,
            modo: sello.modo,
            valido: true,
        } });
});
// FIRMA DIGITAL PKCS#7 DETACHED
// ══════════════════════════════════════════════════════════
// POST /cit/:id/firma — firmar el PDF del CIT
r.post('/cit/:id/firma', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const citId = req.params.id;
    // Cargar PDF actual del CIT
    const { cargarCITParaPDF, generarPDFPuppeteer } = await import('../services/pdf.puppeteer.service');
    const datos = await cargarCITParaPDF(citId);
    if (!datos) {
        res.status(404).json({ ok: false, error: 'CIT no encontrado' });
        return;
    }
    const pdfResult = await generarPDFPuppeteer(datos);
    const firma = await (0, firma_service_2.firmarPDF)(pdfResult.buffer, citId, datos.numeroCIT);
    res.json({
        ok: true,
        data: {
            firmaId: firma.firmaId,
            pdfHashSHA256: firma.pdfHashSHA256,
            certSerial: firma.certSerial,
            certSubject: firma.certSubject,
            firmadoEn: firma.firmadoEn,
            validaHasta: firma.validaHasta,
            bytes: firma.firmaDER.length,
            firmaBase64: firma.firmaBase64,
        },
    });
});
// GET /cit/:id/firma — descargar el archivo .p7s de la firma
r.get('/cit/:id/firma', ...auth_1.authenticated, async (req, res) => {
    const firma = await (0, firma_service_2.getFirmaCIT)(req.params.id);
    if (!firma) {
        res.status(404).json({ ok: false, error: 'Firma no encontrada para este CIT' });
        return;
    }
    const derBuf = Buffer.isBuffer(firma.firma_der) ? firma.firma_der : Buffer.from(firma.firma_hex, 'hex');
    res.setHeader('Content-Type', 'application/pkcs7-signature');
    res.setHeader('Content-Disposition', `attachment; filename="CIT-${req.params.id}.p7s"`);
    res.setHeader('Content-Length', String(derBuf.length));
    res.setHeader('X-PDF-Hash', firma.pdf_hash_sha256);
    res.setHeader('X-Cert-Serial', firma.cert_serial);
    res.send(derBuf);
});
// GET /cit/:id/firma/info — metadatos de la firma (JSON)
r.get('/cit/:id/firma/info', ...auth_1.authenticated, async (req, res) => {
    const firma = await (0, firma_service_2.getFirmaCIT)(req.params.id);
    if (!firma) {
        res.status(404).json({ ok: false, error: 'Firma no encontrada' });
        return;
    }
    res.json({ ok: true, data: {
            id: firma.id,
            pdfHash: firma.pdf_hash_sha256,
            certSerial: firma.cert_serial,
            certSubject: firma.cert_subject,
            firmadoEn: firma.firmado_en,
            validaHasta: firma.valida_hasta,
            revocada: firma.revocada,
            bytes: Buffer.isBuffer(firma.firma_der) ? firma.firma_der.length : firma.firma_hex.length / 2,
        } });
});
// POST /verificar-firma — verificar PDF + firma .p7s (público)
r.post('/verificar-firma', publicMiddleware_1.requestId, publicMiddleware_1.corsPublico, publicMiddleware_1.securityHeaders, publicMiddleware_1.checkIPReputacion, rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const { pdfBase64, firmaBase64 } = zod_1.z.object({
        pdfBase64: zod_1.z.string().min(100),
        firmaBase64: zod_1.z.string().min(100),
    }).parse(req.body);
    const pdfBuf = Buffer.from(pdfBase64, 'base64');
    const firmaBuf = Buffer.from(firmaBase64, 'base64');
    const result = await (0, firma_service_2.verificarFirmaPDF)(pdfBuf, firmaBuf);
    res.json({ ok: result.valida, data: result });
});
// Admin: Certificado activo
r.get('/admin/firma/cert', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const info = await (0, firma_service_2.getInfoCertActivo)();
    res.json({ ok: !!info, data: info });
});
// Admin: Rotar llaves (invalida todas las firmas)
r.post('/admin/firma/rotar-llaves', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const info = await (0, firma_service_2.rotarLlaves)();
    res.json({ ok: true, data: info, warning: 'Llaves rotadas — re-firmar todos los PDFs activos' });
});
// Admin: Revocar firma específica
r.delete('/admin/firma/:id', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { motivo } = zod_1.z.object({ motivo: zod_1.z.string().min(5) }).parse(req.body);
    const ok = await (0, firma_service_2.revocarFirma)(req.params.id, motivo);
    res.json({ ok, data: { revocada: ok } });
});
// PDF: Puppeteer (backend) + PDFKit fallback
// ══════════════════════════════════════════════════════════
// POST /cit/pdf — descarga autenticada con caché Redis
// Body: { citId, formato: 'attachment'|'inline'|'base64', regenerar?: bool }
r.post('/cit/pdf', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    await (0, pdf_controller_1.postCITPdf)(req, res);
});
// GET /cit/pdf/preview/:citId — HTML del CIT para preview en navegador
r.get('/cit/pdf/preview/:citId', ...auth_1.authenticated, async (req, res) => {
    await (0, pdf_controller_1.getCITPdfPreview)(req, res);
});
// Descargar PDF del CIT (public, sin auth, PDFKit — retrocompatibilidad)
r.get('/cit/pdf/:citId', async (req, res) => {
    const { queryOne } = await import('../config/database');
    const row = await queryOne(`SELECT c.numero_cit, c.hash_sha256, c.nft_token_id,
            b.marca, b.modelo, b.anio, b.tipo::text, b.color, b.numero_serie AS serial,
            u.nombre||' '||u.apellido AS propietario, u.dni AS propietario_dni,
            ui.nombre AS inspector, ui.apellido AS inspector_ap,
            ta.nombre AS taller, ta.localidad AS taller_loc,
            c.puntos AS total_puntos, c.fecha_emision, c.bfa_tx_hash,
            c.punto_detalle::text, c.fotos::text
     FROM cits c
     JOIN bicicletas b ON b.id=c.bicicleta_id
     JOIN usuarios u ON u.id=c.propietario_id
     JOIN inspectores i ON i.id=c.inspector_id
     JOIN usuarios ui ON ui.id=i.usuario_id
     JOIN talleres_aliados ta ON ta.id=c.taller_aliado_id
     WHERE c.id=$1`, [req.params.citId]);
    if (!row)
        return res.status(404).json({ error: 'CIT no encontrado' });
    const { generarPDFCIT } = await import('../services/pdf.service');
    const pdfBuffer = await generarPDFCIT({
        numeroCIT: row.numero_cit, hashSHA256: row.hash_sha256, serial: row.serial,
        marca: row.marca, modelo: row.modelo, anio: row.anio, tipo: row.tipo, color: row.color,
        propietarioNombre: row.propietario, propietarioDNI: row.propietario_dni,
        puntos: row.punto_detalle ? JSON.parse(row.punto_detalle) : {},
        totalPuntos: row.total_puntos,
        inspectorNombre: row.inspector, inspectorApellido: row.inspector_ap,
        tallerNombre: row.taller, tallerLocalidad: row.taller_loc,
        fechaEmision: row.fecha_emision?.toISOString() ?? new Date().toISOString(),
        nftTokenId: row.nft_token_id ?? undefined,
        bfaTxHash: row.bfa_tx_hash ?? undefined,
        fotosUrls: row.fotos ? JSON.parse(row.fotos) : [],
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="CIT-${row.numero_cit}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
});
r.get('/cit/verificar/:serial', rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const serial = decodeURIComponent(req.params.serial).toUpperCase();
    const bfaData = await (0, bfa_indexer_1.verificarPorSerial)(serial);
    // Complementar con datos de DB si existe CIT
    const dbData = await (await import('../services/cit.service')).verificarSerial(serial);
    res.json({ ok: true, data: { ...dbData, bfa: bfaData } });
});
r.get('/cit/verificar/hash/:hash', rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const hash = req.params.hash.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
        return res.status(400).json({ ok: false, error: { code: 'HASH_INVALIDO', message: 'Hash SHA-256 inválido (debe ser 64 chars hex)' } });
    }
    const result = await (0, bfa_indexer_1.verificarPorHash)(hash);
    res.json({ ok: true, data: result });
});
r.get('/cit/verificar/numero/:numeroCIT', rateLimiter_1.verificadorRateLimit, async (req, res) => {
    const result = await (0, bfa_indexer_1.verificarPorNumeroCIT)(decodeURIComponent(req.params.numeroCIT).toUpperCase());
    res.json({ ok: true, data: result });
});
// Ciclista — ver sus propios CITs
r.get('/cit/mis-cits', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('cit:read'), cit_controller_1.misCITsHandler);
// Inspector — emitir CIT (verifica además el perfil activo en DB)
// Pre-validación de serial (sin crear CIT — para que el inspector vea antes de ir al taller)
r.get('/cit/serial/validar', ...auth_1.onlyInspector, rateLimiter_1.inspectorCITRateLimit, cit_controller_1.prevalidarSerialHandler);
r.post('/cit/iniciar', ...auth_1.onlyInspector, rateLimiter_1.inspectorCITRateLimit, (0, auth_1.requirePermission)('cit:iniciar'), auth_1.requireInspectorProfile, cit_controller_1.iniciarCITHandler);
// Admin/Worker — validar y finalizar CIT
r.post('/cit/:id/validar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('cit:validar'), cit_controller_1.validarCITHandler);
r.post('/cit/:id/finalizar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('cit:finalizar'), cit_controller_1.finalizarCITHandler);
// Propietario — ver detalle y denunciar
r.get('/cit/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('cit:read'), cit_controller_1.getCITHandler);
r.post('/cit/:id/denunciar', ...auth_1.authenticated, rateLimiter_1.denunciaRateLimit, (0, auth_1.requirePermission)('cit:denunciar'), cit_controller_1.denunciarRoboHandler);
// ══════════════════════════════════════════════════════════
// MARKETPLACE
// ══════════════════════════════════════════════════════════
// Público — cualquiera puede navegar el marketplace
r.get('/marketplace/suggest', rateLimiter_1.verificadorRateLimit, marketplace_controller_1.suggest);
r.get('/marketplace', rateLimiter_1.verificadorRateLimit, marketplace_controller_1.buscar);
r.get('/marketplace/:id', rateLimiter_1.verificadorRateLimit, marketplace_controller_1.detalle);
// Autenticados — gestión de publicaciones y compras
r.get('/marketplace/mis-publicaciones', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('marketplace:read'), marketplace_controller_1.misPublicaciones);
r.post('/marketplace', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('marketplace:create'), marketplace_controller_1.publicar);
r.patch('/marketplace/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('marketplace:update'), marketplace_controller_1.editar);
r.patch('/marketplace/:id/pausar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('marketplace:update'), marketplace_controller_1.cambiarEstado);
r.post('/marketplace/:id/vender', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('marketplace:update'), marketplace_controller_1.vender);
r.post('/marketplace/:id/contactar', rateLimiter_1.verificadorRateLimit, rateLimiter_1.publicStrictRateLimit, marketplace_controller_1.contactar);
r.post('/marketplace/:id/comprar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('marketplace:comprar'), async (req, res) => {
    const body = zod_1.z.object({ returnUrl: zod_1.z.string().url().optional(), cancelUrl: zod_1.z.string().url().optional() }).parse(req.body);
    const result = await (0, escrow_service_1.iniciarCompra)({ publicacionId: req.params.id, compradorId: req.user.sub, ...body });
    res.status(201).json({ ok: true, data: result, message: 'Escrow iniciado. Realizá el pago en el link.' });
});
// ─── RODAID PAY: MercadoPago + Escrow ─────────────────────
// Webhook MP — raw body para firma HMAC-SHA256
r.post('/escrow/webhook/mp', (req, res, next) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
        ;
        req.rawBody = raw;
        try {
            req.body = JSON.parse(raw || '{}');
        }
        catch {
            req.body = {};
        }
        next();
    });
}, async (req, res) => {
    res.status(200).send('OK');
    const result = await (0, mercadopago_service_1.procesarWebhook)({
        payload: req.body,
        rawBody: req.rawBody ?? '',
        xSignature: req.headers['x-signature'] ?? null,
        xRequestId: req.headers['x-request-id'] ?? null,
    });
    if (result.accion !== 'IGNORAR' && result.transaccionId) {
        await (0, escrow_service_1.webhookPago)({
            transaccionId: result.transaccionId,
            paymentId: result.paymentId ?? '',
            status: result.accion === 'APROBAR' ? 'approved' : 'rejected',
            gateway: 'MERCADOPAGO',
        });
    }
});
// Simular depósito (STUB / SANDBOX)
r.post('/escrow/stub/pagar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { transaccionId } = zod_1.z.object({ transaccionId: zod_1.z.string().uuid() }).parse(req.body);
    if ((0, mercadopago_service_1.getModo)() === 'LIVE') {
        res.status(400).json({ ok: false, error: 'No disponible en modo LIVE' });
        return;
    }
    const tx = await (0, escrow_service_1.getTransaccion)(transaccionId);
    if (!tx || tx.compradorId !== req.user.sub) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    const result = await (0, escrow_service_1.simularDeposito)(transaccionId);
    res.json({ ok: true, data: result });
});
// Estado del pago (comprador/vendedor)
r.get('/escrow/pago/:txId/estado', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const tx = await (0, escrow_service_1.getTransaccion)(req.params.txId);
    if (!tx) {
        res.status(404).json({ ok: false, error: 'No encontrada' });
        return;
    }
    if (tx.compradorId !== req.user.sub && tx.vendedorId !== req.user.sub) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    const pagos = await (0, mercadopago_service_1.getPagosPorTransaccion)(req.params.txId);
    res.json({ ok: true, data: { transaccion: tx, pagos, modo: (0, mercadopago_service_1.getModo)() } });
});
// Refrescar estado desde MP
r.post('/escrow/pago/:txId/refrescar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const tx = await (0, escrow_service_1.getTransaccion)(req.params.txId);
    if (!tx || tx.compradorId !== req.user.sub) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    const pagos = await (0, mercadopago_service_1.getPagosPorTransaccion)(req.params.txId);
    const pid = pagos[0]?.payment_id;
    const info = pid ? await (0, mercadopago_service_1.consultarPago)(pid) : null;
    res.json({ ok: true, data: { transaccion: tx, pago: info, modo: (0, mercadopago_service_1.getModo)() } });
});
// Confirmar envío (vendedor)
r.post('/transacciones/:id/confirmar-envio', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { trackingCode, mensaje } = zod_1.z.object({ trackingCode: zod_1.z.string().optional(), mensaje: zod_1.z.string().max(500).optional() }).parse(req.body);
    const result = await (0, escrow_service_1.confirmarEnvio)({ transaccionId: req.params.id, vendedorId: req.user.sub, trackingCode, mensaje, ip: req.ip });
    res.json({ ok: true, data: result, message: 'Envío confirmado.' });
});
// Confirmar entrega → libera fondos (comprador)
r.post('/transacciones/:id/confirmar-entrega', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const result = await (0, escrow_service_1.confirmarEntrega)({ transaccionId: req.params.id, compradorId: req.user.sub, ip: req.ip });
    res.json({ ok: true, data: result, message: `$${result.montoLiberado.toLocaleString('es-AR')} ARS liberados al vendedor.` });
});
// Cancelar + reembolso real en MP
r.post('/transacciones/:id/cancelar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { motivo } = zod_1.z.object({ motivo: zod_1.z.string().min(10) }).parse(req.body);
    const tx = await (0, escrow_service_1.getTransaccion)(req.params.id);
    if (!tx) {
        res.status(404).json({ ok: false, error: 'No encontrada' });
        return;
    }
    const tipoActor = tx.compradorId === req.user.sub ? 'COMPRADOR' : tx.vendedorId === req.user.sub ? 'VENDEDOR' : 'ADMIN';
    const pagos = await (0, mercadopago_service_1.getPagosPorTransaccion)(req.params.id);
    const aprobado = pagos.find(p => p.estado === 'approved');
    if (aprobado?.payment_id)
        await (0, mercadopago_service_1.emitirReembolso)({ paymentId: aprobado.payment_id, transaccionId: req.params.id, motivo });
    const result = await (0, escrow_service_1.cancelarTransaccion)({ transaccionId: req.params.id, actorId: req.user.sub, actorTipo: tipoActor, motivo, ip: req.ip });
    res.json({ ok: true, data: result });
});
// Disputar
r.post('/transacciones/:id/disputar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({ motivo: zod_1.z.string().min(5).max(60), descripcion: zod_1.z.string().min(20).max(2000), evidencias: zod_1.z.array(zod_1.z.string().url()).max(5).optional() }).parse(req.body);
    const tx = await (0, escrow_service_1.getTransaccion)(req.params.id);
    if (!tx) {
        res.status(404).json({ ok: false, error: 'No encontrada' });
        return;
    }
    const tipoActor = tx.compradorId === req.user.sub ? 'COMPRADOR' : 'VENDEDOR';
    const result = await (0, escrow_service_1.abrirDisputa)({ transaccionId: req.params.id, iniciadorId: req.user.sub, tipoActor: tipoActor, ...body, ip: req.ip });
    res.status(201).json({ ok: true, data: result });
});
// GET transacción
r.get('/transacciones/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const tx = await (0, escrow_service_1.getTransaccion)(req.params.id);
    if (!tx) {
        res.status(404).json({ ok: false, error: 'No encontrada' });
        return;
    }
    if (tx.compradorId !== req.user.sub && tx.vendedorId !== req.user.sub) {
        res.status(403).json({ ok: false, error: 'Sin permiso' });
        return;
    }
    res.json({ ok: true, data: tx });
});
// Historial de eventos
r.get('/transacciones/:id/eventos', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    res.json({ ok: true, data: await (0, escrow_service_1.getEventos)(req.params.id) });
});
// Admin: estado MP
r.get('/admin/mp/estado', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, mercadopago_service_1.getEstadoGateway)() });
});
// Admin: resolver disputa + reembolso MP
r.post('/admin/disputas/:id/resolver', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { resolucion, descripcion } = zod_1.z.object({ resolucion: zod_1.z.enum(['A_FAVOR_COMPRADOR', 'A_FAVOR_VENDEDOR']), descripcion: zod_1.z.string().min(10) }).parse(req.body);
    if (resolucion === 'A_FAVOR_COMPRADOR') {
        const d = await (0, database_1.queryOne)(`SELECT transaccion_id FROM escrow_disputas WHERE id=$1`, [req.params.id]);
        if (d) {
            const pg = await (0, mercadopago_service_1.getPagosPorTransaccion)(d.transaccion_id);
            const ok = pg.find(p => p.estado === 'approved');
            if (ok?.payment_id)
                await (0, mercadopago_service_1.emitirReembolso)({ paymentId: ok.payment_id, transaccionId: d.transaccion_id, motivo: descripcion });
        }
    }
    res.json({ ok: true, data: await (0, escrow_service_1.resolverDisputa)({ disputaId: req.params.id, adminId: req.user.sub, resolucion, descripcion }) });
});
// Admin: auto-release
r.post('/admin/escrow/auto-release', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, escrow_service_1.procesarAutoReleases)() });
});
// ══════════════════════════════════════════════════════════
// COMISIONES RODAID
// ══════════════════════════════════════════════════════════
// GET /admin/comisiones/resumen?desde=2026-01-01&hasta=2026-12-31
r.get('/admin/comisiones/resumen', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { desde, hasta, vendedorId } = zod_1.z.object({
        desde: zod_1.z.string().datetime().optional(),
        hasta: zod_1.z.string().datetime().optional(),
        vendedorId: zod_1.z.string().uuid().optional(),
    }).parse(req.query);
    const resumen = await (0, comision_service_1.getResumenPeriodo)({
        desde: desde ? new Date(desde) : undefined,
        hasta: hasta ? new Date(hasta) : undefined,
        vendedorId,
    });
    res.json({ ok: true, data: resumen });
});
// GET /admin/comisiones/historial?estado=RETENIDA&pagina=1&limite=50
r.get('/admin/comisiones/historial', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const q = zod_1.z.object({
        desde: zod_1.z.string().datetime().optional(),
        hasta: zod_1.z.string().datetime().optional(),
        vendedorId: zod_1.z.string().uuid().optional(),
        estado: zod_1.z.enum(['RETENIDA', 'ACREDITADA', 'DEVUELTA']).optional(),
        pagina: zod_1.z.coerce.number().int().positive().default(1),
        limite: zod_1.z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    const result = await (0, comision_service_1.getHistorialComisiones)({
        desde: q.desde ? new Date(q.desde) : undefined,
        hasta: q.hasta ? new Date(q.hasta) : undefined,
        vendedorId: q.vendedorId,
        estado: q.estado,
        pagina: q.pagina,
        limite: q.limite,
    });
    res.setHeader('X-Total-Count', String(result.total));
    res.json({ ok: true, data: result });
});
// GET /admin/comisiones/mensual?anio=2026
r.get('/admin/comisiones/mensual', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { anio } = zod_1.z.object({ anio: zod_1.z.coerce.number().int().min(2024).max(2030).default(new Date().getFullYear()) }).parse(req.query);
    const breakdown = await (0, comision_service_1.getBreakdownMensual)(anio);
    res.json({ ok: true, data: { anio, meses: breakdown } });
});
// GET /admin/comisiones/top-vendedores?limite=10
r.get('/admin/comisiones/top-vendedores', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const q = zod_1.z.object({ desde: zod_1.z.string().datetime().optional(), hasta: zod_1.z.string().datetime().optional(), limit: zod_1.z.coerce.number().int().max(50).default(10) }).parse(req.query);
    const top = await (0, comision_service_1.getTopVendedores)({ desde: q.desde ? new Date(q.desde) : undefined, hasta: q.hasta ? new Date(q.hasta) : undefined, limit: q.limit });
    res.json({ ok: true, data: top });
});
// GET /admin/comisiones/proyeccion — proyección del mes actual
r.get('/admin/comisiones/proyeccion', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    res.json({ ok: true, data: await (0, comision_service_1.getProyeccionMes)() });
});
// GET /comisiones/mis-comisiones — para el vendedor autenticado
r.get('/comisiones/mis-comisiones', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const q = zod_1.z.object({ pagina: zod_1.z.coerce.number().default(1), limite: zod_1.z.coerce.number().max(50).default(20) }).parse(req.query);
    const result = await (0, comision_service_1.getHistorialComisiones)({ vendedorId: req.user.sub, pagina: q.pagina, limite: q.limite });
    res.json({ ok: true, data: result });
});
// POST /comisiones/calcular — preview de comisión antes de publicar
r.post('/comisiones/calcular', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { precioARS } = zod_1.z.object({ precioARS: zod_1.z.number().positive() }).parse(req.body);
    const usr = await (0, database_1.queryOne)(`SELECT plan_suscripcion FROM usuarios WHERE id=$1`, [req.user.sub]);
    const plan = usr?.plan_suscripcion ?? 'LIBRE';
    const calc = (0, comision_service_1.calcularComision)(precioARS, plan);
    res.json({ ok: true, data: { ...calc, plan } });
});
// ══════════════════════════════════════════════════════════
// SLA TIEMPO REAL — SSE + Polling
// Actualización automática del estado de validación 72h
// ══════════════════════════════════════════════════════════
// GET /admin/sla/stream — SSE: push server→client cada 15s
// Uso desde browser: const es = new EventSource('/api/v1/admin/sla/stream')
//                   es.addEventListener('sla_snapshot', e => render(JSON.parse(e.data)))
r.get('/admin/sla/stream', ...auth_1.onlyAdmin, async (req, res) => {
    const endpoint = req.query.endpoint ?? undefined;
    const clientId = (0, sla_stream_service_1.sseHandler)(res, endpoint);
    // No llamar next() — SSE mantiene la conexión abierta
});
// GET /admin/sla/snapshot — Polling: estado actual del SLA 72h
r.get('/admin/sla/snapshot', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const endpoint = req.query.endpoint ?? undefined;
    const snap = await (0, sla_stream_service_1.getSLASnapshotRT)(endpoint);
    res.json({ ok: true, data: snap });
});
// POST /admin/sla/broadcast — forzar broadcast a todos los clientes SSE (debug)
r.post('/admin/sla/broadcast', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    await (0, sla_stream_service_1.broadcastSLASnapshot)();
    res.json({ ok: true, data: { clientesNotificados: (0, sla_stream_service_1.getActiveSSEClients)() } });
});
// GET /admin/sla/clientes — cuántos clientes SSE activos
r.get('/admin/sla/clientes', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (_req, res) => {
    res.json({ ok: true, data: { activeSSEClients: (0, sla_stream_service_1.getActiveSSEClients)() } });
});
// ══════════════════════════════════════════════════════════
// POST /gpt/consulta — Proxy seguro Anthropic
// La API key NUNCA sale del servidor Node.js.
// ══════════════════════════════════════════════════════════
r.post('/gpt/consulta', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        mensaje: zod_1.z.string().min(1).max(4000),
        contexto: zod_1.z.enum(['cit_consulta', 'marketplace', 'aliado', 'general', 'legal']).default('general'),
        historial: zod_1.z.array(zod_1.z.object({
            rol: zod_1.z.enum(['user', 'assistant']),
            contenido: zod_1.z.string().max(2000),
        })).max(10).default([]),
    }).parse(req.body);
    const result = await (0, gpt_proxy_service_1.consultaGPT)({
        usuarioId: req.user.sub,
        mensaje: body.mensaje,
        contexto: body.contexto,
        historial: body.historial,
        ip: req.ip ?? req.socket?.remoteAddress,
        userAgent: req.headers['user-agent']?.slice(0, 100),
    });
    // Respuesta al cliente: NUNCA incluye la API key
    res.json({ ok: true, data: result });
});
// POST /gpt/consulta/stream — Streaming SSE del proxy
r.post('/gpt/consulta/stream', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        mensaje: zod_1.z.string().min(1).max(4000),
        contexto: zod_1.z.enum(['cit_consulta', 'marketplace', 'aliado', 'general', 'legal']).default('general'),
        historial: zod_1.z.array(zod_1.z.object({
            rol: zod_1.z.enum(['user', 'assistant']),
            contenido: zod_1.z.string().max(2000),
        })).max(10).default([]),
    }).parse(req.body);
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (event, data) => {
        try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            res.flush?.();
        }
        catch { /* cliente cerró */ }
    };
    await (0, gpt_proxy_service_1.consultaGPTStream)({
        usuarioId: req.user.sub,
        mensaje: body.mensaje,
        contexto: body.contexto,
        historial: body.historial,
        ip: req.ip ?? req.socket?.remoteAddress,
    }, chunk => send('chunk', { text: chunk }), result => { send('done', { ...result, respuesta: undefined }); res.end(); }, err => { send('error', { mensaje: err.message, codigo: err.code }); res.end(); });
});
// ══════════════════════════════════════════════════════════
// CDN · Assets estáticos con ETag + cache-control
// ══════════════════════════════════════════════════════════
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
r.get('/cdn/assets/:filename', (req, res) => {
    const fn = req.params.filename;
    if (fn.includes('..') || fn.includes('/')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
    }
    const fp = path_1.default.join(process.cwd(), 'cdn-assets', fn);
    if (!fs_1.default.existsSync(fp)) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const buf = fs_1.default.readFileSync(fp);
    const etag = crypto_1.default.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
    }
    const ext = path_1.default.extname(fn).slice(1).toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2' }[ext] ?? 'application/octet-stream';
    res.set('Content-Type', mime).set('ETag', etag)
        .set('Cache-Control', 'public, max-age=31536000, immutable').send(buf);
});
r.get('/cdn/manifest.json', rateLimiter_1.burstRateLimit, async (_req, res) => {
    const assetsDir = path_1.default.join(process.cwd(), 'cdn-assets');
    const files = fs_1.default.existsSync(assetsDir) ? fs_1.default.readdirSync(assetsDir) : [];
    const assets = files.filter(f => !f.startsWith('.')).map(f => {
        const buf = fs_1.default.readFileSync(path_1.default.join(assetsDir, f));
        const hash = crypto_1.default.createHash('sha256').update(buf).digest('hex').slice(0, 8);
        const ext = path_1.default.extname(f).slice(1);
        const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] ?? 'application/octet-stream';
        return { filename: f, mime, sizeKB: Math.round(buf.length / 102.4) / 10, hash,
            cdnUrl: `${process.env.CDN_URL ?? ''}/api/v1/cdn/assets/${f}` };
    });
    res.set('Cache-Control', 'public, max-age=300').json({ ok: true, version: '1.0', generado: new Date().toISOString(), assets });
});
// ══════════════════════════════════════════════════════════
// i18n — provincias y localización
// ══════════════════════════════════════════════════════════
// GET /i18n/provincias — lista provincias activas con config
r.get('/i18n/provincias', rateLimiter_1.burstRateLimit, async (_req, res) => {
    const { query: q } = await import('../config/database');
    const rows = await q(`SELECT codigo, nombre, tasa_cit_centavos, moneda, canal_pago_nombre, locale, activa
     FROM provincias_config ORDER BY activa DESC, nombre`, []);
    res.json({ ok: true, data: rows });
});
// GET /i18n/provincias/:codigo — config completa de una provincia
r.get('/i18n/provincias/:codigo', rateLimiter_1.burstRateLimit, async (req, res) => {
    const prov = await (0, rodaid_i18n_service_1.getProvinciaConfig)(req.params.codigo.toUpperCase());
    if (!prov) {
        res.status(404).json({ ok: false, error: 'Provincia no encontrada' });
        return;
    }
    res.json({ ok: true, data: prov });
});
// GET /i18n/formato — probar formatos para un locale
r.get('/i18n/formato', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { locale = 'es-AR', provincia = 'MZA' } = req.query;
    const prov = await (0, rodaid_i18n_service_1.getProvinciaConfig)(provincia);
    res.json({
        ok: true,
        data: {
            locale,
            ejemplos: {
                moneda_cit: rodaid_i18n_service_1.fmt.moneda(prov?.tasaCITCentavos ?? 300000, locale, prov?.moneda ?? 'ARS'),
                moneda_grande: rodaid_i18n_service_1.fmt.moneda(8500000, locale, 'ARS'),
                fecha_hoy: rodaid_i18n_service_1.fmt.fecha(new Date(), locale, prov?.zonaHoraria),
                fecha_hora: rodaid_i18n_service_1.fmt.fechaHora(new Date(), locale, prov?.zonaHoraria),
                relativo_ayer: rodaid_i18n_service_1.fmt.relativo(new Date(Date.now() - 86400000), locale),
                relativo_mes: rodaid_i18n_service_1.fmt.relativo(new Date(Date.now() - 30 * 86400000), locale),
                numero: rodaid_i18n_service_1.fmt.numero(1234567.89, locale),
                porcentaje: rodaid_i18n_service_1.fmt.porcentaje(35.5, locale),
                traducciones: {
                    cit_vigente: (0, rodaid_i18n_service_1.t)('cit.estado.ACTIVO', {}, locale),
                    tasa: (0, rodaid_i18n_service_1.t)('cit.tasa.label', {}, locale),
                    pagar: (0, rodaid_i18n_service_1.t)('cit.pago.iniciar', { canal: prov?.canalPagoNombre ?? 'MxM' }, locale),
                    ley: (0, rodaid_i18n_service_1.t)('ley.referencia', { numero: prov?.leyNumero ?? '9556', provincia: prov?.nombre ?? 'Mendoza' }, locale),
                },
            },
        },
    });
});
// ══════════════════════════════════════════════════════════
// GPT CACHÉ — métricas e invalidación
// ══════════════════════════════════════════════════════════
// GET /gpt/cache/metricas — estadísticas de cache hit rate y tokens ahorrados
r.get('/gpt/cache/metricas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, gpt_cache_service_1.getCacheMetrics)(dias) });
});
// DELETE /gpt/cache — invalidar caché del usuario autenticado
r.delete('/gpt/cache', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const bikeInfo = await (await import('../config/database')).query(`SELECT c.estado FROM bicicletas b
     LEFT JOIN LATERAL (SELECT estado FROM cits WHERE bicicleta_id=b.id ORDER BY creado_en DESC LIMIT 1) c ON TRUE
     WHERE b.propietario_id=$1::uuid LIMIT 10`, [req.user.sub]);
    const borradas = await (0, gpt_cache_service_1.invalidarCacheUsuario)({
        plan: req.user.plan ?? 'LIBRE',
        bikeCount: bikeInfo.length,
        citStates: bikeInfo.map((b) => b.estado ?? 'SIN_CIT'),
    });
    res.json({ ok: true, clavesInvalidadas: borradas });
});
// GET /gpt/cache/sugerencias — lista de preguntas frecuentes predefinidas
r.get('/gpt/cache/sugerencias', rateLimiter_1.burstRateLimit, async (req, res) => {
    res.json({
        ok: true,
        data: gpt_cache_service_1.SUGERENCIAS_PREDEFINIDAS.map(s => ({
            palabrasClave: s.palabrasClave.slice(0, 3),
            tipo: s.tipo,
            tokensAhorrados: s.tokensAhorrados,
            preview: s.respuesta.slice(0, 120) + '…',
        })),
    });
});
// ══════════════════════════════════════════════════════════
// GPT PLAN — uso mensual por plan
// ══════════════════════════════════════════════════════════
// GET /gpt/uso-plan — consumo mensual vs límite del plan
r.get('/gpt/uso-plan', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    res.json({ ok: true, data: await (0, gpt_ratelimit_service_1.getUsoPlan)(req.user.sub) });
});
// GET /gpt/planes — tabla de planes disponibles (pública)
r.get('/gpt/planes', rateLimiter_1.burstRateLimit, async (req, res) => {
    res.json({ ok: true, data: gpt_ratelimit_service_1.PLANES_DEFAULT });
});
// POST /gpt/upgrade — cambiar plan (admin o via pago)
r.post('/gpt/upgrade', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { plan } = zod_1.z.object({
        plan: zod_1.z.enum(['LIBRE', 'ESTANDAR', 'PREMIUM']),
    }).parse(req.body);
    await (0, gpt_ratelimit_service_1.upgradePlan)(req.user.sub, plan);
    res.json({ ok: true, mensaje: `Plan actualizado a ${plan}` });
});
// GET /gpt/uso — consumo del usuario (sin datos sensibles)
r.get('/gpt/uso', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().min(1).max(90).default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, gpt_proxy_service_1.getUsoGPT)(req.user.sub, dias) });
});
// ══════════════════════════════════════════════════════════
// CIT PDF-DATA — payload optimizado para client-side PDF
// ══════════════════════════════════════════════════════════
// GET /cit/:id/pdf-data
// Retorna todos los datos del CIT + QR como data URI PNG
// (generado server-side con qr.service.ts para calidad óptima)
// Cache 5 min (el CIT no cambia entre descargas)
r.get('/cit/:id/pdf-data', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { queryOne: q1 } = await import('../config/database');
    const { buildVerificadorURL, generarQR } = await import('../services/qr.service');
    // Cargar datos del CIT con todos los joins necesarios para el PDF
    const cit = await q1(`
    SELECT
      c.id::text, c.numero_cit, c.estado, c.puntos_total,
      c.hash_sha256, c.fecha_emision, c.fecha_vencimiento,
      c.tasa_pagada, c.nft_token_id,
      b.marca, b.modelo, b.numero_serie,
      u.nombre, u.apellido,
      ca.score    AS cert_score,
      ca.nivel    AS cert_nivel,
      ca.numero   AS cert_numero,
      ca.asegurable AS cert_asegurable,
      p.numero_poliza, p.prima_final, aseg.nombre AS aseguradora,
      c.zona_vencimiento,
      EXTRACT(EPOCH FROM (c.fecha_vencimiento - NOW()))/86400 AS dias_restantes
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    JOIN usuarios u ON u.id = c.propietario_id
    LEFT JOIN certificados_asegurabilidad ca
      ON ca.cit_id = c.id
      ORDER BY ca.creado_en DESC LIMIT 1
    LEFT JOIN seguros_polizas p
      ON p.bicicleta_id = b.id AND p.estado = 'ACTIVA'
    LEFT JOIN seguros_aseguradoras aseg ON aseg.id = p.aseguradora_id
    WHERE c.id = $1::uuid AND c.propietario_id = $2::uuid
    LIMIT 1
  `, [req.params.id, req.user.sub]);
    if (!cit) {
        res.status(404).json({ ok: false, error: 'CIT no encontrado' });
        return;
    }
    // Generar QR apuntando a /verificar/:serial
    const qrURL = buildVerificadorURL(cit.numero_serie);
    let qrDataURI = null;
    let qrSVG = null;
    try {
        const qr = await generarQR(cit.numero_serie, { moduleSize: 8, errorCorrectionLevel: 'M' });
        qrDataURI = qr.dataUriPNG;
        qrSVG = qr.svg;
    }
    catch { /* QR opcional — el PDF se genera igual */ }
    res.set('Cache-Control', 'private, max-age=300');
    res.json({
        ok: true,
        data: {
            // CIT fields
            id: cit.id,
            numeroCIT: cit.numero_cit,
            estado: cit.estado,
            puntosTotal: cit.puntos_total,
            hashSHA256: cit.hash_sha256,
            fechaEmision: cit.fecha_emision,
            fechaVencimiento: cit.fecha_vencimiento,
            diasRestantes: Math.floor(Number(cit.dias_restantes ?? 0)),
            tasaPagada: !!cit.tasa_pagada,
            nftTokenId: cit.nft_token_id ?? null,
            zonaVencimiento: cit.zona_vencimiento,
            // Bicicleta
            marca: cit.marca,
            modelo: cit.modelo,
            numeroSerie: cit.numero_serie,
            // Propietario
            nombre: cit.nombre,
            apellido: cit.apellido,
            // Cert. asegurabilidad
            certScore: cit.cert_score ? parseFloat(cit.cert_score) : null,
            certNivel: cit.cert_nivel ?? null,
            certNumero: cit.cert_numero ?? null,
            // Póliza
            poliza: cit.numero_poliza
                ? { numeroPoliza: cit.numero_poliza, prima: cit.prima_final, aseguradora: cit.aseguradora }
                : null,
            // QR
            qrURL,
            qrDataURI,
            qrSVG,
            // Metadata
            generadoEn: new Date().toISOString(),
        }
    });
});
// GET /verificar/:serial (público) — alias para el verificador sin auth
r.get('/verificar/:serial', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { queryOne: q1 } = await import('../config/database');
    const serial = decodeURIComponent(req.params.serial).trim().toUpperCase();
    const cit = await q1(`
    SELECT c.numero_cit, c.estado, c.hash_sha256, c.fecha_vencimiento,
           c.puntos_total, c.nft_token_id, c.tasa_pagada,
           b.marca, b.modelo, b.numero_serie,
           u.nombre, u.apellido
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    JOIN usuarios u ON u.id = c.propietario_id
    WHERE UPPER(b.numero_serie) = $1
    ORDER BY c.creado_en DESC LIMIT 1
  `, [serial]);
    if (!cit) {
        res.status(404).json({ ok: false, error: 'Serial no registrado en RODAID' });
        return;
    }
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ok: true, data: {
            numeroCIT: cit.numero_cit,
            estado: cit.estado,
            hashSHA256: cit.hash_sha256,
            fechaVencimiento: cit.fecha_vencimiento,
            puntosTotal: cit.puntos_total,
            nftTokenId: cit.nft_token_id,
            tasaPagada: !!cit.tasa_pagada,
            bicicleta: { marca: cit.marca, modelo: cit.modelo, serial: cit.numero_serie },
            propietario: { nombre: cit.nombre, apellido: cit.apellido },
            verificadoEn: new Date().toISOString(),
        } });
});
// ══════════════════════════════════════════════════════════
// MINSEG mTLS · Convenio técnico + endpoints seguros
// ══════════════════════════════════════════════════════════
// GET /admin/minseg/convenio — estado del convenio técnico
r.get('/admin/minseg/convenio', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getConvenioEstado } = await import('../services/minseg.mtls.service');
    const estado = await getConvenioEstado();
    res.json({ ok: true, data: estado });
});
// POST /admin/minseg/convenio/avanzar — avanzar fase del convenio
r.post('/admin/minseg/convenio/avanzar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { avanzarFase } = await import('../services/minseg.mtls.service');
    const body = zod_1.z.object({
        fase: zod_1.z.enum(['INICIADO', 'CSR_GENERADO', 'EN_REVISION', 'CERT_EMITIDO', 'SANDBOX_ACTIVO', 'PRODUCCION', 'SUSPENDIDO', 'VENCIDO']),
        expedienteNro: zod_1.z.string().optional(),
        emailMinSeg: zod_1.z.string().email().optional(),
        notas: zod_1.z.string().optional(),
    }).parse(req.body);
    const result = await avanzarFase(body.fase, body);
    res.json({ ok: true, data: result });
});
// POST /admin/minseg/mtls/generar-csr — generar Certificate Signing Request
r.post('/admin/minseg/mtls/generar-csr', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { generarCSR } = await import('../services/minseg.mtls.service');
    const body = zod_1.z.object({
        cn: zod_1.z.string().default('rodaid.net'),
        org: zod_1.z.string().default('RODAID SAS'),
        ou: zod_1.z.string().default('Certificacion Bicicletas'),
        country: zod_1.z.string().length(2).default('AR'),
        state: zod_1.z.string().default('Mendoza'),
        locality: zod_1.z.string().default('San Martin'),
        email: zod_1.z.string().email().default('infra@rodaid.net'),
        keyBits: zod_1.z.union([zod_1.z.literal(2048), zod_1.z.literal(4096)]).default(4096),
        validDays: zod_1.z.coerce.number().int().default(730),
    }).parse(req.body);
    const csr = await generarCSR(body);
    res.json({ ok: true, data: csr });
});
// POST /admin/minseg/mtls/registrar-cert — registrar cert recibido de MinSeg
r.post('/admin/minseg/mtls/registrar-cert', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { registrarCertificadoRecibido } = await import('../services/minseg.mtls.service');
    const body = zod_1.z.object({
        certPEM: zod_1.z.string().min(100),
        tipo: zod_1.z.enum(['CERT_RODAID', 'CERT_MINSEG_CA', 'CERT_MINSEG_SERVER']),
        notas: zod_1.z.string().optional(),
    }).parse(req.body);
    const result = await registrarCertificadoRecibido(body);
    res.json({ ok: true, data: result });
});
// POST /admin/minseg/mtls/activar-sandbox — activar fase sandbox
r.post('/admin/minseg/mtls/activar-sandbox', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { activarSandbox } = await import('../services/minseg.mtls.service');
    const result = await activarSandbox();
    res.json({ ok: result.ok, data: result });
});
// GET /admin/minseg/health — health check del canal mTLS
r.get('/admin/minseg/health', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { healthCheck } = await import('../services/minseg.mtls.service');
    const hc = await healthCheck();
    res.status(hc.ok ? 200 : 502).json({ ok: hc.ok, data: hc });
});
// GET /admin/minseg/health/historial — últimos N health checks
r.get('/admin/minseg/health/historial', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { getHealthHistory } = await import('../services/minseg.mtls.service');
    const { limit } = zod_1.z.object({ limit: zod_1.z.coerce.number().int().default(20) }).parse(req.query);
    const historial = await getHealthHistory(limit);
    res.json({ ok: true, data: historial, total: historial.length });
});
// GET /admin/minseg/resumen — dashboard operacional completo
r.get('/admin/minseg/resumen', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getResumenOperacional } = await import('../services/minseg.mtls.service');
    const resumen = await getResumenOperacional();
    res.json({ ok: true, data: resumen });
});
// GET /admin/minseg/protocolo — contrato técnico completo (para el convenio)
r.get('/admin/minseg/protocolo', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { PROTOCOLO_DESCRIPCION } = await import('../services/minseg.protocol.service');
    const { getConvenioEstado } = await import('../services/minseg.mtls.service');
    const convenio = await getConvenioEstado();
    res.json({ ok: true, data: { protocolo: PROTOCOLO_DESCRIPCION, convenio } });
});
// POST /admin/minseg/denuncia-test — probar notificación de robo en modo STUB
r.post('/admin/minseg/denuncia-test', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { reportarDenuncia } = await import('../services/minseg.service');
    const body = zod_1.z.object({
        serial: zod_1.z.string().min(3),
        propietarioDNI: zod_1.z.string().min(7),
        propietarioNombre: zod_1.z.string().min(3),
        descripcion: zod_1.z.string().default('Test de denuncia STUB'),
        citId: zod_1.z.string().uuid().optional(),
    }).parse(req.body);
    const result = await reportarDenuncia({
        denunciaRodaidId: `test-${Date.now()}`,
        serial: body.serial,
        propietarioDNI: body.propietarioDNI,
        propietarioNombre: body.propietarioNombre,
        descripcion: body.descripcion,
        numeroCIT: 'RCIT-TEST',
        marca: 'Test',
        modelo: 'Test',
        anio: 2024,
        color: 'Negro',
        fechaDenuncia: new Date().toISOString(),
    });
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// MINSEG · Endpoints INBOUND
// ══════════════════════════════════════════════════════════
async function autenticarMinSegInbound(req, res, next) {
    const { verificarAutenticidadMinSeg } = await import('../services/minseg.inbound.service');
    const apiKey = req.headers['x-minseg-key'] ?? '';
    const firma = req.headers['x-minseg-firma'];
    const nonce = req.headers['x-minseg-nonce'] ?? '';
    const modo = (process.env.MINSEG_CERT_PEM ? 'LIVE' : 'STUB');
    if (!apiKey || !nonce) {
        res.status(401).json({ ok: false, error: 'Headers requeridos' });
        return;
    }
    const auth = verificarAutenticidadMinSeg({ apiKey, firma, nonce, payload: JSON.stringify(req.body), modo });
    if (!auth.ok) {
        res.status(401).json({ ok: false, error: auth.motivo });
        return;
    }
    req.minsegModo = modo;
    req.minsegCN = 'MinSeg-STUB';
    next();
}
r.get('/minseg/health', rateLimiter_1.burstRateLimit, async (_req, res) => {
    const { getHealthResponse } = await import('../services/minseg.inbound.service');
    res.json(getHealthResponse());
});
r.post('/minseg/consulta-serial', rateLimiter_1.burstRateLimit, autenticarMinSegInbound, async (req, res) => {
    const { consultarSerialInbound } = await import('../services/minseg.inbound.service');
    const body = zod_1.z.object({
        serialHash: zod_1.z.string().length(64),
        tipoConsulta: zod_1.z.enum(['VERIFICACION', 'BATCH', 'DENUNCIA']).default('VERIFICACION'),
        nonce: zod_1.z.string().min(10),
    }).parse(req.body);
    const resultado = await consultarSerialInbound(body, {
        ip: req.ip ?? '0.0.0.0', cn: req.minsegCN, modo: req.minsegModo,
    });
    res.json({ ok: true, data: resultado });
});
r.post('/minseg/alerta-robo', rateLimiter_1.burstRateLimit, autenticarMinSegInbound, async (req, res) => {
    const { recibirAlertaRobo } = await import('../services/minseg.inbound.service');
    const body = zod_1.z.object({
        serialHash: zod_1.z.string().length(64),
        denunciaNro: zod_1.z.string().min(3),
        dependencia: zod_1.z.string().min(3),
        descripcion: zod_1.z.string().optional(),
        lat: zod_1.z.coerce.number().optional(),
        lng: zod_1.z.coerce.number().optional(),
        nonce: zod_1.z.string().min(10),
    }).parse(req.body);
    const resultado = await recibirAlertaRobo(body, {
        ip: req.ip ?? '0.0.0.0', cn: req.minsegCN, modo: req.minsegModo,
    });
    res.status(201).json({ ok: resultado.ok, data: resultado });
});
r.get('/minseg/protocolo-spec', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getProtocoloEspecificacion } = await import('../services/minseg.inbound.service');
    res.json({ ok: true, data: getProtocoloEspecificacion() });
});
r.get('/admin/minseg/inbound/resumen', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getResumenInbound } = await import('../services/minseg.inbound.service');
    res.json({ ok: true, data: await getResumenInbound() });
});
r.get('/admin/minseg/convenio/estado', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getConvenioEstado } = await import('../services/minseg.mtls.service');
    const convenio = await getConvenioEstado();
    res.json({ ok: true, data: convenio });
});
r.post('/admin/minseg/convenio/avanzar-fase', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { avanzarFase } = await import('../services/minseg.mtls.service');
    const body = zod_1.z.object({
        fase: zod_1.z.enum(['INICIADO', 'CSR_GENERADO', 'EN_REVISION', 'CERT_EMITIDO', 'SANDBOX_ACTIVO', 'PRODUCCION', 'SUSPENDIDO', 'VENCIDO']),
        expedienteNro: zod_1.z.string().optional(),
        notas: zod_1.z.string().optional(),
        emailMinSeg: zod_1.z.string().email().optional(),
    }).parse(req.body);
    const resultado = await avanzarFase(body.fase, body);
    res.json({ ok: true, data: resultado });
});
r.post('/admin/minseg/csr/generar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { generarCSR } = await import('../services/minseg.mtls.service');
    const body = zod_1.z.object({
        cn: zod_1.z.string().default('rodaid.net'), org: zod_1.z.string().default('RODAID SAS'),
        ou: zod_1.z.string().default('Certificacion Bicicletas'), country: zod_1.z.string().length(2).default('AR'),
        state: zod_1.z.string().default('Mendoza'), locality: zod_1.z.string().default('San Martin'),
        email: zod_1.z.string().email().default('infra@rodaid.net'),
        keyBits: zod_1.z.union([zod_1.z.literal(2048), zod_1.z.literal(4096)]).default(4096),
        validDays: zod_1.z.coerce.number().int().default(730),
    }).parse(req.body);
    const resultado = await generarCSR(body);
    res.json({ ok: true, data: resultado });
});
r.post('/admin/minseg/health-check', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { healthCheck } = await import('../services/minseg.mtls.service');
    const resultado = await healthCheck();
    res.json({ ok: resultado.ok, data: resultado });
});
r.post('/admin/minseg/simular-consulta', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { consultarSerialInbound } = await import('../services/minseg.inbound.service');
    const { serial } = zod_1.z.object({ serial: zod_1.z.string().min(4) }).parse(req.body);
    const crypto = await import('crypto');
    const serialHash = crypto.createHash('sha256').update(serial.toUpperCase()).digest('hex');
    const resultado = await consultarSerialInbound({ serialHash, tipoConsulta: 'VERIFICACION', nonce: new Date().toISOString() }, { ip: '127.0.0.1', cn: 'MinSeg-Test', modo: 'STUB' });
    res.json({ ok: true, data: { serialHash, ...resultado } });
});
// ══════════════════════════════════════════════════════════
// TRANSFERENCIA DE DOMINIO — endpoints
// ══════════════════════════════════════════════════════════
// GET /transferencias/:id — datos del certificado
r.get('/transferencias/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getDatosCertificado } = await import('../services/dominio.transfer.service');
    const datos = await getDatosCertificado(req.params.id);
    if (!datos) {
        res.status(404).json({ ok: false, error: 'Transferencia no encontrada' });
        return;
    }
    res.json({ ok: true, data: datos });
});
// GET /transferencias/:id/pdf-data — payload para generar el PDF del certificado
r.get('/transferencias/:id/pdf-data', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getDatosCertificado } = await import('../services/dominio.transfer.service');
    const { generarQR } = await import('../services/qr.service');
    const datos = await getDatosCertificado(req.params.id);
    if (!datos) {
        res.status(404).json({ ok: false, error: 'Transferencia no encontrada' });
        return;
    }
    const qr = await generarQR(datos.bicicleta.numeroSerie, { moduleSize: 8 }).catch(() => null);
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ ok: true, data: { ...datos, qrDataURI: qr?.dataUriPNG ?? null } });
});
// GET /bicicletas/:id/historial-dominio — historial de propietarios de una bicicleta
r.get('/bicicletas/:id/historial-dominio', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getHistorialDominio } = await import('../services/dominio.transfer.service');
    const historial = await getHistorialDominio(req.params.id);
    res.json({ ok: true, data: historial, total: historial.length });
});
// POST /admin/transferencias/manual — disparar transferencia manualmente (admin / testing)
r.post('/admin/transferencias/manual', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { iniciarTransferenciaDominio } = await import('../services/dominio.transfer.service');
    const body = zod_1.z.object({
        transaccionId: zod_1.z.string().uuid(),
        citId: zod_1.z.string().uuid(),
        vendedorId: zod_1.z.string().uuid(),
        compradorId: zod_1.z.string().uuid(),
        precioArs: zod_1.z.coerce.number().positive(),
        comisionArs: zod_1.z.coerce.number().default(0),
    }).parse(req.body);
    const resultado = await iniciarTransferenciaDominio({ ...body, ip: req.ip });
    res.json({ ok: resultado.ok, data: resultado });
});
// ══════════════════════════════════════════════════════════
// MINSEG CONVENIO TÉCNICO — Panel de gestión de fases
// ══════════════════════════════════════════════════════════
// GET /admin/minseg/convenio/checklist — checklist completo por fase
r.get('/admin/minseg/convenio/checklist', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getConvenioChecklist } = await import('../services/minseg.convenio.service');
    const checklist = await getConvenioChecklist();
    if (!checklist) {
        res.status(404).json({ ok: false, error: 'Sin convenio activo' });
        return;
    }
    res.json({ ok: true, data: checklist });
});
// POST /admin/minseg/api-keys/generar — registrar API Key de MinSeg
r.post('/admin/minseg/api-keys/generar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { registrarApiKeyMinSeg } = await import('../services/minseg.convenio.service');
    const body = zod_1.z.object({
        descripcion: zod_1.z.string().min(5),
        permisos: zod_1.z.array(zod_1.z.string()).default(['consulta-serial', 'alerta-robo', 'recuperacion']),
        expirarDias: zod_1.z.coerce.number().int().positive().default(365),
    }).parse(req.body);
    const expirarEn = new Date(Date.now() + body.expirarDias * 86400_000);
    const key = await registrarApiKeyMinSeg({ ...body, expirarEn });
    // IMPORTANTE: retornar rawKey solo UNA VEZ — luego no se puede recuperar
    res.status(201).json({ ok: true, data: key,
        advertencia: 'Guardá la rawKey ahora — no se puede recuperar después' });
});
// POST /admin/minseg/simular-cliente — simular llamada de MinSeg para testing
r.post('/admin/minseg/simular-cliente', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { simularClienteMinSeg } = await import('../services/minseg.convenio.service');
    const body = zod_1.z.object({
        endpoint: zod_1.z.enum(['consulta-serial', 'alerta-robo', 'recuperacion', 'health']),
        serial: zod_1.z.string().optional(),
        apiKey: zod_1.z.string().optional(),
        baseUrl: zod_1.z.string().url().optional(),
    }).parse(req.body);
    const resultado = await simularClienteMinSeg(body);
    res.json({ ok: true, data: resultado });
});
// POST /minseg/recuperacion — recuperación de bicicleta (MinSeg → RODAID)
r.post('/minseg/recuperacion', rateLimiter_1.burstRateLimit, autenticarMinSegInbound, async (req, res) => {
    const { procesarRecuperacionMinSeg } = await import('../services/minseg.recuperacion.service');
    const body = zod_1.z.object({
        serialHash: zod_1.z.string().length(64),
        denunciaNro: zod_1.z.string().min(3),
        dependencia: zod_1.z.string().min(3),
        novedades: zod_1.z.string().optional(),
        nonce: zod_1.z.string().min(10),
    }).parse(req.body);
    const resultado = await procesarRecuperacionMinSeg({
        rawBody: JSON.stringify(body),
        signature: req.headers['x-minseg-firma'] ?? '',
        timestamp: body.nonce,
        eventId: req.headers['x-minseg-event-id'] ?? require('crypto').randomUUID(),
        ipOrigen: req.ip ?? '0.0.0.0',
    });
    res.json({ ok: resultado.procesado, data: resultado });
});
// ══════════════════════════════════════════════════════════
// INSPECTOR PANEL · Endpoints del Panel de Gestión
// ══════════════════════════════════════════════════════════
// GET /inspector/cola — bicis con CIT en BORRADOR o SIN CIT asignadas al taller
r.get('/inspector/cola', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['INSPECTOR', 'ADMIN', 'ALIADO'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Solo inspectores' });
        return;
    }
    const { query: q } = await import('../config/database');
    const inspRow = await import('../config/database')
        .then(db => db.queryOne(`SELECT taller_aliado_id::text FROM inspectores WHERE usuario_id=$1::uuid AND activo=TRUE`, [req.user.sub]));
    const tallerId = inspRow?.taller_aliado_id ?? null;
    // Bicis que tienen CIT en BORRADOR (inspección incompleta) o sin CIT activo
    const pendientes = await q(`
    SELECT DISTINCT ON (b.id)
      b.id::text      AS bicicleta_id,
      b.marca, b.modelo, b.numero_serie,
      u.nombre        AS propietario_nombre,
      u.apellido      AS propietario_apellido,
      u.email         AS propietario_email,
      c.id::text      AS cit_id,
      c.numero_cit,
      c.estado        AS cit_estado,
      c.puntos_total,
      c.creado_en     AS cit_iniciado_en,
      EXTRACT(EPOCH FROM (NOW() - c.creado_en))/3600 AS horas_transcurridas
    FROM bicicletas b
    JOIN usuarios u ON u.id = b.propietario_id
    LEFT JOIN cits c ON c.bicicleta_id = b.id
      AND c.estado IN ('BORRADOR','ACTIVO')
    WHERE b.propietario_id != '00000000-0000-0000-0000-000000000000'::uuid
    ORDER BY b.id, c.creado_en DESC NULLS LAST
    LIMIT 20
  `, []);
    res.json({ ok: true, data: pendientes, total: pendientes.length });
});
// GET /inspector/mis-cits-hoy — CITs emitidos por este inspector hoy
r.get('/inspector/mis-cits-hoy', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q, queryOne: q1 } = await import('../config/database');
    const insp = await q1(`SELECT id::text FROM inspectores WHERE usuario_id=$1::uuid AND activo=TRUE`, [req.user.sub]);
    if (!insp) {
        res.json({ ok: true, data: [], total: 0, puntos_emitidos: 0 });
        return;
    }
    const cits = await q(`
    SELECT c.numero_cit, c.estado, c.puntos_total,
           c.creado_en, b.marca, b.modelo, b.numero_serie,
           u.nombre, u.apellido
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    JOIN usuarios u ON u.id = c.propietario_id
    WHERE c.inspector_id = $1::uuid
      AND c.creado_en::date = CURRENT_DATE
    ORDER BY c.creado_en DESC
  `, [insp.id]);
    const puntosTotal = cits.reduce((s, c) => s + (c.puntos_total ?? 0), 0);
    res.json({ ok: true, data: cits, total: cits.length, puntos_emitidos: puntosTotal });
});
// GET /inspector/bicicleta/:id/historial — historial CIT de una bici
r.get('/inspector/bicicleta/:id/historial', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q } = await import('../config/database');
    const cits = await q(`
    SELECT c.id::text, c.numero_cit, c.estado, c.puntos_total,
           c.hash_sha256, c.fecha_emision, c.fecha_vencimiento, c.tasa_pagada,
           ui.nombre AS inspector_nombre, ui.apellido AS inspector_apellido,
           ta.nombre AS taller
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    LEFT JOIN inspectores i ON i.id = c.inspector_id
    LEFT JOIN usuarios ui ON ui.id = i.usuario_id
    LEFT JOIN talleres_aliados ta ON ta.id = c.taller_aliado_id
    WHERE b.id = $1::uuid
    ORDER BY c.creado_en DESC LIMIT 10
  `, [req.params.id]);
    res.json({ ok: true, data: cits });
});
// PATCH /inspector/cit/:id/puntos — actualizar puntos parciales (BORRADOR)
r.patch('/inspector/cit/:id/puntos', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q } = await import('../config/database');
    const body = zod_1.z.object({
        puntos: zod_1.z.record(zod_1.z.boolean()),
        observaciones: zod_1.z.record(zod_1.z.string()).optional(),
    }).parse(req.body);
    const puntosTotal = Object.values(body.puntos).filter(Boolean).length;
    await q(`
    UPDATE cits SET
      puntos_total  = $2,
      punto_detalle = $3::jsonb,
      actualizado_en = NOW()
    WHERE id = $1::uuid AND estado IN ('BORRADOR','ACTIVO')
  `, [req.params.id, puntosTotal, JSON.stringify({ puntos: body.puntos, observaciones: body.observaciones ?? {} })]);
    // Recalcular zona si el CIT ya tiene fecha
    const { evaluarZonaCIT } = await import('../services/cit.decision.tree');
    evaluarZonaCIT(req.params.id).catch(() => { });
    res.json({ ok: true, data: { puntosTotal, estado: puntosTotal >= 15 ? 'APTO' : 'INSUFICIENTE' } });
});
// POST /inspector/cit/:id/aprobar — finalizar inspección y disparar bridge
r.post('/inspector/cit/:id/aprobar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q, queryOne: q1 } = await import('../config/database');
    const body = zod_1.z.object({
        puntos: zod_1.z.record(zod_1.z.boolean()),
        observaciones: zod_1.z.record(zod_1.z.string()).optional(),
        djFirmada: zod_1.z.boolean(),
        motivo_rechazo: zod_1.z.string().optional(),
    }).parse(req.body);
    if (!body.djFirmada) {
        res.status(422).json({ ok: false, error: 'Declaración jurada requerida' });
        return;
    }
    const puntosTotal = Object.values(body.puntos).filter(Boolean).length;
    const aprobado = puntosTotal >= 15;
    const estado = aprobado ? 'ACTIVO' : 'BORRADOR';
    await q(`
    UPDATE cits SET
      estado         = $2,
      puntos_total   = $3,
      punto_detalle  = $4::jsonb,
      motivo_rechazo = $5,
      fecha_emision  = CASE WHEN $2='ACTIVO' THEN NOW() ELSE fecha_emision END,
      fecha_vencimiento = CASE WHEN $2='ACTIVO' THEN NOW() + INTERVAL '1 year' ELSE fecha_vencimiento END,
      actualizado_en = NOW()
    WHERE id = $1::uuid
  `, [req.params.id, estado, puntosTotal,
        JSON.stringify({ puntos: body.puntos, observaciones: body.observaciones ?? {} }),
        body.motivo_rechazo ?? null]);
    // Cargar datos para el bridge
    const cit = await q1(`
    SELECT c.id::text,c.numero_cit,c.propietario_id::text,
           b.marca,b.modelo,b.numero_serie
    FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
    WHERE c.id=$1::uuid
  `, [req.params.id]);
    if (cit) {
        const { triggerCITAprobado, triggerCITRechazado } = await import('../services/cit.decision.tree');
        if (aprobado) {
            triggerCITAprobado({
                citId: cit.id, usuarioId: cit.propietario_id,
                numeroCIT: cit.numero_cit, serial: cit.numero_serie,
                marca: cit.marca, modelo: cit.modelo, txHash: `insp:${req.params.id}`,
            });
        }
        else {
            triggerCITRechazado({
                citId: cit.id, usuarioId: cit.propietario_id,
                numeroCIT: cit.numero_cit, serial: cit.numero_serie,
                motivo: body.motivo_rechazo ?? `Puntos insuficientes: ${puntosTotal}/20 (mínimo 15)`,
            });
        }
    }
    res.json({
        ok: true,
        data: {
            citId: req.params.id,
            numeroCIT: cit?.numero_cit,
            estado,
            puntosTotal,
            aprobado,
            resultado: aprobado ? 'CIT_APROBADO' : 'CIT_RECHAZADO',
        }
    });
});
// ══════════════════════════════════════════════════════════
// RODAID PAY — flujo completo MP + Escrow + Notificaciones
// ══════════════════════════════════════════════════════════
// POST /mp/cit/:id/preferencia — crear preferencia MP para pago de tasa CIT
// Retorna: { initPoint, preferenceId, gateway }
r.post('/mp/cit/:id/preferencia', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { crearPreferencia } = await import('../services/mercadopago.service');
    const { queryOne: q1 } = await import('../config/database');
    const cit = await q1(`
    SELECT c.id::text, c.numero_cit, c.tasa_pagada, c.estado,
           b.marca, b.modelo, b.numero_serie,
           u.email, u.nombre, u.apellido
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    JOIN usuarios u ON u.id = c.propietario_id
    WHERE c.id = $1::uuid AND c.propietario_id = $2::uuid
  `, [req.params.id, req.user.sub]);
    if (!cit) {
        res.status(404).json({ ok: false, error: 'CIT no encontrado' });
        return;
    }
    if (cit.tasa_pagada) {
        res.status(409).json({ ok: false, error: 'Tasa ya pagada' });
        return;
    }
    if (cit.estado !== 'ACTIVO' && cit.estado !== 'BORRADOR') {
        res.status(400).json({ ok: false, error: 'CIT no elegible para pago de tasa' });
        return;
    }
    const TASA_CIT_ARS = 300000; // $3.000 ARS en centavos
    const baseUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.net';
    const pref = await crearPreferencia({
        transaccionId: `CIT-${cit.id}`, // prefijo para detectar en webhook
        monto: TASA_CIT_ARS,
        titulo: `Tasa CIT — ${cit.marca} ${cit.modelo}`,
        descripcion: `${cit.numero_cit} · Ley Provincial N° 9556 · Mendoza`,
        compradorEmail: cit.email,
        compradorNombre: `${cit.nombre} ${cit.apellido}`,
        returnUrl: `${baseUrl}/cit/${cit.id}?tasa=ok`,
        cancelUrl: `${baseUrl}/cit/${cit.id}?tasa=cancelado`,
        expirarEn: new Date(Date.now() + 2 * 3600_000), // 2 horas
    });
    res.json({ ok: true, data: {
            initPoint: pref.initPoint,
            preferenceId: pref.preferenceId,
            gateway: pref.gateway,
            modoMP: pref.gateway,
            numeroCIT: cit.numero_cit,
            monto: TASA_CIT_ARS,
            expiraEn: new Date(Date.now() + 2 * 3600_000).toISOString(),
        } });
});
// POST /mp/marketplace/preferencia — crear preferencia MP para compra en marketplace
r.post('/mp/marketplace/preferencia', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { crearPreferencia, getModo } = await import('../services/mercadopago.service');
    const { queryOne: q1 } = await import('../config/database');
    const body = zod_1.z.object({ publicacionId: zod_1.z.string().uuid() }).parse(req.body);
    // Crear transacción de escrow primero
    const { iniciarCompra } = await import('../services/escrow.service');
    const compra = await iniciarCompra({
        publicacionId: body.publicacionId,
        compradorId: req.user.sub,
    });
    if (!compra.transaccionId) {
        res.status(400).json({ ok: false, error: 'No se pudo iniciar la compra' });
        return;
    }
    const tx = await q1(`
    SELECT t.precio_ars, p.titulo, b.marca, b.modelo,
           u.email, u.nombre
    FROM transacciones t
    JOIN marketplace_publicaciones p ON p.id = t.publicacion_id
    JOIN bicicletas b ON b.id = t.bicicleta_id
    JOIN usuarios u ON u.id = t.comprador_id
    WHERE t.id = $1::uuid
  `, [compra.transaccionId]);
    if (!tx) {
        res.status(500).json({ ok: false, error: 'Error cargando transacción' });
        return;
    }
    const baseUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.net';
    const pref = await crearPreferencia({
        transaccionId: compra.transaccionId,
        monto: Number(tx.precio_ars) * 100, // a centavos
        titulo: `${tx.marca} ${tx.modelo} · RODAID`,
        descripcion: tx.titulo ?? `Bicicleta ${tx.marca} ${tx.modelo}`,
        compradorEmail: tx.email,
        compradorNombre: tx.nombre,
        returnUrl: `${baseUrl}/compra/${compra.transaccionId}?estado=ok`,
        cancelUrl: `${baseUrl}/compra/${compra.transaccionId}?estado=cancelado`,
    });
    // Guardar preference_id en la transacción
    await q1(`UPDATE transacciones SET mp_preference_id=$1, link_pago=$2 WHERE id=$3::uuid`, [pref.preferenceId, pref.initPoint, compra.transaccionId]).catch(() => { });
    res.json({ ok: true, data: {
            transaccionId: compra.transaccionId,
            initPoint: pref.initPoint,
            preferenceId: pref.preferenceId,
            gateway: pref.gateway,
            monto: Number(tx.precio_ars),
        } });
});
// POST /webhooks/mp/sdk — webhook SDK con firma HMAC-SHA256 (alternativo al legacy)
// Ya existe — ahora le agrega el bridge de notificaciones
// GET /mp/estado — estado del gateway MP (modo, credenciales, cuenta)
r.get('/mp/estado', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (_req, res) => {
    const { getModo, getEstadoGateway } = await import('../services/mercadopago.service');
    const estado = await getEstadoGateway();
    res.json({ ok: true, data: { modoActual: getModo(), ...estado } });
});
// POST /admin/mp/bridge/test — probar el bridge manualmente
r.post('/admin/mp/bridge/test', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { procesarEventoMP } = await import('../services/mp.notif.bridge');
    const body = zod_1.z.object({
        paymentId: zod_1.z.string(),
        status: zod_1.z.enum(['approved', 'rejected', 'pending']),
        transaccionId: zod_1.z.string().uuid().optional(),
        esTaskaCIT: zod_1.z.boolean().default(false),
        citId: zod_1.z.string().uuid().optional(),
    }).parse(req.body);
    const result = await procesarEventoMP({ ...body, gateway: 'TEST' });
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// NOTIFICACIONES · Árbol de decisión + scheduler manual
// ══════════════════════════════════════════════════════════
// POST /admin/notif/job-manual — ejecutar jobs manualmente (solo admin)
r.post('/admin/notif/job-manual', ...auth_1.authenticated, async (req, res) => {
    if (req.user.rol !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Solo ADMIN' });
        return;
    }
    const { ejecutarJobManual } = await import('../services/notif.scheduler');
    const resultado = await ejecutarJobManual();
    res.json({ ok: true, data: resultado });
});
// GET /admin/notif/zonas — resumen de zonas de vencimiento
r.get('/admin/notif/zonas', ...auth_1.authenticated, async (req, res) => {
    if (req.user.rol !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Solo ADMIN' });
        return;
    }
    const { getResumenZonas } = await import('../services/cit.decision.tree');
    const zonas = await getResumenZonas();
    res.json({ ok: true, data: zonas });
});
// POST /notif/cit/:id/evaluar — evaluar zona de un CIT específico
r.post('/notif/cit/:id/evaluar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { evaluarZonaCIT } = await import('../services/cit.decision.tree');
    const resultado = await evaluarZonaCIT(req.params.id);
    res.json({ ok: true, data: resultado });
});
// GET /notificaciones — mis notificaciones in-app
r.get('/notificaciones', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getMisNotificaciones } = await import('../services/notif.service');
    const page = parseInt(req.query.page ?? '1');
    const result = await getMisNotificaciones(req.user.sub, { page, limit: 20 });
    res.json({ ok: true, data: result });
});
// PATCH /notificaciones/:id/leida — marcar leída
r.patch('/notificaciones/:id/leida', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { marcarLeida } = await import('../services/notif.service');
    const ok = await marcarLeida(req.params.id, req.user.sub);
    res.json({ ok });
});
// POST /notificaciones/leer-todas
r.post('/notificaciones/leer-todas', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { marcarTodasLeidas } = await import('../services/notif.service');
    const count = await marcarTodasLeidas(req.user.sub);
    res.json({ ok: true, data: { marcadas: count } });
});
// DELETE /device-tokens/:id — desregistrar token
r.delete('/device-tokens/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q } = await import('../config/database');
    await q(`UPDATE device_tokens SET valido=FALSE, activo=FALSE, motivo_baja='USUARIO_DESREGISTRO'
     WHERE id=$1::uuid AND usuario_id=$2::uuid`, [req.params.id, req.user.sub]);
    res.json({ ok: true });
});
// ══════════════════════════════════════════════════════════
// GARAJE DIGITAL · Endpoints cablerables desde la UI
// ══════════════════════════════════════════════════════════
// GET /garaje/resumen — payload completo del Garaje Digital
// Cache Redis 30s · responde bicicletas + CIT + cert + póliza + score
r.get('/garaje/resumen', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getGarajeResumen } = await import('../services/garaje.service');
    const data = await getGarajeResumen(req.user.sub);
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ ok: true, data });
});
// GET /usuario/bicicletas — alias legacy usado por el demo v15
r.get('/usuario/bicicletas', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getGarajeResumen } = await import('../services/garaje.service');
    const { bicicletas } = await getGarajeResumen(req.user.sub);
    res.json({ ok: true, data: bicicletas });
});
// GET /cit/:id — estado real de un CIT específico
r.get('/cit/:id', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { getCITById } = await import('../services/garaje.service');
    const z_uuid = zod_1.z.string().uuid();
    const citId = z_uuid.safeParse(req.params.id);
    if (!citId.success) {
        res.status(400).json({ ok: false, error: 'ID inválido' });
        return;
    }
    // Si viene con JWT → propietario real; si es público → verificador QR
    const usuarioId = req.user?.sub ?? '00000000-0000-0000-0000-000000000000';
    // Para verificación pública usar el endpoint /verificar/:serial en su lugar
    const jwtAuth = req.headers.authorization?.startsWith('Bearer ');
    if (!jwtAuth) {
        res.status(401).json({ ok: false, error: 'Autenticación requerida' });
        return;
    }
    // Extraer user del JWT sin middleware completo
    try {
        const { verifyAndExtractToken } = await import('../services/jwt.service');
        const payload = verifyAndExtractToken(req.headers.authorization.split(' ')[1]);
        const cit = await getCITById(citId.data, payload.sub);
        if (!cit) {
            res.status(404).json({ ok: false, error: 'CIT no encontrado' });
            return;
        }
        res.json({ ok: true, data: cit });
    }
    catch {
        res.status(401).json({ ok: false, error: 'Token inválido' });
        return;
    }
});
// GET /cit/:id/poll — SSE polling del estado del CIT (emitido/NFT/validado)
// Usado por el wizard de registro para actualizar la UI en tiempo real
r.get('/cit/:id/poll', ...auth_1.authenticated, async (req, res) => {
    const { getCITById } = await import('../services/garaje.service');
    const citId = req.params.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    let attempts = 0;
    const interval = setInterval(async () => {
        attempts++;
        try {
            const cit = await getCITById(citId, req.user.sub);
            if (!cit) {
                res.write('event: error\ndata: not_found\n\n');
                return;
            }
            res.write(`event: cit_status\ndata: ${JSON.stringify({ estado: cit.estado, puntosTotal: cit.puntosTotal, hasHashBFA: cit.hasHashBFA, nftTokenId: cit.nftTokenId })}\n\n`);
            if (cit.estado === 'ACTIVO' || attempts >= 30) {
                res.write('event: done\ndata: {}\n\n');
                clearInterval(interval);
                res.end();
            }
        }
        catch {
            clearInterval(interval);
            res.end();
        }
    }, 2000);
    req.on('close', () => clearInterval(interval));
});
// ══════════════════════════════════════════════════════════
// SEGUROS · Motor de cotización + contratación
// ══════════════════════════════════════════════════════════
// GET /seguros/aseguradoras — catálogo de aseguradoras activas
r.get('/seguros/aseguradoras', rateLimiter_1.burstRateLimit, async (_req, res) => {
    const { query: q } = await import('../config/database');
    const rows = await q(`SELECT id::text, codigo, nombre, descripcion,
    dto_cit_verificado, dto_nft_bfa, dto_identidad_mxm, dto_score_excelente,
    comision_rodaid, modo FROM seguros_aseguradoras WHERE activa=TRUE ORDER BY nombre`, []);
    res.json({ ok: true, data: rows });
});
// POST /seguros/cotizar — cotización multi-aseguradora en un clic
r.post('/seguros/cotizar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { cotizarSeguro } = await import('../services/seguro.cotizador.service');
    const body = zod_1.z.object({
        bicicletaId: zod_1.z.string().uuid(),
        citId: zod_1.z.string().uuid(),
        tipoBici: zod_1.z.enum(['URBANA', 'MTB', 'RUTA', 'ELECTRICA', 'GRAVEL']).default('URBANA'),
        tipoCobVert: zod_1.z.enum(['ROBO', 'COMBINADO']).default('ROBO'),
    }).parse(req.body);
    const result = await cotizarSeguro({ ...body, usuarioId: req.user.sub });
    res.json({ ok: true, data: result });
});
// POST /seguros/contratar — contratar una cotización específica
r.post('/seguros/contratar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { contratarSeguro } = await import('../services/seguro.cotizador.service');
    const body = zod_1.z.object({
        cotizacionId: zod_1.z.string(),
        aseguradoraCodigo: zod_1.z.string(),
        productoCodigo: zod_1.z.string(),
    }).parse(req.body);
    const result = await contratarSeguro({ ...body, usuarioId: req.user.sub });
    res.status(201).json({ ok: true, data: result });
});
// GET /seguros/mis-polizas — pólizas activas del usuario
r.get('/seguros/mis-polizas', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getMisPolizas } = await import('../services/seguro.cotizador.service');
    const polizas = await getMisPolizas(req.user.sub);
    res.json({ ok: true, data: polizas });
});
// GET /seguros/poliza/:id — detalle de una póliza
r.get('/seguros/poliza/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { queryOne: q1 } = await import('../config/database');
    const p = await q1(`SELECT p.*,a.nombre AS aseguradora,pr.nombre AS producto,
    b.marca,b.modelo FROM seguros_polizas p
    JOIN seguros_aseguradoras a ON a.id=p.aseguradora_id
    JOIN seguros_productos pr ON pr.id=p.producto_id
    JOIN bicicletas b ON b.id=p.bicicleta_id
    WHERE p.id=$1::uuid AND p.usuario_id=$2::uuid`, [req.params.id, req.user.sub]);
    if (!p) {
        res.status(404).json({ ok: false, error: 'Póliza no encontrada' });
        return;
    }
    res.json({ ok: true, data: p });
});
// POST /seguros/siniestro — reportar un siniestro
r.post('/seguros/siniestro', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q, queryOne: q1 } = await import('../config/database');
    const body = zod_1.z.object({
        polizaId: zod_1.z.string().uuid(),
        tipo: zod_1.z.enum(['ROBO', 'DAÑO_TOTAL', 'DAÑO_PARCIAL', 'RESPONSABILIDAD']),
        descripcion: zod_1.z.string().min(20),
        denunciaPolicial: zod_1.z.string().optional(),
        montoReclamado: zod_1.z.coerce.number().int().optional(),
    }).parse(req.body);
    const numero = `SIN-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`;
    const sin = await q1(`INSERT INTO seguros_siniestros
    (numero,poliza_id,usuario_id,tipo,descripcion,denuncia_policial_nro,monto_reclamado)
    VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7) RETURNING id::text,numero`, [numero, body.polizaId, req.user.sub, body.tipo, body.descripcion,
        body.denunciaPolicial ?? null, body.montoReclamado ?? null]);
    res.status(201).json({ ok: true, data: sin });
});
// ══════════════════════════════════════════════════════════
// BFA · Blockchain Federal Argentina
// ══════════════════════════════════════════════════════════
// POST /bfa/mint/:citId — acuñar NFT en BFA (requiere tasa pagada)
r.post('/bfa/mint/:citId', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { acuñarCITEnBFA } = await import('../services/bfa.mint.service');
    res.json({ ok: true, data: await acuñarCITEnBFA(req.params.citId) });
});
// GET /bfa/mint/:citId/status — estado del mint
r.get('/bfa/mint/:citId/status', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getMintStatus } = await import('../services/bfa.mint.service');
    res.json({ ok: true, data: await getMintStatus(req.params.citId) });
});
// GET /bfa/verificar/:citId — verificar mint en BFA
r.get('/bfa/verificar/:citId', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { verificarMintEnBFA } = await import('../services/bfa.mint.service');
    res.json({ ok: true, data: await verificarMintEnBFA(req.params.citId) });
});
// POST /bfa/transfer — transferir NFT al comprador (venta marketplace)
r.post('/bfa/transfer', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { transferirNFTAlComprador } = await import('../services/nft.transfer.service');
    const b = zod_1.z.object({ citId: zod_1.z.string().uuid(), compradorId: zod_1.z.string().uuid() }).parse(req.body);
    res.json({ ok: true, data: await transferirNFTAlComprador({ citId: b.citId, transaccionId: 'manual-' + Date.now(), vendedorId: req.user.sub, compradorId: b.compradorId }) });
});
// GET /bfa/events — eventos on-chain indexados por el indexer
r.get('/bfa/events', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { bfaIndexer, indexStubEvent } = await import('../services/bfa.indexer');
    const { limit } = zod_1.z.object({ limit: zod_1.z.coerce.number().int().default(20) }).parse(req.query);
    res.json({ ok: true, data: { indexer: bfaIndexer.constructor.name, limit } });
});
// GET /bfa/status — estado del nodo BFA + contrato RCIT
r.get('/bfa/status', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { bfaService } = await import('../services/bfa.service');
    const configured = !!(process.env.BFA_RPC_URL && process.env.BFA_CONTRACT_ADDRESS);
    res.json({ ok: true, data: { configured, modo: configured ? 'LIVE' : 'STUB', contrato: process.env.BFA_CONTRACT_ADDRESS ?? '0x0', simbolo: 'RCIT' } });
});
// ══════════════════════════════════════════════════════════
// RODAID-GPT — Anthropic claude-sonnet
// ══════════════════════════════════════════════════════════
// POST /ai/chat — chat simple (respuesta completa)
r.post('/ai/chat', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        mensaje: zod_1.z.string().min(1).max(4000),
        conversacionId: zod_1.z.string().uuid().optional(),
        maxTokens: zod_1.z.coerce.number().int().min(100).max(4096).default(2048),
    }).parse(req.body);
    const result = await (0, rodaid_ai_service_1.chatRodaidGPT)({
        usuarioId: req.user.sub,
        conversacionId: body.conversacionId,
        mensaje: body.mensaje,
        maxTokens: body.maxTokens,
    });
    res.json({ ok: true, data: result });
});
// POST /ai/chat/stream — streaming SSE (tokens en tiempo real)
r.post('/ai/chat/stream', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        mensaje: zod_1.z.string().min(1).max(4000),
        conversacionId: zod_1.z.string().uuid().optional(),
    }).parse(req.body);
    // Headers SSE
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (event, data) => {
        try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            res.flush?.();
        }
        catch { /* cliente cerró */ }
    };
    await (0, rodaid_ai_service_1.chatRodaidGPTStream)({ usuarioId: req.user.sub, conversacionId: body.conversacionId, mensaje: body.mensaje }, chunk => send('chunk', { text: chunk }), result => send('done', result), err => send('error', { mensaje: err.message }));
    res.end();
});
// GET /ai/conversaciones — historial de conversaciones
r.get('/ai/conversaciones', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { limite } = zod_1.z.object({ limite: zod_1.z.coerce.number().int().default(20) }).parse(req.query);
    res.json({ ok: true, data: await (0, rodaid_ai_service_1.getConversaciones)(req.user.sub, limite) });
});
// GET /ai/conversaciones/:id — detalle de una conversación
r.get('/ai/conversaciones/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const conv = await (0, rodaid_ai_service_1.getConversacion)(req.params.id, req.user.sub);
    if (!conv) {
        res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
        return;
    }
    res.json({ ok: true, data: conv });
});
// DELETE /ai/conversaciones/:id — eliminar conversación
r.delete('/ai/conversaciones/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    await (0, rodaid_ai_service_1.eliminarConversacion)(req.params.id, req.user.sub);
    res.json({ ok: true, mensaje: 'Conversación eliminada' });
});
// GET /ai/uso — tokens consumidos por el usuario
r.get('/ai/uso', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { dias } = zod_1.z.object({ dias: zod_1.z.coerce.number().int().default(30) }).parse(req.query);
    res.json({ ok: true, data: await (0, rodaid_ai_service_1.getTokensUsados)(req.user.sub, dias) });
});
r.get('/analitica/personal', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q, queryOne: q1 } = await import('../config/database');
    const uid = req.user.sub;
    const [bicicletas, resumen, actividad, historial] = await Promise.all([
        q(`SELECT b.id::text, b.marca, b.modelo, b.numero_serie,
      COUNT(c.id)::int AS total_inspecciones,
      ROUND(AVG(c.puntos_total)::numeric,1) AS puntaje_promedio,
      COALESCE(MAX(c.km_odometro),0)::int AS km_odometro,
      COALESCE(SUM(c.km_desde_ultimo),0)::int AS km_auditados,
      EXTRACT(DAY FROM NOW()-MAX(c.fecha_emision))::int AS dias_desde_ultima,
      bool_or(c.estado='ACTIVO') AS tiene_cit_vigente
      FROM bicicletas b LEFT JOIN cits c ON c.bicicleta_id=b.id
      WHERE b.propietario_id=$1::uuid GROUP BY b.id,b.marca,b.modelo,b.numero_serie
      ORDER BY total_inspecciones DESC`, [uid]),
        q1(`SELECT COUNT(DISTINCT b.id)::int AS total_bicicletas,
      COUNT(DISTINCT c.id)::int AS total_cits,
      COUNT(DISTINCT c.id) FILTER(WHERE c.estado='ACTIVO')::int AS cits_activos,
      ROUND(AVG(c.puntos_total)::numeric,1) AS puntaje_global,
      COALESCE(SUM(c.km_desde_ultimo),0)::int AS km_auditados_total
      FROM bicicletas b LEFT JOIN cits c ON c.bicicleta_id=b.id WHERE b.propietario_id=$1::uuid`, [uid]),
        q(`SELECT TO_CHAR(DATE_TRUNC('month',c.creado_en),'YYYY-MM') AS mes,
      COUNT(*)::int AS inspecciones, ROUND(AVG(c.puntos_total)::numeric,1) AS puntaje
      FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
      WHERE b.propietario_id=$1::uuid AND c.creado_en>=NOW()-INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month',c.creado_en) ORDER BY mes`, [uid]),
        q(`SELECT c.numero_cit, b.marca||' '||b.modelo AS bici,
      c.estado, c.puntos_total, c.fecha_emision::text, c.km_desde_ultimo
      FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
      WHERE b.propietario_id=$1::uuid AND c.fecha_emision IS NOT NULL
      ORDER BY c.fecha_emision DESC LIMIT 10`, [uid]),
    ]);
    const puntaje = parseFloat(resumen?.puntaje_global ?? '0');
    const score = Math.min(100, Math.round(puntaje / 20 * 80) + (bicicletas.some((b) => b.km_auditados > 0) ? 20 : 0));
    res.json({ ok: true, data: { resumen: { ...resumen, scoreSalud: score, nivelSalud: score >= 80 ? 'EXCELENTE' : score >= 60 ? 'BUENO' : score >= 40 ? 'REGULAR' : 'NECESITA ATENCIÓN' }, bicicletas, actividadMensual: actividad, historialCITs: historial } });
});
// ══════════════════════════════════════════════════════════
// MAPA DE CALOR — GPS reales de CITs
// ══════════════════════════════════════════════════════════
// GET /mapa/calor — puntos GPS para HeatmapLayer
r.get('/mapa/calor', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { query: q } = await import('../config/database');
    const { zona, estado, desde } = (req.query || {});
    // Filtros opcionales
    const conds = ['c.insp_geo_lat IS NOT NULL'];
    const params = [];
    if (estado && ['ACTIVO', 'BORRADOR', 'PAGO_PENDIENTE'].includes(estado)) {
        params.push(estado);
        conds.push(`c.estado=$${params.length}`);
    }
    if (desde) {
        params.push(desde);
        conds.push(`c.creado_en >= $${params.length}::date`);
    }
    // Bounding box de Zona Este Mendoza por defecto
    const latMin = parseFloat((zona === 'junin' ? '-33.20' : zona === 'rivadavia' ? '-33.25' : '-33.15'));
    const latMax = parseFloat((zona === 'san_martin' ? '-33.03' : '-33.03'));
    params.push(latMin);
    conds.push(`c.insp_geo_lat >= $${params.length}`);
    params.push(-33.03);
    conds.push(`c.insp_geo_lat <= $${params.length}`);
    const puntos = await q(`
    SELECT
      ROUND(c.insp_geo_lat::numeric, 6)::text AS lat,
      ROUND(c.insp_geo_lng::numeric, 6)::text AS lng,
      CASE
        WHEN c.estado='ACTIVO'          THEN 1.0
        WHEN c.estado='PAGO_PENDIENTE'  THEN 0.7
        WHEN c.estado='BORRADOR'        THEN 0.4
        ELSE 0.3
      END AS peso,
      c.numero_cit, c.estado,
      b.marca, b.modelo
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    WHERE ${conds.join(' AND ')}
    ORDER BY c.creado_en DESC
    LIMIT 500
  `, params);
    // También propietarios (radio mayor)
    const puntossProp = await q(`
    SELECT
      ROUND(c.prop_geo_lat::numeric, 6)::text AS lat,
      ROUND(c.prop_geo_lng::numeric, 6)::text AS lng
    FROM cits c
    WHERE c.prop_geo_lat IS NOT NULL
      AND c.prop_geo_lat >= -33.15 AND c.prop_geo_lat <= -33.03
    LIMIT 300
  `, []);
    // Resumen estadístico
    const stats = await q(`
    SELECT
      ROUND(AVG(c.insp_geo_lat)::numeric,5) AS lat_centro,
      ROUND(AVG(c.insp_geo_lng)::numeric,5) AS lng_centro,
      COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE c.estado='ACTIVO')::int AS activos,
      COUNT(*) FILTER(WHERE c.estado='BORRADOR')::int AS borradores
    FROM cits c WHERE c.insp_geo_lat IS NOT NULL
      AND c.insp_geo_lat >= -33.15 AND c.insp_geo_lat <= -33.03
  `, []);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
        ok: true,
        data: {
            inspecciones: puntos.map(p => ({
                lat: parseFloat(p.lat),
                lng: parseFloat(p.lng),
                peso: p.peso,
                numeroCIT: p.numero_cit,
                estado: p.estado,
                vehiculo: p.marca + ' ' + p.modelo,
            })),
            propietarios: puntossProp.map(p => ({
                lat: parseFloat(p.lat),
                lng: parseFloat(p.lng),
            })),
            centro: stats[0] ? {
                lat: parseFloat(stats[0].lat_centro),
                lng: parseFloat(stats[0].lng_centro),
            } : { lat: -33.0715, lng: -68.4712 },
            stats: stats[0] ?? {},
            zona: zona ?? 'zona_este',
            generado: new Date().toISOString(),
        },
    });
});
// ══════════════════════════════════════════════════════════
// CIT VALIDACIÓN EN TIEMPO REAL — SSE + Polling
// ══════════════════════════════════════════════════════════
// GET /cit/:id/rt — stream SSE del estado de validación 72h
r.get('/cit/:id/rt', rateLimiter_1.burstRateLimit, async (req, res) => {
    const citId = req.params.id; // acepta UUID o RCIT-2026-00041
    (0, cit_validacion_rt_service_1.sseValidacion)(citId, res);
    // Cleanup al cerrar el handler (Express no lo corre automáticamente en SSE)
});
// GET /cit/:id/poll — snapshot JSON para polling (fallback)
r.get('/cit/:id/poll', rateLimiter_1.burstRateLimit, async (req, res) => {
    const snap = await (0, cit_validacion_rt_service_1.getValidacionSnapshot)(req.params.id);
    if (!snap) {
        res.status(404).json({ ok: false, error: 'CIT no encontrado' });
        return;
    }
    // Cache de 3s (el cliente puede reducir la frecuencia de polling)
    res.set('Cache-Control', 'public, max-age=3');
    res.json({ ok: true, data: snap });
});
// POST /cit/:id/rt/evento — publicar transición de fase (inspector/admin)
r.post('/cit/:id/rt/evento', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const body = zod_1.z.object({
        fase: zod_1.z.enum(['FOTOS_OK', 'PUNTUACION_OK', 'FIRMA_PENDIENTE', 'TASA_PENDIENTE', 'BFA_PENDING', 'COMPLETADA', 'RECHAZADA', 'INICIADA']),
        progresoPct: zod_1.z.coerce.number().int().min(0).max(100).optional(),
    }).parse(req.body);
    await (0, cit_validacion_rt_service_1.publicarEventoValidacion)(req.params.id, body.fase, { progresoPct: body.progresoPct });
    res.json({ ok: true, mensaje: `Evento ${body.fase} publicado via SSE`, citId: req.params.id });
});
// GET /admin/cit/validaciones-activas — dashboard de validaciones en curso
r.get('/admin/cit/validaciones-activas', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { limite } = zod_1.z.object({ limite: zod_1.z.coerce.number().int().default(20) }).parse(req.query);
    res.json({ ok: true, data: await (0, cit_validacion_rt_service_1.getValidacionesActivas)(limite) });
});
// GET /admin/cit/validaciones-activas/rt — SSE del dashboard global
r.get('/admin/cit/validaciones-activas/rt', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    (0, cit_validacion_rt_service_1.sseValidacion)('global', res);
});
// ══════════════════════════════════════════════════════════
// GET /cit/:id — Estado real del CIT (UUID o numeroCIT)
// Público: acepta UUID o numero_cit (RCIT-2026-00041)
// Responde el estado EFECTIVO calculado: VIGENTE / EXPIRADO
// / VIGENTE_SIN_TASA / VIGENTE_SIN_NFT / LISTO_PARA_PAGO
// / INSPECCION_INCOMPLETA / PAGO_PENDIENTE / BLOQUEADO
// ══════════════════════════════════════════════════════════
r.get('/cit/:id', rateLimiter_1.burstRateLimit, async (req, res) => {
    const idOrNumero = req.params.id; // acepta UUID o RCIT-2026-00041
    const cit = await (0, cit_estado_service_1.getCITEstado)(idOrNumero);
    if (!cit) {
        res.status(404).json({
            ok: false,
            error: 'CIT no encontrado',
            hint: 'Verificar UUID o número de CIT (RCIT-AAAA-NNNNN)',
        });
        return;
    }
    // Enmascarar DNI en respuesta pública (solo últimos 3 dígitos)
    const resp = {
        ...cit,
        propietario: {
            ...cit.propietario,
            dni: cit.propietario.dni
                ? '**' + cit.propietario.dni.slice(-3)
                : '—',
        },
    };
    res.json({ ok: true, data: resp });
});
// GET /cit/numero/:numeroCIT — lookup explícito por número
r.get('/cit/numero/:numeroCIT', rateLimiter_1.burstRateLimit, async (req, res) => {
    const cit = await (0, cit_estado_service_1.getCITEstadoPorNumero)(req.params.numeroCIT.toUpperCase());
    if (!cit) {
        res.status(404).json({ ok: false, error: 'CIT no encontrado' });
        return;
    }
    res.json({ ok: true, data: cit });
});
// ══════════════════════════════════════════════════════════
// CIT PDF-DATA — payload optimizado para client-side PDF
// ══════════════════════════════════════════════════════════
// GET /cit/:id/pdf-data
// Retorna todos los datos del CIT + QR como data URI PNG
// (generado server-side con qr.service.ts para calidad óptima)
// Cache 5 min (el CIT no cambia entre descargas)
r.get('/cit/:id/pdf-data', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { queryOne: q1 } = await import('../config/database');
    const { buildVerificadorURL, generarQR } = await import('../services/qr.service');
    // Cargar datos del CIT con todos los joins necesarios para el PDF
    const cit = await q1(`
    SELECT
      c.id::text, c.numero_cit, c.estado, c.puntos_total,
      c.hash_sha256, c.fecha_emision, c.fecha_vencimiento,
      c.tasa_pagada, c.nft_token_id,
      b.marca, b.modelo, b.numero_serie,
      u.nombre, u.apellido,
      ca.score    AS cert_score,
      ca.nivel    AS cert_nivel,
      ca.numero   AS cert_numero,
      ca.asegurable AS cert_asegurable,
      p.numero_poliza, p.prima_final, aseg.nombre AS aseguradora,
      c.zona_vencimiento,
      EXTRACT(EPOCH FROM (c.fecha_vencimiento - NOW()))/86400 AS dias_restantes
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    JOIN usuarios u ON u.id = c.propietario_id
    LEFT JOIN certificados_asegurabilidad ca
      ON ca.cit_id = c.id
      ORDER BY ca.creado_en DESC LIMIT 1
    LEFT JOIN seguros_polizas p
      ON p.bicicleta_id = b.id AND p.estado = 'ACTIVA'
    LEFT JOIN seguros_aseguradoras aseg ON aseg.id = p.aseguradora_id
    WHERE c.id = $1::uuid AND c.propietario_id = $2::uuid
    LIMIT 1
  `, [req.params.id, req.user.sub]);
    if (!cit) {
        res.status(404).json({ ok: false, error: 'CIT no encontrado' });
        return;
    }
    // Generar QR apuntando a /verificar/:serial
    const qrURL = buildVerificadorURL(cit.numero_serie);
    let qrDataURI = null;
    let qrSVG = null;
    try {
        const qr = await generarQR(cit.numero_serie, { moduleSize: 8, errorCorrectionLevel: 'M' });
        qrDataURI = qr.dataUriPNG;
        qrSVG = qr.svg;
    }
    catch { /* QR opcional — el PDF se genera igual */ }
    res.set('Cache-Control', 'private, max-age=300');
    res.json({
        ok: true,
        data: {
            // CIT fields
            id: cit.id,
            numeroCIT: cit.numero_cit,
            estado: cit.estado,
            puntosTotal: cit.puntos_total,
            hashSHA256: cit.hash_sha256,
            fechaEmision: cit.fecha_emision,
            fechaVencimiento: cit.fecha_vencimiento,
            diasRestantes: Math.floor(Number(cit.dias_restantes ?? 0)),
            tasaPagada: !!cit.tasa_pagada,
            nftTokenId: cit.nft_token_id ?? null,
            zonaVencimiento: cit.zona_vencimiento,
            // Bicicleta
            marca: cit.marca,
            modelo: cit.modelo,
            numeroSerie: cit.numero_serie,
            // Propietario
            nombre: cit.nombre,
            apellido: cit.apellido,
            // Cert. asegurabilidad
            certScore: cit.cert_score ? parseFloat(cit.cert_score) : null,
            certNivel: cit.cert_nivel ?? null,
            certNumero: cit.cert_numero ?? null,
            // Póliza
            poliza: cit.numero_poliza
                ? { numeroPoliza: cit.numero_poliza, prima: cit.prima_final, aseguradora: cit.aseguradora }
                : null,
            // QR
            qrURL,
            qrDataURI,
            qrSVG,
            // Metadata
            generadoEn: new Date().toISOString(),
        }
    });
});
// GET /verificar/:serial (público) — alias para el verificador sin auth
r.get('/verificar/:serial', rateLimiter_1.burstRateLimit, async (req, res) => {
    const { queryOne: q1 } = await import('../config/database');
    const serial = decodeURIComponent(req.params.serial).trim().toUpperCase();
    const cit = await q1(`
    SELECT c.numero_cit, c.estado, c.hash_sha256, c.fecha_vencimiento,
           c.puntos_total, c.nft_token_id, c.tasa_pagada,
           b.marca, b.modelo, b.numero_serie,
           u.nombre, u.apellido
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    JOIN usuarios u ON u.id = c.propietario_id
    WHERE UPPER(b.numero_serie) = $1
    ORDER BY c.creado_en DESC LIMIT 1
  `, [serial]);
    if (!cit) {
        res.status(404).json({ ok: false, error: 'Serial no registrado en RODAID' });
        return;
    }
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ok: true, data: {
            numeroCIT: cit.numero_cit,
            estado: cit.estado,
            hashSHA256: cit.hash_sha256,
            fechaVencimiento: cit.fecha_vencimiento,
            puntosTotal: cit.puntos_total,
            nftTokenId: cit.nft_token_id,
            tasaPagada: !!cit.tasa_pagada,
            bicicleta: { marca: cit.marca, modelo: cit.modelo, serial: cit.numero_serie },
            propietario: { nombre: cit.nombre, apellido: cit.apellido },
            verificadoEn: new Date().toISOString(),
        } });
});
// ══════════════════════════════════════════════════════════
// MINSEG mTLS · Convenio técnico + endpoints seguros
// ══════════════════════════════════════════════════════════
// GET /admin/minseg/convenio — estado del convenio técnico
r.get('/admin/minseg/convenio', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getConvenioEstado } = await import('../services/minseg.mtls.service');
    const estado = await getConvenioEstado();
    res.json({ ok: true, data: estado });
});
// POST /admin/minseg/convenio/avanzar — avanzar fase del convenio
r.post('/admin/minseg/convenio/avanzar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { avanzarFase } = await import('../services/minseg.mtls.service');
    const body = zod_1.z.object({
        fase: zod_1.z.enum(['INICIADO', 'CSR_GENERADO', 'EN_REVISION', 'CERT_EMITIDO', 'SANDBOX_ACTIVO', 'PRODUCCION', 'SUSPENDIDO', 'VENCIDO']),
        expedienteNro: zod_1.z.string().optional(),
        emailMinSeg: zod_1.z.string().email().optional(),
        notas: zod_1.z.string().optional(),
    }).parse(req.body);
    const result = await avanzarFase(body.fase, body);
    res.json({ ok: true, data: result });
});
// POST /admin/minseg/mtls/generar-csr — generar Certificate Signing Request
r.post('/admin/minseg/mtls/generar-csr', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { generarCSR } = await import('../services/minseg.mtls.service');
    const body = zod_1.z.object({
        cn: zod_1.z.string().default('rodaid.net'),
        org: zod_1.z.string().default('RODAID SAS'),
        ou: zod_1.z.string().default('Certificacion Bicicletas'),
        country: zod_1.z.string().length(2).default('AR'),
        state: zod_1.z.string().default('Mendoza'),
        locality: zod_1.z.string().default('San Martin'),
        email: zod_1.z.string().email().default('infra@rodaid.net'),
        keyBits: zod_1.z.union([zod_1.z.literal(2048), zod_1.z.literal(4096)]).default(4096),
        validDays: zod_1.z.coerce.number().int().default(730),
    }).parse(req.body);
    const csr = await generarCSR(body);
    res.json({ ok: true, data: csr });
});
// POST /admin/minseg/mtls/registrar-cert — registrar cert recibido de MinSeg
r.post('/admin/minseg/mtls/registrar-cert', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { registrarCertificadoRecibido } = await import('../services/minseg.mtls.service');
    const body = zod_1.z.object({
        certPEM: zod_1.z.string().min(100),
        tipo: zod_1.z.enum(['CERT_RODAID', 'CERT_MINSEG_CA', 'CERT_MINSEG_SERVER']),
        notas: zod_1.z.string().optional(),
    }).parse(req.body);
    const result = await registrarCertificadoRecibido(body);
    res.json({ ok: true, data: result });
});
// POST /admin/minseg/mtls/activar-sandbox — activar fase sandbox
r.post('/admin/minseg/mtls/activar-sandbox', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { activarSandbox } = await import('../services/minseg.mtls.service');
    const result = await activarSandbox();
    res.json({ ok: result.ok, data: result });
});
// GET /admin/minseg/health — health check del canal mTLS
r.get('/admin/minseg/health', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { healthCheck } = await import('../services/minseg.mtls.service');
    const hc = await healthCheck();
    res.status(hc.ok ? 200 : 502).json({ ok: hc.ok, data: hc });
});
// GET /admin/minseg/health/historial — últimos N health checks
r.get('/admin/minseg/health/historial', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { getHealthHistory } = await import('../services/minseg.mtls.service');
    const { limit } = zod_1.z.object({ limit: zod_1.z.coerce.number().int().default(20) }).parse(req.query);
    const historial = await getHealthHistory(limit);
    res.json({ ok: true, data: historial, total: historial.length });
});
// GET /admin/minseg/resumen — dashboard operacional completo
r.get('/admin/minseg/resumen', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getResumenOperacional } = await import('../services/minseg.mtls.service');
    const resumen = await getResumenOperacional();
    res.json({ ok: true, data: resumen });
});
// GET /admin/minseg/protocolo — contrato técnico completo (para el convenio)
r.get('/admin/minseg/protocolo', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { PROTOCOLO_DESCRIPCION } = await import('../services/minseg.protocol.service');
    const { getConvenioEstado } = await import('../services/minseg.mtls.service');
    const convenio = await getConvenioEstado();
    res.json({ ok: true, data: { protocolo: PROTOCOLO_DESCRIPCION, convenio } });
});
// POST /admin/minseg/denuncia-test — probar notificación de robo en modo STUB
r.post('/admin/minseg/denuncia-test', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { reportarDenuncia } = await import('../services/minseg.service');
    const body = zod_1.z.object({
        serial: zod_1.z.string().min(3),
        propietarioDNI: zod_1.z.string().min(7),
        propietarioNombre: zod_1.z.string().min(3),
        descripcion: zod_1.z.string().default('Test de denuncia STUB'),
        citId: zod_1.z.string().uuid().optional(),
    }).parse(req.body);
    const result = await reportarDenuncia({
        denunciaRodaidId: `test-${Date.now()}`,
        serial: body.serial,
        propietarioDNI: body.propietarioDNI,
        propietarioNombre: body.propietarioNombre,
        descripcion: body.descripcion,
        numeroCIT: 'RCIT-TEST',
        marca: 'Test',
        modelo: 'Test',
        anio: 2024,
        color: 'Negro',
        fechaDenuncia: new Date().toISOString(),
    });
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// MINSEG · Endpoints INBOUND
// ══════════════════════════════════════════════════════════
async function autenticarMinSeg(req, res, next) {
    const { verificarAutenticidadMinSeg } = await import('../services/minseg.inbound.service');
    const apiKey = req.headers['x-minseg-key'] ?? '';
    const firma = req.headers['x-minseg-firma'];
    const nonce = req.headers['x-minseg-nonce'] ?? '';
    const modo = (process.env.MINSEG_CERT_PEM ? 'LIVE' : 'STUB');
    if (!apiKey || !nonce) {
        res.status(401).json({ ok: false, error: 'Headers requeridos' });
        return;
    }
    const auth = verificarAutenticidadMinSeg({ apiKey, firma, nonce, payload: JSON.stringify(req.body), modo });
    if (!auth.ok) {
        res.status(401).json({ ok: false, error: auth.motivo });
        return;
    }
    req.minsegModo = modo;
    req.minsegCN = 'MinSeg-STUB';
    next();
}
r.get('/minseg/health', rateLimiter_1.burstRateLimit, async (_req, res) => {
    const { getHealthResponse } = await import('../services/minseg.inbound.service');
    res.json(getHealthResponse());
});
r.post('/minseg/consulta-serial', rateLimiter_1.burstRateLimit, autenticarMinSeg, async (req, res) => {
    const { consultarSerialInbound } = await import('../services/minseg.inbound.service');
    const body = zod_1.z.object({
        serialHash: zod_1.z.string().length(64),
        tipoConsulta: zod_1.z.enum(['VERIFICACION', 'BATCH', 'DENUNCIA']).default('VERIFICACION'),
        nonce: zod_1.z.string().min(10),
    }).parse(req.body);
    const resultado = await consultarSerialInbound(body, {
        ip: req.ip ?? '0.0.0.0', cn: req.minsegCN, modo: req.minsegModo,
    });
    res.json({ ok: true, data: resultado });
});
r.post('/minseg/alerta-robo', rateLimiter_1.burstRateLimit, autenticarMinSeg, async (req, res) => {
    const { recibirAlertaRobo } = await import('../services/minseg.inbound.service');
    const body = zod_1.z.object({
        serialHash: zod_1.z.string().length(64),
        denunciaNro: zod_1.z.string().min(3),
        dependencia: zod_1.z.string().min(3),
        descripcion: zod_1.z.string().optional(),
        lat: zod_1.z.coerce.number().optional(),
        lng: zod_1.z.coerce.number().optional(),
        nonce: zod_1.z.string().min(10),
    }).parse(req.body);
    const resultado = await recibirAlertaRobo(body, {
        ip: req.ip ?? '0.0.0.0', cn: req.minsegCN, modo: req.minsegModo,
    });
    res.status(201).json({ ok: resultado.ok, data: resultado });
});
r.get('/minseg/protocolo-spec', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getProtocoloEspecificacion } = await import('../services/minseg.inbound.service');
    res.json({ ok: true, data: getProtocoloEspecificacion() });
});
r.get('/admin/minseg/inbound/resumen', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getResumenInbound } = await import('../services/minseg.inbound.service');
    res.json({ ok: true, data: await getResumenInbound() });
});
r.get('/admin/minseg/convenio/estado', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getConvenioEstado } = await import('../services/minseg.mtls.service');
    const convenio = await getConvenioEstado();
    res.json({ ok: true, data: convenio });
});
r.post('/admin/minseg/convenio/avanzar-fase', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { avanzarFase } = await import('../services/minseg.mtls.service');
    const body = zod_1.z.object({
        fase: zod_1.z.enum(['INICIADO', 'CSR_GENERADO', 'EN_REVISION', 'CERT_EMITIDO', 'SANDBOX_ACTIVO', 'PRODUCCION', 'SUSPENDIDO', 'VENCIDO']),
        expedienteNro: zod_1.z.string().optional(),
        notas: zod_1.z.string().optional(),
        emailMinSeg: zod_1.z.string().email().optional(),
    }).parse(req.body);
    const resultado = await avanzarFase(body.fase, body);
    res.json({ ok: true, data: resultado });
});
r.post('/admin/minseg/csr/generar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { generarCSR } = await import('../services/minseg.mtls.service');
    const body = zod_1.z.object({
        cn: zod_1.z.string().default('rodaid.net'), org: zod_1.z.string().default('RODAID SAS'),
        ou: zod_1.z.string().default('Certificacion Bicicletas'), country: zod_1.z.string().length(2).default('AR'),
        state: zod_1.z.string().default('Mendoza'), locality: zod_1.z.string().default('San Martin'),
        email: zod_1.z.string().email().default('infra@rodaid.net'),
        keyBits: zod_1.z.union([zod_1.z.literal(2048), zod_1.z.literal(4096)]).default(4096),
        validDays: zod_1.z.coerce.number().int().default(730),
    }).parse(req.body);
    const resultado = await generarCSR(body);
    res.json({ ok: true, data: resultado });
});
r.post('/admin/minseg/health-check', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { healthCheck } = await import('../services/minseg.mtls.service');
    const resultado = await healthCheck();
    res.json({ ok: resultado.ok, data: resultado });
});
r.post('/admin/minseg/simular-consulta', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { consultarSerialInbound } = await import('../services/minseg.inbound.service');
    const { serial } = zod_1.z.object({ serial: zod_1.z.string().min(4) }).parse(req.body);
    const crypto = await import('crypto');
    const serialHash = crypto.createHash('sha256').update(serial.toUpperCase()).digest('hex');
    const resultado = await consultarSerialInbound({ serialHash, tipoConsulta: 'VERIFICACION', nonce: new Date().toISOString() }, { ip: '127.0.0.1', cn: 'MinSeg-Test', modo: 'STUB' });
    res.json({ ok: true, data: { serialHash, ...resultado } });
});
// ══════════════════════════════════════════════════════════
// TRANSFERENCIA DE DOMINIO — endpoints
// ══════════════════════════════════════════════════════════
// GET /transferencias/:id — datos del certificado
r.get('/transferencias/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getDatosCertificado } = await import('../services/dominio.transfer.service');
    const datos = await getDatosCertificado(req.params.id);
    if (!datos) {
        res.status(404).json({ ok: false, error: 'Transferencia no encontrada' });
        return;
    }
    res.json({ ok: true, data: datos });
});
// GET /transferencias/:id/pdf-data — payload para generar el PDF del certificado
r.get('/transferencias/:id/pdf-data', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getDatosCertificado } = await import('../services/dominio.transfer.service');
    const { generarQR } = await import('../services/qr.service');
    const datos = await getDatosCertificado(req.params.id);
    if (!datos) {
        res.status(404).json({ ok: false, error: 'Transferencia no encontrada' });
        return;
    }
    const qr = await generarQR(datos.bicicleta.numeroSerie, { moduleSize: 8 }).catch(() => null);
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ ok: true, data: { ...datos, qrDataURI: qr?.dataUriPNG ?? null } });
});
// GET /bicicletas/:id/historial-dominio — historial de propietarios de una bicicleta
r.get('/bicicletas/:id/historial-dominio', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getHistorialDominio } = await import('../services/dominio.transfer.service');
    const historial = await getHistorialDominio(req.params.id);
    res.json({ ok: true, data: historial, total: historial.length });
});
// POST /admin/transferencias/manual — disparar transferencia manualmente (admin / testing)
r.post('/admin/transferencias/manual', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { iniciarTransferenciaDominio } = await import('../services/dominio.transfer.service');
    const body = zod_1.z.object({
        transaccionId: zod_1.z.string().uuid(),
        citId: zod_1.z.string().uuid(),
        vendedorId: zod_1.z.string().uuid(),
        compradorId: zod_1.z.string().uuid(),
        precioArs: zod_1.z.coerce.number().positive(),
        comisionArs: zod_1.z.coerce.number().default(0),
    }).parse(req.body);
    const resultado = await iniciarTransferenciaDominio({ ...body, ip: req.ip });
    res.json({ ok: resultado.ok, data: resultado });
});
// ══════════════════════════════════════════════════════════
// MINSEG CONVENIO TÉCNICO — Panel de gestión de fases
// ══════════════════════════════════════════════════════════
// GET /admin/minseg/convenio/checklist — checklist completo por fase
r.get('/admin/minseg/convenio/checklist', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (_req, res) => {
    const { getConvenioChecklist } = await import('../services/minseg.convenio.service');
    const checklist = await getConvenioChecklist();
    if (!checklist) {
        res.status(404).json({ ok: false, error: 'Sin convenio activo' });
        return;
    }
    res.json({ ok: true, data: checklist });
});
// POST /admin/minseg/api-keys/generar — registrar API Key de MinSeg
r.post('/admin/minseg/api-keys/generar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { registrarApiKeyMinSeg } = await import('../services/minseg.convenio.service');
    const body = zod_1.z.object({
        descripcion: zod_1.z.string().min(5),
        permisos: zod_1.z.array(zod_1.z.string()).default(['consulta-serial', 'alerta-robo', 'recuperacion']),
        expirarDias: zod_1.z.coerce.number().int().positive().default(365),
    }).parse(req.body);
    const expirarEn = new Date(Date.now() + body.expirarDias * 86400_000);
    const key = await registrarApiKeyMinSeg({ ...body, expirarEn });
    // IMPORTANTE: retornar rawKey solo UNA VEZ — luego no se puede recuperar
    res.status(201).json({ ok: true, data: key,
        advertencia: 'Guardá la rawKey ahora — no se puede recuperar después' });
});
// POST /admin/minseg/simular-cliente — simular llamada de MinSeg para testing
r.post('/admin/minseg/simular-cliente', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { simularClienteMinSeg } = await import('../services/minseg.convenio.service');
    const body = zod_1.z.object({
        endpoint: zod_1.z.enum(['consulta-serial', 'alerta-robo', 'recuperacion', 'health']),
        serial: zod_1.z.string().optional(),
        apiKey: zod_1.z.string().optional(),
        baseUrl: zod_1.z.string().url().optional(),
    }).parse(req.body);
    const resultado = await simularClienteMinSeg(body);
    res.json({ ok: true, data: resultado });
});
// POST /minseg/recuperacion — recuperación de bicicleta (MinSeg → RODAID)
r.post('/minseg/recuperacion', rateLimiter_1.burstRateLimit, autenticarMinSegInbound, async (req, res) => {
    const { procesarRecuperacionMinSeg } = await import('../services/minseg.recuperacion.service');
    const body = zod_1.z.object({
        serialHash: zod_1.z.string().length(64),
        denunciaNro: zod_1.z.string().min(3),
        dependencia: zod_1.z.string().min(3),
        novedades: zod_1.z.string().optional(),
        nonce: zod_1.z.string().min(10),
    }).parse(req.body);
    const resultado = await procesarRecuperacionMinSeg({
        rawBody: JSON.stringify(body),
        signature: req.headers['x-minseg-firma'] ?? '',
        timestamp: body.nonce,
        eventId: req.headers['x-minseg-event-id'] ?? require('crypto').randomUUID(),
        ipOrigen: req.ip ?? '0.0.0.0',
    });
    res.json({ ok: resultado.procesado, data: resultado });
});
// ══════════════════════════════════════════════════════════
// INSPECTOR PANEL · Endpoints del Panel de Gestión
// ══════════════════════════════════════════════════════════
// GET /inspector/cola — bicis con CIT en BORRADOR o SIN CIT asignadas al taller
r.get('/inspector/cola', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    if (!['INSPECTOR', 'ADMIN', 'ALIADO'].includes(req.user.rol)) {
        res.status(403).json({ ok: false, error: 'Solo inspectores' });
        return;
    }
    const { query: q } = await import('../config/database');
    const inspRow = await import('../config/database')
        .then(db => db.queryOne(`SELECT taller_aliado_id::text FROM inspectores WHERE usuario_id=$1::uuid AND activo=TRUE`, [req.user.sub]));
    const tallerId = inspRow?.taller_aliado_id ?? null;
    // Bicis que tienen CIT en BORRADOR (inspección incompleta) o sin CIT activo
    const pendientes = await q(`
    SELECT DISTINCT ON (b.id)
      b.id::text      AS bicicleta_id,
      b.marca, b.modelo, b.numero_serie,
      u.nombre        AS propietario_nombre,
      u.apellido      AS propietario_apellido,
      u.email         AS propietario_email,
      c.id::text      AS cit_id,
      c.numero_cit,
      c.estado        AS cit_estado,
      c.puntos_total,
      c.creado_en     AS cit_iniciado_en,
      EXTRACT(EPOCH FROM (NOW() - c.creado_en))/3600 AS horas_transcurridas
    FROM bicicletas b
    JOIN usuarios u ON u.id = b.propietario_id
    LEFT JOIN cits c ON c.bicicleta_id = b.id
      AND c.estado IN ('BORRADOR','ACTIVO')
    WHERE b.propietario_id != '00000000-0000-0000-0000-000000000000'::uuid
    ORDER BY b.id, c.creado_en DESC NULLS LAST
    LIMIT 20
  `, []);
    res.json({ ok: true, data: pendientes, total: pendientes.length });
});
// GET /inspector/mis-cits-hoy — CITs emitidos por este inspector hoy
r.get('/inspector/mis-cits-hoy', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q, queryOne: q1 } = await import('../config/database');
    const insp = await q1(`SELECT id::text FROM inspectores WHERE usuario_id=$1::uuid AND activo=TRUE`, [req.user.sub]);
    if (!insp) {
        res.json({ ok: true, data: [], total: 0, puntos_emitidos: 0 });
        return;
    }
    const cits = await q(`
    SELECT c.numero_cit, c.estado, c.puntos_total,
           c.creado_en, b.marca, b.modelo, b.numero_serie,
           u.nombre, u.apellido
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    JOIN usuarios u ON u.id = c.propietario_id
    WHERE c.inspector_id = $1::uuid
      AND c.creado_en::date = CURRENT_DATE
    ORDER BY c.creado_en DESC
  `, [insp.id]);
    const puntosTotal = cits.reduce((s, c) => s + (c.puntos_total ?? 0), 0);
    res.json({ ok: true, data: cits, total: cits.length, puntos_emitidos: puntosTotal });
});
// GET /inspector/bicicleta/:id/historial — historial CIT de una bici
r.get('/inspector/bicicleta/:id/historial', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q } = await import('../config/database');
    const cits = await q(`
    SELECT c.id::text, c.numero_cit, c.estado, c.puntos_total,
           c.hash_sha256, c.fecha_emision, c.fecha_vencimiento, c.tasa_pagada,
           ui.nombre AS inspector_nombre, ui.apellido AS inspector_apellido,
           ta.nombre AS taller
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    LEFT JOIN inspectores i ON i.id = c.inspector_id
    LEFT JOIN usuarios ui ON ui.id = i.usuario_id
    LEFT JOIN talleres_aliados ta ON ta.id = c.taller_aliado_id
    WHERE b.id = $1::uuid
    ORDER BY c.creado_en DESC LIMIT 10
  `, [req.params.id]);
    res.json({ ok: true, data: cits });
});
// PATCH /inspector/cit/:id/puntos — actualizar puntos parciales (BORRADOR)
r.patch('/inspector/cit/:id/puntos', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q } = await import('../config/database');
    const body = zod_1.z.object({
        puntos: zod_1.z.record(zod_1.z.boolean()),
        observaciones: zod_1.z.record(zod_1.z.string()).optional(),
    }).parse(req.body);
    const puntosTotal = Object.values(body.puntos).filter(Boolean).length;
    await q(`
    UPDATE cits SET
      puntos_total  = $2,
      punto_detalle = $3::jsonb,
      actualizado_en = NOW()
    WHERE id = $1::uuid AND estado IN ('BORRADOR','ACTIVO')
  `, [req.params.id, puntosTotal, JSON.stringify({ puntos: body.puntos, observaciones: body.observaciones ?? {} })]);
    // Recalcular zona si el CIT ya tiene fecha
    const { evaluarZonaCIT } = await import('../services/cit.decision.tree');
    evaluarZonaCIT(req.params.id).catch(() => { });
    res.json({ ok: true, data: { puntosTotal, estado: puntosTotal >= 15 ? 'APTO' : 'INSUFICIENTE' } });
});
// POST /inspector/cit/:id/aprobar — finalizar inspección y disparar bridge
r.post('/inspector/cit/:id/aprobar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q, queryOne: q1 } = await import('../config/database');
    const body = zod_1.z.object({
        puntos: zod_1.z.record(zod_1.z.boolean()),
        observaciones: zod_1.z.record(zod_1.z.string()).optional(),
        djFirmada: zod_1.z.boolean(),
        motivo_rechazo: zod_1.z.string().optional(),
    }).parse(req.body);
    if (!body.djFirmada) {
        res.status(422).json({ ok: false, error: 'Declaración jurada requerida' });
        return;
    }
    const puntosTotal = Object.values(body.puntos).filter(Boolean).length;
    const aprobado = puntosTotal >= 15;
    const estado = aprobado ? 'ACTIVO' : 'BORRADOR';
    await q(`
    UPDATE cits SET
      estado         = $2,
      puntos_total   = $3,
      punto_detalle  = $4::jsonb,
      motivo_rechazo = $5,
      fecha_emision  = CASE WHEN $2='ACTIVO' THEN NOW() ELSE fecha_emision END,
      fecha_vencimiento = CASE WHEN $2='ACTIVO' THEN NOW() + INTERVAL '1 year' ELSE fecha_vencimiento END,
      actualizado_en = NOW()
    WHERE id = $1::uuid
  `, [req.params.id, estado, puntosTotal,
        JSON.stringify({ puntos: body.puntos, observaciones: body.observaciones ?? {} }),
        body.motivo_rechazo ?? null]);
    // Cargar datos para el bridge
    const cit = await q1(`
    SELECT c.id::text,c.numero_cit,c.propietario_id::text,
           b.marca,b.modelo,b.numero_serie
    FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
    WHERE c.id=$1::uuid
  `, [req.params.id]);
    if (cit) {
        const { triggerCITAprobado, triggerCITRechazado } = await import('../services/cit.decision.tree');
        if (aprobado) {
            triggerCITAprobado({
                citId: cit.id, usuarioId: cit.propietario_id,
                numeroCIT: cit.numero_cit, serial: cit.numero_serie,
                marca: cit.marca, modelo: cit.modelo, txHash: `insp:${req.params.id}`,
            });
        }
        else {
            triggerCITRechazado({
                citId: cit.id, usuarioId: cit.propietario_id,
                numeroCIT: cit.numero_cit, serial: cit.numero_serie,
                motivo: body.motivo_rechazo ?? `Puntos insuficientes: ${puntosTotal}/20 (mínimo 15)`,
            });
        }
    }
    res.json({
        ok: true,
        data: {
            citId: req.params.id,
            numeroCIT: cit?.numero_cit,
            estado,
            puntosTotal,
            aprobado,
            resultado: aprobado ? 'CIT_APROBADO' : 'CIT_RECHAZADO',
        }
    });
});
// ══════════════════════════════════════════════════════════
// RODAID PAY — flujo completo MP + Escrow + Notificaciones
// ══════════════════════════════════════════════════════════
// POST /mp/cit/:id/preferencia — crear preferencia MP para pago de tasa CIT
// Retorna: { initPoint, preferenceId, gateway }
r.post('/mp/cit/:id/preferencia', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { crearPreferencia } = await import('../services/mercadopago.service');
    const { queryOne: q1 } = await import('../config/database');
    const cit = await q1(`
    SELECT c.id::text, c.numero_cit, c.tasa_pagada, c.estado,
           b.marca, b.modelo, b.numero_serie,
           u.email, u.nombre, u.apellido
    FROM cits c
    JOIN bicicletas b ON b.id = c.bicicleta_id
    JOIN usuarios u ON u.id = c.propietario_id
    WHERE c.id = $1::uuid AND c.propietario_id = $2::uuid
  `, [req.params.id, req.user.sub]);
    if (!cit) {
        res.status(404).json({ ok: false, error: 'CIT no encontrado' });
        return;
    }
    if (cit.tasa_pagada) {
        res.status(409).json({ ok: false, error: 'Tasa ya pagada' });
        return;
    }
    if (cit.estado !== 'ACTIVO' && cit.estado !== 'BORRADOR') {
        res.status(400).json({ ok: false, error: 'CIT no elegible para pago de tasa' });
        return;
    }
    const TASA_CIT_ARS = 300000; // $3.000 ARS en centavos
    const baseUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.net';
    const pref = await crearPreferencia({
        transaccionId: `CIT-${cit.id}`, // prefijo para detectar en webhook
        monto: TASA_CIT_ARS,
        titulo: `Tasa CIT — ${cit.marca} ${cit.modelo}`,
        descripcion: `${cit.numero_cit} · Ley Provincial N° 9556 · Mendoza`,
        compradorEmail: cit.email,
        compradorNombre: `${cit.nombre} ${cit.apellido}`,
        returnUrl: `${baseUrl}/cit/${cit.id}?tasa=ok`,
        cancelUrl: `${baseUrl}/cit/${cit.id}?tasa=cancelado`,
        expirarEn: new Date(Date.now() + 2 * 3600_000), // 2 horas
    });
    res.json({ ok: true, data: {
            initPoint: pref.initPoint,
            preferenceId: pref.preferenceId,
            gateway: pref.gateway,
            modoMP: pref.gateway,
            numeroCIT: cit.numero_cit,
            monto: TASA_CIT_ARS,
            expiraEn: new Date(Date.now() + 2 * 3600_000).toISOString(),
        } });
});
// POST /mp/marketplace/preferencia — crear preferencia MP para compra en marketplace
r.post('/mp/marketplace/preferencia', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { crearPreferencia, getModo } = await import('../services/mercadopago.service');
    const { queryOne: q1 } = await import('../config/database');
    const body = zod_1.z.object({ publicacionId: zod_1.z.string().uuid() }).parse(req.body);
    // Crear transacción de escrow primero
    const { iniciarCompra } = await import('../services/escrow.service');
    const compra = await iniciarCompra({
        publicacionId: body.publicacionId,
        compradorId: req.user.sub,
    });
    if (!compra.transaccionId) {
        res.status(400).json({ ok: false, error: 'No se pudo iniciar la compra' });
        return;
    }
    const tx = await q1(`
    SELECT t.precio_ars, p.titulo, b.marca, b.modelo,
           u.email, u.nombre
    FROM transacciones t
    JOIN marketplace_publicaciones p ON p.id = t.publicacion_id
    JOIN bicicletas b ON b.id = t.bicicleta_id
    JOIN usuarios u ON u.id = t.comprador_id
    WHERE t.id = $1::uuid
  `, [compra.transaccionId]);
    if (!tx) {
        res.status(500).json({ ok: false, error: 'Error cargando transacción' });
        return;
    }
    const baseUrl = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.net';
    const pref = await crearPreferencia({
        transaccionId: compra.transaccionId,
        monto: Number(tx.precio_ars) * 100, // a centavos
        titulo: `${tx.marca} ${tx.modelo} · RODAID`,
        descripcion: tx.titulo ?? `Bicicleta ${tx.marca} ${tx.modelo}`,
        compradorEmail: tx.email,
        compradorNombre: tx.nombre,
        returnUrl: `${baseUrl}/compra/${compra.transaccionId}?estado=ok`,
        cancelUrl: `${baseUrl}/compra/${compra.transaccionId}?estado=cancelado`,
    });
    // Guardar preference_id en la transacción
    await q1(`UPDATE transacciones SET mp_preference_id=$1, link_pago=$2 WHERE id=$3::uuid`, [pref.preferenceId, pref.initPoint, compra.transaccionId]).catch(() => { });
    res.json({ ok: true, data: {
            transaccionId: compra.transaccionId,
            initPoint: pref.initPoint,
            preferenceId: pref.preferenceId,
            gateway: pref.gateway,
            monto: Number(tx.precio_ars),
        } });
});
// POST /webhooks/mp/sdk — webhook SDK con firma HMAC-SHA256 (alternativo al legacy)
// Ya existe — ahora le agrega el bridge de notificaciones
// GET /mp/estado — estado del gateway MP (modo, credenciales, cuenta)
r.get('/mp/estado', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (_req, res) => {
    const { getModo, getEstadoGateway } = await import('../services/mercadopago.service');
    const estado = await getEstadoGateway();
    res.json({ ok: true, data: { modoActual: getModo(), ...estado } });
});
// POST /admin/mp/bridge/test — probar el bridge manualmente
r.post('/admin/mp/bridge/test', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, async (req, res) => {
    const { procesarEventoMP } = await import('../services/mp.notif.bridge');
    const body = zod_1.z.object({
        paymentId: zod_1.z.string(),
        status: zod_1.z.enum(['approved', 'rejected', 'pending']),
        transaccionId: zod_1.z.string().uuid().optional(),
        esTaskaCIT: zod_1.z.boolean().default(false),
        citId: zod_1.z.string().uuid().optional(),
    }).parse(req.body);
    const result = await procesarEventoMP({ ...body, gateway: 'TEST' });
    res.json({ ok: true, data: result });
});
// ══════════════════════════════════════════════════════════
// NOTIFICACIONES · Árbol de decisión + scheduler manual
// ══════════════════════════════════════════════════════════
// POST /admin/notif/job-manual — ejecutar jobs manualmente (solo admin)
r.post('/admin/notif/job-manual', ...auth_1.authenticated, async (req, res) => {
    if (req.user.rol !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Solo ADMIN' });
        return;
    }
    const { ejecutarJobManual } = await import('../services/notif.scheduler');
    const resultado = await ejecutarJobManual();
    res.json({ ok: true, data: resultado });
});
// GET /admin/notif/zonas — resumen de zonas de vencimiento
r.get('/admin/notif/zonas', ...auth_1.authenticated, async (req, res) => {
    if (req.user.rol !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'Solo ADMIN' });
        return;
    }
    const { getResumenZonas } = await import('../services/cit.decision.tree');
    const zonas = await getResumenZonas();
    res.json({ ok: true, data: zonas });
});
// POST /notif/cit/:id/evaluar — evaluar zona de un CIT específico
r.post('/notif/cit/:id/evaluar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { evaluarZonaCIT } = await import('../services/cit.decision.tree');
    const resultado = await evaluarZonaCIT(req.params.id);
    res.json({ ok: true, data: resultado });
});
// GET /notificaciones — mis notificaciones in-app
r.get('/notificaciones', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { getMisNotificaciones } = await import('../services/notif.service');
    const page = parseInt(req.query.page ?? '1');
    const result = await getMisNotificaciones(req.user.sub, { page, limit: 20 });
    res.json({ ok: true, data: result });
});
// PATCH /notificaciones/:id/leida — marcar leída
r.patch('/notificaciones/:id/leida', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { marcarLeida } = await import('../services/notif.service');
    const ok = await marcarLeida(req.params.id, req.user.sub);
    res.json({ ok });
});
// POST /notificaciones/leer-todas
r.post('/notificaciones/leer-todas', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { marcarTodasLeidas } = await import('../services/notif.service');
    const count = await marcarTodasLeidas(req.user.sub);
    res.json({ ok: true, data: { marcadas: count } });
});
// DELETE /device-tokens/:id — desregistrar token
r.delete('/device-tokens/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, async (req, res) => {
    const { query: q } = await import('../config/database');
    await q(`UPDATE device_tokens SET valido=FALSE, activo=FALSE, motivo_baja='USUARIO_DESREGISTRO'
     WHERE id=$1::uuid AND usuario_id=$2::uuid`, [req.params.id, req.user.sub]);
    res.json({ ok: true });
});
// ══════════════════════════════════════════════════════════
// GARAJE DIGITAL — Bicicletas
// ══════════════════════════════════════════════════════════
r.get('/usuario/bicicletas', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('bicicletas:read'), bicicletas_controller_1.getBicicletas);
r.post('/usuario/bicicletas', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('bicicletas:create'), bicicletas_controller_1.registrarBicicleta);
r.get('/usuario/bicicletas/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('bicicletas:read'), bicicletas_controller_1.getBicicleta);
r.patch('/usuario/bicicletas/:id', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('bicicletas:update'), bicicletas_controller_1.actualizarBicicleta);
// ══════════════════════════════════════════════════════════
// SEGURIDAD — Denuncias de robo
// ══════════════════════════════════════════════════════════
// Público — alertas por serial sin auth
r.get('/seguridad/alertas/:serial', rateLimiter_1.verificadorRateLimit, seguridad_controller_1.alertasPorSerial);
// Autenticados
r.post('/seguridad/denunciar', ...auth_1.authenticated, rateLimiter_1.denunciaRateLimit, (0, auth_1.requirePermission)('denuncia:create'), seguridad_controller_1.denunciar);
r.post('/seguridad/denuncias/:id/recuperar', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('denuncia:recuperar'), seguridad_controller_1.recuperar);
r.get('/seguridad/mis-denuncias', ...auth_1.authenticated, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('denuncia:read'), seguridad_controller_1.verMisDenuncias);
// ══════════════════════════════════════════════════════════
// ROLES — info y verificación de permisos
// ══════════════════════════════════════════════════════════
r.get('/roles', rateLimiter_1.verificadorRateLimit, admin_controller_1.getRolesInfo); // público
r.get('/roles/mine', ...auth_1.authenticated, rateLimiter_1.userRateLimit, admin_controller_1.getMyPermissions);
r.get('/roles/check/:permiso', ...auth_1.authenticated, rateLimiter_1.userRateLimit, admin_controller_1.checkPermission);
// ══════════════════════════════════════════════════════════
// INSPECTOR — perfil propio
// ══════════════════════════════════════════════════════════
r.get('/inspector/perfil', ...auth_1.onlyInspector, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('inspector:read'), admin_controller_1.getMiPerfilInspector);
// ══════════════════════════════════════════════════════════
// ALIADO — gestión de su taller
// ══════════════════════════════════════════════════════════
r.get('/aliado/mi-taller', ...auth_1.onlyAliado, rateLimiter_1.userRateLimit, (0, auth_1.requirePermission)('taller:read'), admin_controller_1.getMiTaller);
// ══════════════════════════════════════════════════════════
// ADMIN — gestión de usuarios, roles, inspectores, talleres
// ══════════════════════════════════════════════════════════
// Usuarios y roles
r.get('/admin/usuarios', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('usuario:read:all'), admin_controller_1.listUsuarios);
r.post('/admin/usuarios/:id/rol', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('roles:assign'), admin_controller_1.asignarRol);
// Inspectores
r.get('/admin/inspectores', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('inspector:certify'), admin_controller_1.getInspectores);
r.post('/admin/inspectores', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('inspector:certify'), admin_controller_1.crearInspector);
r.post('/admin/inspectores/:id/certificar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('inspector:certify'), admin_controller_1.certificarInspector);
r.patch('/admin/inspectores/:id/habilitar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('inspector:habilitar'), admin_controller_1.habilitarInspector);
// Talleres aliados
r.get('/admin/talleres', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('taller:habilitar'), admin_controller_1.getTalleres);
r.post('/admin/talleres', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('taller:create'), admin_controller_1.crearTaller);
r.patch('/admin/talleres/:id/habilitar', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('taller:habilitar'), admin_controller_1.habilitarTaller);
// Sistema — tokens, colas, rate limits
r.post('/admin/tokens/purge', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('admin:tokens'), async (_req, res) => {
    const result = await (0, jwt_service_2.purgeExpiredTokens)();
    res.json({ ok: true, data: result });
});
r.get('/admin/rate-limits/:identifier', ...auth_1.onlyAdmin, rateLimiter_1.adminRateLimit, (0, auth_1.requirePermission)('admin:rate-limits'), async (req, res) => {
    const status = await (0, rateLimiter_1.getRateLimitStatus)(req.params.identifier);
    res.json({ ok: true, data: { identifier: req.params.identifier, limits: status } });
});
// ══════════════════════════════════════════════════════════
// NOTIFICACIONES — usuario autenticado
// ══════════════════════════════════════════════════════════
r.get('/usuario/notificaciones', ...auth_1.authenticated, async (req, res) => {
    const { soloNoLeidas, page, limit } = zod_1.z.object({
        soloNoLeidas: zod_1.z.string().optional().transform(v => v === 'true'),
        page: zod_1.z.string().optional().transform(v => parseInt(v ?? '1')),
        limit: zod_1.z.string().optional().transform(v => Math.min(50, parseInt(v ?? '20'))),
    }).parse(req.query);
    const result = await (0, notif_service_1.getMisNotificaciones)(req.user.sub, { soloNoLeidas, page, limit });
    res.json({ ok: true, data: result });
});
r.patch('/usuario/notificaciones/:id/leer', ...auth_1.authenticated, async (req, res) => {
    const ok = await (0, notif_service_1.marcarLeida)(req.params.id, req.user.sub);
    res.json({ ok, data: { leida: ok } });
});
r.patch('/usuario/notificaciones/leer-todas', ...auth_1.authenticated, async (req, res) => {
    const count = await (0, notif_service_1.marcarTodasLeidas)(req.user.sub);
    res.json({ ok: true, data: { marcadas: count } });
});
r.get('/usuario/notificaciones/preferencias', ...auth_1.authenticated, async (req, res) => {
    const prefs = await (0, notif_service_1.getSetPreferencias)(req.user.sub);
    res.json({ ok: true, data: prefs });
});
r.put('/usuario/notificaciones/preferencias', ...auth_1.authenticated, async (req, res) => {
    const update = zod_1.z.object({
        email_activo: zod_1.z.boolean().optional(),
        push_activo: zod_1.z.boolean().optional(),
        cit_aprobado: zod_1.z.boolean().optional(),
        cit_rechazado: zod_1.z.boolean().optional(),
        cit_por_vencer: zod_1.z.boolean().optional(),
        denuncia_registrada: zod_1.z.boolean().optional(),
        venta_confirmada: zod_1.z.boolean().optional(),
    }).parse(req.body);
    const prefs = await (0, notif_service_1.getSetPreferencias)(req.user.sub, update);
    res.json({ ok: true, data: prefs });
});
r.post('/usuario/fcm-token', ...auth_1.authenticated, async (req, res) => {
    const { token } = zod_1.z.object({ token: zod_1.z.string().min(1) }).parse(req.body);
    await (0, notif_service_1.registrarFCMToken)(req.user.sub, token);
    res.json({ ok: true, data: { registrado: true } });
});
// ══════════════════════════════════════════════════════════
// HEALTH CHECKS
// ══════════════════════════════════════════════════════════
r.get('/health', rateLimiter_1.verificadorRateLimit, async (_req, res) => {
    const report = await (0, health_service_1.quickHealthCheck)();
    res.status(report.ok ? 200 : 503).json(report);
});
r.get('/health/live', (_req, res) => { res.json((0, health_service_1.livenessCheck)()); });
r.get('/health/ready', async (_req, res) => {
    const report = await (0, health_service_1.readinessCheck)();
    res.status(report.ok ? 200 : 503).json(report);
});
r.get('/health/deep', ...auth_1.onlyAdmin, (0, auth_1.requirePermission)('admin:health:deep'), async (_req, res) => {
    const report = await (0, health_service_1.deepHealthCheck)();
    const httpStatus = report.status === 'down' ? 503 : report.status === 'degraded' ? 207 : 200;
    res.status(httpStatus).json({ ok: httpStatus === 200, data: report });
});
r.get('/health/metrics', ...auth_1.onlyAdmin, (0, auth_1.requirePermission)('admin:health:deep'), (_req, res) => {
    res.json({ ok: true, data: (0, health_service_1.processMetrics)() });
});
exports.default = r;
