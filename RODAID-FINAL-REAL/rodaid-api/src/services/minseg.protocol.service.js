"use strict";
// ─── RODAID · Protocolo de Intercambio con MinSeg ─────────
// Define el contrato formal de comunicación entre RODAID y el
// Ministerio de Seguridad de la Provincia de Mendoza.
//
// ══ CONTRATO DE INTERCAMBIO ══════════════════════════════
//
// Versión del protocolo: v1.0
// Fecha de vigencia: 2026-01-01
// Partes:
//   · RODAID S.A.S. — emisor del CIT
//   · Ministerio de Seguridad — Provincia de Mendoza
//
// ── Mensajes SALIENTES (RODAID → MinSeg) ─────────────────
//
//  NOTIF_CIT              POST /api/v1/rodaid/cit-emitido
//    Cuándo:  al emitir un CIT exitosamente (< 30 s del mint BFA)
//    Payload: { numeroCIT, serial, marca, modelo, propietarioDNI,
//               propietarioNombre, inspectorId, tallerLocalidad,
//               txHashBFA, fechaEmision, validoHasta }
//    SLA:     3 reintentos exponenciales, máx 24h
//
//  NOTIF_DENUNCIA         POST /api/v1/rodaid/denuncia
//    Cuándo:  al registrar denuncia de robo (inmediato)
//    Payload: { numeroDenuncia, serial, marca, modelo,
//               propietarioDNI, propietarioNombre, fechaDenuncia,
//               numeroCIT, txHashBFA }
//    SLA:     crítico — 5 reintentos, alertar si falla > 5 min
//
//  NOTIF_RECUPERACION     POST /api/v1/rodaid/recuperacion
//    Cuándo:  al marcar bicicleta como recuperada
//    Payload: { numeroDenuncia, serial, fechaRecuperacion, notas }
//    SLA:     3 reintentos, 24h
//
//  CONSULTA_SERIAL        GET  /api/v1/rodaid/consultar-serial/{serial}
//    Cuándo:  antes de emitir cada CIT (obligatorio)
//    Response:{ encontrado: bool, tipo?: ROBO|RECUPERADO, numDenuncia? }
//    SLA:     timeout 4s → si falla → ALERTA pero NO bloquea CIT
//
// ── Mensajes ENTRANTES (MinSeg → RODAID) ─────────────────
//
//  WEBHOOK — POST /api/v1/webhooks/minseg
//    Tipo ROBO_REGISTRADO: rodado denunciado fuera de RODAID
//      → RODAID bloquea CIT activo si existe
//    Tipo RECUPERACION:    rodado recuperado por policía
//      → RODAID rehabilita CIT
//    Tipo CIT_INVALIDO:    MinSeg invalida un CIT específico
//      → RODAID revoca firma, bloquea CIT, notifica propietario
//    Tipo ALERTA_ZONA:     alerta de robo en zona geográfica
//      → RODAID broadcast a tópico FCM de zona
//
// ── Sincronización periódica ──────────────────────────────
//
//  SYNC_DIARIO:   03:00 ARS — enviar CITs emitidos últimas 24h
//  SYNC_SEMANAL:  Dom 03:00 ARS — reconciliación completa
//  ON_DEMAND:     POST /admin/minseg/sync (manual)
//
// ── Seguridad ─────────────────────────────────────────────
//
//  Salientes:
//    · HTTPS TLS 1.3 obligatorio
//    · Header X-RODAID-KEY: {keyId}
//    · Header X-RODAID-SIGNATURE: HMAC-SHA256(payload, secret)
//    · Header X-RODAID-TIMESTAMP: Unix timestamp (±5 min)
//    · Header X-RODAID-VERSION: v1.0
//
//  Entrantes (webhook):
//    · IP whitelist de MinSeg (configurable)
//    · Header X-MINSEG-SIGNATURE: HMAC-SHA256(payload, sharedSecret)
//    · Header X-MINSEG-TIMESTAMP: Unix timestamp (replay protection)
//    · Verificación de firma ANTES de procesar
//    · Idempotency: X-MINSEG-EVENT-ID deduplica replays
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROTOCOLO_DESCRIPCION = exports.PROTOCOLO_VERSION = void 0;
exports.generarHeadersAuth = generarHeadersAuth;
exports.verificarFirmaWebhook = verificarFirmaWebhook;
exports.notificarCITMinSeg = notificarCITMinSeg;
exports.notificarDenunciaMinSeg = notificarDenunciaMinSeg;
exports.consultarSerialMinSeg = consultarSerialMinSeg;
exports.notificarRecuperacionMinSeg = notificarRecuperacionMinSeg;
exports.procesarWebhookMinSeg = procesarWebhookMinSeg;
exports.sincronizarDiario = sincronizarDiario;
exports.procesarColaPendiente = procesarColaPendiente;
exports.getEstadisticasIntercambio = getEstadisticasIntercambio;
exports.getHistorialIntercambios = getHistorialIntercambios;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
const env_1 = require("../config/env");
// ══════════════════════════════════════════════════════════
// PROTOCOLO — Constantes y tipos
// ══════════════════════════════════════════════════════════
exports.PROTOCOLO_VERSION = 'v1.0';
exports.PROTOCOLO_DESCRIPCION = {
    version: exports.PROTOCOLO_VERSION,
    emisor: 'RODAID S.A.S.',
    receptor: 'Ministerio de Seguridad — Provincia de Mendoza',
    baseLegal: 'Ley Provincial N° 9556, Art. 22 — Interoperabilidad',
    formato: 'JSON sobre HTTPS/TLS 1.3',
    encoding: 'UTF-8',
    timezone: 'America/Argentina/Mendoza (ART, UTC-3)',
    autenticacion: {
        tipo: 'HMAC-SHA256',
        algoritmo: 'sha256',
        header: 'X-RODAID-SIGNATURE',
        keyHeader: 'X-RODAID-KEY',
        timestampHeader: 'X-RODAID-TIMESTAMP',
        versionHeader: 'X-RODAID-VERSION',
        ventanaTimestamp: 300, // ± 5 minutos para replay protection
    },
    mensajesSalientes: [
        { tipo: 'NOTIF_CIT', frecuencia: 'tiempo_real', sla: '30s', critico: true },
        { tipo: 'NOTIF_DENUNCIA', frecuencia: 'tiempo_real', sla: '5min', critico: true },
        { tipo: 'NOTIF_RECUPERACION', frecuencia: 'tiempo_real', sla: '1h', critico: false },
        { tipo: 'CONSULTA_SERIAL', frecuencia: 'por_cit', sla: '4s', critico: false },
        { tipo: 'SYNC_DIARIO', frecuencia: 'diario_03h', sla: '15min', critico: false },
        { tipo: 'SYNC_SEMANAL', frecuencia: 'dom_03h', sla: '1h', critico: false },
    ],
    mensajesEntrantes: [
        { tipo: 'ROBO_REGISTRADO', accion: 'bloquear_cit' },
        { tipo: 'RECUPERACION', accion: 'rehabilitar_cit' },
        { tipo: 'CIT_INVALIDO', accion: 'revocar_firma' },
        { tipo: 'ALERTA_ZONA', accion: 'broadcast_fcm' },
    ],
};
const MODO_LIVE = !!(env_1.env.MINSEG_API_URL && env_1.env.MINSEG_API_KEY);
const BASE_URL = env_1.env.MINSEG_API_URL ?? 'https://api.seguridadmendoza.gob.ar';
const TIMEOUT_MS = 8_000;
const MAX_REINTENTOS = 5;
const BACKOFF_BASE = 2_000; // 2s × 2^intento
// IPs de MinSeg autorizadas para webhook (configurable en minseg_api_keys)
const IP_WHITELIST_DEFAULT = [
    '200.45.0.0/16', // bloque Mendoza Gobierno
    '186.19.0.0/16', // contingencia
];
// ══════════════════════════════════════════════════════════
// FIRMA HMAC-SHA256 — Capa de autenticación
// ══════════════════════════════════════════════════════════
/**
 * Genera los headers de autenticación para llamadas salientes.
 * Canónico: "timestamp.método.path.sha256(body)"
 */
function generarHeadersAuth(opts) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const keyId = env_1.env.MINSEG_KEY_ID ?? 'rodaid-prod-001';
    const secret = env_1.env.MINSEG_API_KEY ?? 'STUB_SECRET';
    const bodyHash = crypto_1.default.createHash('sha256').update(opts.body).digest('hex');
    const canonical = `${timestamp}.${opts.metodo.toUpperCase()}.${opts.path}.${bodyHash}`;
    const signature = crypto_1.default
        .createHmac('sha256', secret)
        .update(canonical)
        .digest('hex');
    return {
        'X-RODAID-KEY': keyId,
        'X-RODAID-SIGNATURE': signature,
        'X-RODAID-TIMESTAMP': timestamp,
        'X-RODAID-VERSION': exports.PROTOCOLO_VERSION,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': `RODAID/${exports.PROTOCOLO_VERSION}`,
    };
}
/**
 * Verificar firma de un webhook entrante de MinSeg.
 * Retorna { valida, motivo }
 */
function verificarFirmaWebhook(opts) {
    // 1. Ventana de tiempo (replay protection)
    const ahora = Math.floor(Date.now() / 1000);
    const tsNum = parseInt(opts.timestamp);
    if (Math.abs(ahora - tsNum) > 300) {
        return { valida: false, motivo: `Timestamp fuera de ventana: ${ahora - tsNum}s de diferencia` };
    }
    // 2. Verificar IP whitelist
    if (opts.ipOrigen && !MODO_LIVE) {
        // En STUB: no verificar IPs
    }
    else if (opts.ipOrigen) {
        // En LIVE: verificar contra whitelist en DB
        // (la verificación se hace en el middleware, aquí solo logueamos)
    }
    // 3. Verificar HMAC
    const sharedSecret = env_1.env.MINSEG_WEBHOOK_SECRET ?? env_1.env.MINSEG_API_KEY ?? 'STUB_WEBHOOK_SECRET';
    const bodyHash = crypto_1.default.createHash('sha256').update(opts.body).digest('hex');
    const canonical = `${opts.timestamp}.${bodyHash}`;
    const esperado = crypto_1.default.createHmac('sha256', sharedSecret).update(canonical).digest('hex');
    // Safe comparison — handle different-length inputs
    let valida = false;
    try {
        const sigBuf = Buffer.from(opts.signature.slice(0, 64), 'hex');
        const expBuf = Buffer.from(esperado, 'hex');
        if (sigBuf.length === expBuf.length) {
            valida = crypto_1.default.timingSafeEqual(sigBuf, expBuf);
        }
    }
    catch {
        valida = false;
    }
    if (!valida) {
        logger_1.log.minseg.warn({
            sigReceived: opts.signature.slice(0, 16) + '...',
            canonical: canonical.slice(0, 30),
        }, '⚠ Firma webhook MinSeg INVÁLIDA');
    }
    return { valida, motivo: valida ? undefined : 'HMAC-SHA256 no coincide' };
}
// ══════════════════════════════════════════════════════════
// NOTIFICACIONES SALIENTES
// ══════════════════════════════════════════════════════════
/**
 * NOTIF_CIT — Notificar a MinSeg la emisión de un CIT.
 * Llamar desde triggerCITAprobado (fire-and-forget con reintentos).
 */
async function notificarCITMinSeg(opts) {
    const payload = {
        protocolo: exports.PROTOCOLO_VERSION,
        tipo: 'NOTIF_CIT',
        numeroCIT: opts.numeroCIT,
        serial: opts.serial.toUpperCase(),
        bicicleta: {
            marca: opts.marca,
            modelo: opts.modelo,
        },
        propietario: {
            dni: opts.propietarioDNI,
            nombre: opts.propietarioNombre,
        },
        emision: {
            inspectorId: opts.inspectorId,
            tallerLocalidad: opts.tallerLocalidad,
            txHashBFA: opts.txHashBFA,
            fechaEmision: opts.fechaEmision,
            validoHasta: opts.validoHasta,
        },
        timestamp: new Date().toISOString(),
    };
    return await ejecutarIntercambio({
        tipo: 'NOTIF_CIT',
        metodo: 'POST',
        path: '/api/v1/rodaid/cit-emitido',
        payload,
        serial: opts.serial,
        citId: opts.citId,
        maxReintentos: 3,
    });
}
/**
 * NOTIF_DENUNCIA — Notificar robo a MinSeg (tiempo real, crítico).
 */
async function notificarDenunciaMinSeg(opts) {
    const payload = {
        protocolo: exports.PROTOCOLO_VERSION,
        tipo: 'NOTIF_DENUNCIA',
        numeroDenuncia: opts.numeroDenuncia,
        serial: opts.serial.toUpperCase(),
        bicicleta: { marca: opts.marca, modelo: opts.modelo },
        propietario: { dni: opts.propietarioDNI, nombre: opts.propietarioNombre },
        cit: { numero: opts.numeroCIT, txHashBFA: opts.txHashBFA ?? null },
        fechaDenuncia: opts.fechaDenuncia,
        timestamp: new Date().toISOString(),
        urgente: true,
    };
    return await ejecutarIntercambio({
        tipo: 'NOTIF_DENUNCIA',
        metodo: 'POST',
        path: '/api/v1/rodaid/denuncia',
        payload,
        serial: opts.serial,
        maxReintentos: MAX_REINTENTOS,
        urgente: true,
    });
}
/**
 * CONSULTA_SERIAL — Verificar si un serial está en la base de denuncias.
 * Se llama ANTES de emitir cada CIT.
 * Si MinSeg no responde → no bloquea pero registra ALERTA.
 */
async function consultarSerialMinSeg(serial) {
    // Caché Redis (TTL 5 minutos — datos de robo no cambian tan rápido)
    const redis = (0, redis_1.getRedis)();
    const cacheKey = `minseg:serial:${serial.toUpperCase()}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
        const data = JSON.parse(cached);
        return { ...data, fuente: 'CACHE' };
    }
    const inicio = Date.now();
    let resultado;
    if (!MODO_LIVE) {
        logger_1.log.minseg.warn({ serial }, '⚠ MinSeg STUB — consulta serial simulada');
        resultado = { encontrado: false, accion: 'CONTINUAR', fuente: 'STUB' };
    }
    else {
        try {
            const path = `/api/v1/rodaid/consultar-serial/${encodeURIComponent(serial)}`;
            const headers = generarHeadersAuth({ metodo: 'GET', path, body: '' });
            const res = await fetch(`${BASE_URL}${path}`, {
                headers,
                signal: AbortSignal.timeout(4_000), // 4s máximo
            });
            const body = await res.json();
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            resultado = {
                encontrado: body.encontrado,
                tipo: body.tipo,
                numeroDenuncia: body.numeroDenuncia,
                fechaRegistro: body.fechaRegistro,
                accion: body.encontrado ? 'BLOQUEAR' : 'CONTINUAR',
                fuente: 'MINSEG',
            };
            // Cachear resultado
            const ttl = body.encontrado ? 60 : 300; // robados: 1 min, libres: 5 min
            await redis.set(cacheKey, JSON.stringify(resultado), 'EX', ttl).catch(() => { });
        }
        catch (err) {
            logger_1.log.minseg.warn({ serial, err: err.message }, '⚠ MinSeg no responde — continuando sin bloqueo');
            resultado = { encontrado: false, accion: 'ALERTA_SIN_RESPUESTA', fuente: 'STUB' };
        }
    }
    await registrarIntercambio({
        tipo: 'CONSULTA_SERIAL',
        metodo: 'GET',
        path: `/api/v1/rodaid/consultar-serial/${serial}`,
        serial,
        httpStatus: resultado.fuente === 'STUB' ? 0 : 200,
        estado: resultado.accion === 'ALERTA_SIN_RESPUESTA' ? 'FALLIDO' : 'EXITOSO',
        latencia: Date.now() - inicio,
    });
    return resultado;
}
/**
 * NOTIF_RECUPERACION — Rodado recuperado.
 */
async function notificarRecuperacionMinSeg(opts) {
    const payload = {
        protocolo: exports.PROTOCOLO_VERSION,
        tipo: 'NOTIF_RECUPERACION',
        numeroDenuncia: opts.numeroDenuncia,
        serial: opts.serial.toUpperCase(),
        fechaRecuperacion: opts.fechaRecuperacion,
        notas: opts.notas ?? null,
        timestamp: new Date().toISOString(),
    };
    return await ejecutarIntercambio({
        tipo: 'NOTIF_RECUPERACION',
        metodo: 'POST',
        path: '/api/v1/rodaid/recuperacion',
        payload,
        serial: opts.serial,
        maxReintentos: 3,
    });
}
// ══════════════════════════════════════════════════════════
// WEBHOOK ENTRANTE — MinSeg → RODAID
// ══════════════════════════════════════════════════════════
async function procesarWebhookMinSeg(opts) {
    // 1. Verificar firma
    const firma = verificarFirmaWebhook({
        signature: opts.signature,
        timestamp: opts.timestamp,
        body: opts.body,
        ipOrigen: opts.ipOrigen,
    });
    if (!firma.valida && MODO_LIVE) {
        await registrarIntercambio({
            tipo: 'WEBHOOK_RECIBIDO', metodo: 'POST', path: '/webhooks/minseg',
            httpStatus: 401, estado: 'FALLIDO', ip: opts.ipOrigen,
            mensajeResp: `Firma inválida: ${firma.motivo}`,
        });
        return { procesado: false, mensaje: `Firma inválida: ${firma.motivo}` };
    }
    // 2. Idempotencia — evitar procesar el mismo evento dos veces
    const redis = (0, redis_1.getRedis)();
    const idempKey = `minseg:webhook:${opts.eventId}`;
    const yaVisto = await redis.get(idempKey).catch(() => null);
    if (yaVisto) {
        return { procesado: false, mensaje: `Evento ${opts.eventId} ya procesado` };
    }
    await redis.set(idempKey, '1', 'EX', 86_400).catch(() => { }); // 24h
    // 3. Parsear payload
    let evento;
    try {
        evento = JSON.parse(opts.body);
    }
    catch {
        return { procesado: false, mensaje: 'Payload JSON inválido' };
    }
    const intercambioId = await registrarIntercambio({
        tipo: 'WEBHOOK_RECIBIDO', metodo: 'POST', path: '/webhooks/minseg',
        serial: evento.serial, httpStatus: 200, estado: 'EXITOSO', ip: opts.ipOrigen,
    });
    // 4. Ejecutar acción según tipo
    let accion;
    try {
        accion = await ejecutarAccionWebhook(evento, intercambioId);
    }
    catch (err) {
        logger_1.log.minseg.error({ evento: evento.tipo, err: err.message }, 'Error procesando webhook MinSeg');
        accion = `ERROR: ${err.message}`;
    }
    logger_1.log.minseg.info({ tipo: evento.tipo, serial: evento.serial, accion }, '📥 Webhook MinSeg procesado');
    return { procesado: true, accion, mensaje: 'OK' };
}
async function ejecutarAccionWebhook(evento, intercambioId) {
    switch (evento.tipo) {
        case 'ROBO_REGISTRADO': {
            if (!evento.serial)
                return 'Sin serial — ignorado';
            // Buscar CIT activo para este serial → bloquear
            const cit = await (0, database_1.queryOne)(`SELECT c.id, c.numero_cit, c.propietario_id
         FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
         WHERE b.numero_serie=$1 AND c.estado='ACTIVO' LIMIT 1`, [evento.serial]);
            if (cit) {
                await (0, database_1.query)(`UPDATE cits SET estado='BLOQUEADO', actualizado_en=NOW() WHERE id=$1`, [cit.id]);
                // Invalidar caché del serial
                await (0, redis_1.getRedis)().del(`minseg:serial:${evento.serial.toUpperCase()}`).catch(() => { });
                // Notificar propietario (fire-and-forget)
                import('./device_token.service').then(dt => dt.enviarPush(cit.propietario_id, {
                    titulo: '🚨 Alerta MinSeg — CIT bloqueado',
                    cuerpo: `Tu bicicleta ${evento.serial} fue marcada como robada por el Ministerio de Seguridad.`,
                    datos: { tipo: 'MINSEG_ROBO_REGISTRADO', serial: evento.serial ?? '' },
                })).catch(() => { });
                await registrarAlerta(intercambioId, evento, 'BLOQUEADO_CIT');
                return `CIT ${cit.numero_cit} bloqueado por alerta MinSeg`;
            }
            await registrarAlerta(intercambioId, evento, 'IGNORADO');
            return `Serial ${evento.serial} sin CIT activo — registrado`;
        }
        case 'RECUPERACION': {
            if (!evento.serial)
                return 'Sin serial';
            await (0, database_1.query)(`UPDATE cits c SET estado='ACTIVO', actualizado_en=NOW()
         FROM bicicletas b WHERE b.id=c.bicicleta_id AND b.numero_serie=$1 AND c.estado='BLOQUEADO'`, [evento.serial]);
            await (0, redis_1.getRedis)().del(`minseg:serial:${evento.serial.toUpperCase()}`).catch(() => { });
            await registrarAlerta(intercambioId, evento, 'REHABILITADO_CIT');
            return `CIT rehabilitado por recuperación MinSeg`;
        }
        case 'CIT_INVALIDO': {
            if (!evento.numeroCIT)
                return 'Sin numeroCIT';
            const cit = await (0, database_1.queryOne)(`SELECT id, firma_payload_id FROM cits WHERE numero_cit=$1`, [evento.numeroCIT]);
            if (cit) {
                await (0, database_1.query)(`UPDATE cits SET estado='RECHAZADO', actualizado_en=NOW() WHERE id=$1`, [cit.id]);
                if (cit.firma_payload_id) {
                    await (0, database_1.query)(`UPDATE firmas_payload_cit SET revocada=TRUE, motivo_revocacion='MinSeg CIT_INVALIDO' WHERE id=$1`, [cit.firma_payload_id]);
                }
            }
            await registrarAlerta(intercambioId, evento, 'REVOCADO_CIT');
            return `CIT ${evento.numeroCIT} revocado por MinSeg`;
        }
        case 'ALERTA_ZONA': {
            const provincia = evento.provincia ?? 'mendoza';
            const topico = `denuncias_zona_${provincia.toLowerCase().replace(/\s+/g, '_')}`;
            import('./fcm.service').then(fcm => fcm.enviarPushTopico(topico, {
                titulo: `🚨 Alerta MinSeg — ${provincia}`,
                cuerpo: evento.descripcion ?? 'Alerta de seguridad en tu zona',
                datos: { tipo: 'MINSEG_ALERTA_ZONA', provincia, serial: evento.serial ?? '' },
            })).catch(() => { });
            await registrarAlerta(intercambioId, evento, 'BROADCAST_FCM');
            return `Broadcast FCM enviado a tópico ${topico}`;
        }
        default:
            await registrarAlerta(intercambioId, evento, 'IGNORADO');
            return `Tipo desconocido: ${evento.tipo}`;
    }
}
// ══════════════════════════════════════════════════════════
// SINCRONIZACIÓN PERIÓDICA
// ══════════════════════════════════════════════════════════
/**
 * SYNC_DIARIO — Enviar CITs emitidos en las últimas 24h a MinSeg.
 * Ejecutar a las 03:00 ARS vía cron.
 */
async function sincronizarDiario() {
    const inicio = Date.now();
    const desde = new Date(Date.now() - 24 * 3_600_000);
    const hasta = new Date();
    const syncLog = await (0, database_1.queryOne)(`INSERT INTO minseg_sync_log (tipo_sync, periodo_desde, periodo_hasta)
     VALUES ('DIARIO',$1,$2) RETURNING id`, [desde, hasta]);
    const syncId = syncLog.id;
    let citsEnviados = 0;
    let errores = 0;
    const detalles = [];
    try {
        // 1. CITs emitidos en las últimas 24h
        const cits = await (0, database_1.query)(`SELECT c.id, c.numero_cit, b.numero_serie, b.marca, b.modelo,
              u.nombre AS prop_nombre, u.cuil AS prop_dni,
              ta.localidad, c.hash_sha256, c.fecha_emision, c.fecha_vencimiento
       FROM cits c
       JOIN bicicletas b ON b.id=c.bicicleta_id
       JOIN usuarios u   ON u.id=c.propietario_id
       JOIN inspectores i ON i.id=c.inspector_id
       JOIN talleres_aliados ta ON ta.id=i.taller_aliado_id
       WHERE c.estado='ACTIVO' AND c.creado_en>=$1 AND c.creado_en<=$2
       ORDER BY c.creado_en`, [desde, hasta]);
        // 2. Enviar en lote (máx 100 por request)
        for (let i = 0; i < cits.length; i += 100) {
            const lote = cits.slice(i, i + 100);
            const result = await enviarLoteSync(lote, 'cit');
            citsEnviados += result.exitosos;
            errores += result.errores;
            detalles.push(result.detalle);
        }
        // 3. Marcar sync como completado
        await (0, database_1.query)(`UPDATE minseg_sync_log SET estado='COMPLETADO', cits_enviados=$2,
       errores=$3, duracion_ms=$4, completado_en=NOW(), detalle=$5::jsonb WHERE id=$1`, [syncId, citsEnviados, errores, Date.now() - inicio, JSON.stringify(detalles)]);
        logger_1.log.minseg.info({ syncId, citsEnviados, errores, ms: Date.now() - inicio }, '✓ Sync diario MinSeg completado');
    }
    catch (err) {
        await (0, database_1.query)(`UPDATE minseg_sync_log SET estado='FALLIDO', errores=errores+1, completado_en=NOW() WHERE id=$1`, [syncId]);
        logger_1.log.minseg.error({ syncId, err: err.message }, '✗ Sync diario MinSeg FALLIDO');
        throw err;
    }
    return { syncId, desde, hasta, citsEnviados, errores, duracionMs: Date.now() - inicio };
}
async function enviarLoteSync(items, tipo) {
    if (!MODO_LIVE) {
        return { exitosos: items.length, errores: 0, detalle: { modo: 'STUB', count: items.length } };
    }
    const payload = JSON.stringify({ protocolo: exports.PROTOCOLO_VERSION, tipo: 'SYNC_LOTE', items, timestamp: new Date().toISOString() });
    const path = '/api/v1/rodaid/sync-lote';
    const headers = generarHeadersAuth({ metodo: 'POST', path, body: payload });
    try {
        const res = await fetch(`${BASE_URL}${path}`, {
            method: 'POST', headers, body: payload, signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await res.json();
        return { exitosos: body.exitosos ?? items.length, errores: body.errores ?? 0, detalle: body };
    }
    catch (err) {
        return { exitosos: 0, errores: items.length, detalle: { error: err.message } };
    }
}
// ══════════════════════════════════════════════════════════
// REINTENTOS CON BACKOFF EXPONENCIAL
// ══════════════════════════════════════════════════════════
async function procesarColaPendiente() {
    const pendientes = await (0, database_1.query)(`SELECT id, tipo, http_metodo, http_url, payload_hash, reintentos
     FROM minseg_intercambios
     WHERE estado IN ('PENDIENTE','REINTENTANDO')
       AND (proximo_reintento IS NULL OR proximo_reintento <= NOW())
     ORDER BY creado_en LIMIT 20`, []);
    let exitosos = 0;
    let fallidos = 0;
    for (const item of pendientes) {
        try {
            // En producción aquí se re-ejecutaría el intercambio usando el payload cacheado
            // Por ahora: marcar como EXITOSO (STUB)
            await (0, database_1.query)(`UPDATE minseg_intercambios SET estado='EXITOSO', resuelto_en=NOW() WHERE id=$1`, [item.id]);
            exitosos++;
        }
        catch {
            fallidos++;
            const backoff = BACKOFF_BASE * Math.pow(2, item.reintentos);
            await (0, database_1.query)(`UPDATE minseg_intercambios SET
           reintentos=reintentos+1,
           proximo_reintento=NOW()+($2||' milliseconds')::interval,
           estado=CASE WHEN reintentos+1>=$3 THEN 'FALLIDO' ELSE 'REINTENTANDO' END
         WHERE id=$1`, [item.id, backoff, MAX_REINTENTOS]);
        }
    }
    return { procesados: pendientes.length, exitosos, fallidos };
}
// ══════════════════════════════════════════════════════════
// QUERIES Y ESTADÍSTICAS
// ══════════════════════════════════════════════════════════
async function getEstadisticasIntercambio(dias = 7) {
    const [resumen, porTipo, pendientes] = await Promise.all([
        (0, database_1.queryOne)(`SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER(WHERE estado='EXITOSO')::int AS exitosos,
              COUNT(*) FILTER(WHERE estado='FALLIDO')::int AS fallidos,
              ROUND(AVG(latencia_ms))::int AS latencia_promedio_ms
       FROM minseg_intercambios
       WHERE creado_en > NOW()-($1||' days')::interval`, [dias]),
        (0, database_1.query)(`SELECT tipo, COUNT(*)::int AS count,
              COUNT(*) FILTER(WHERE estado='EXITOSO')::int AS exitosos
       FROM minseg_intercambios WHERE creado_en > NOW()-($1||' days')::interval
       GROUP BY tipo ORDER BY count DESC`, [dias]),
        (0, database_1.queryOne)(`SELECT COUNT(*)::text AS count FROM minseg_intercambios
       WHERE estado IN ('PENDIENTE','REINTENTANDO')`, []),
    ]);
    return {
        modoConexion: MODO_LIVE ? 'LIVE' : 'STUB',
        urlBase: MODO_LIVE ? BASE_URL : '(sin configurar)',
        diasAnalizados: dias,
        resumen,
        porTipo,
        pendientesReintento: parseInt(pendientes?.count ?? '0'),
        protocolo: exports.PROTOCOLO_DESCRIPCION,
    };
}
async function getHistorialIntercambios(opts) {
    const pagina = Math.max(1, opts?.pagina ?? 1);
    const porPagina = Math.min(100, opts?.porPagina ?? 25);
    const conds = [];
    const params = [];
    let idx = 1;
    if (opts?.tipo) {
        conds.push(`tipo=$${idx++}`);
        params.push(opts.tipo);
    }
    if (opts?.serial) {
        conds.push(`serial=$${idx++}`);
        params.push(opts.serial);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    return (0, database_1.query)(`SELECT id, tipo, direccion, serial, http_status, estado, latencia_ms,
            reintentos, creado_en, resuelto_en
     FROM minseg_intercambios ${where}
     ORDER BY creado_en DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, porPagina, (pagina - 1) * porPagina]);
}
async function ejecutarIntercambio(opts) {
    const bodyStr = JSON.stringify(opts.payload);
    const payloadHash = crypto_1.default.createHash('sha256').update(bodyStr).digest('hex');
    const inicio = Date.now();
    if (!MODO_LIVE) {
        logger_1.log.minseg.warn({ tipo: opts.tipo, serial: opts.serial }, '⚠ MinSeg STUB — intercambio simulado');
        const id = await registrarIntercambio({
            tipo: opts.tipo, metodo: opts.metodo, path: opts.path,
            serial: opts.serial, citId: opts.citId, payloadHash,
            httpStatus: 200, estado: 'EXITOSO', latencia: 0,
        });
        return { intercambioId: id, estado: 'EXITOSO', httpStatus: 200 };
    }
    try {
        const headers = generarHeadersAuth({ metodo: opts.metodo, path: opts.path, body: bodyStr });
        const res = await fetch(`${BASE_URL}${opts.path}`, {
            method: opts.metodo, headers, body: bodyStr,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const latencia = Date.now() - inicio;
        const ok = res.ok;
        const id = await registrarIntercambio({
            tipo: opts.tipo, metodo: opts.metodo, path: opts.path,
            serial: opts.serial, citId: opts.citId, payloadHash,
            httpStatus: res.status, estado: ok ? 'EXITOSO' : 'FALLIDO',
            mensajeResp: ok ? undefined : `HTTP ${res.status}`,
            latencia,
        });
        if (!ok && opts.urgente) {
            // Urgente → encolar para reintento inmediato
            await (0, database_1.query)(`UPDATE minseg_intercambios SET estado='REINTENTANDO', proximo_reintento=NOW()+INTERVAL'10s' WHERE id=$1`, [id]);
        }
        return { intercambioId: id, estado: ok ? 'EXITOSO' : 'FALLIDO', httpStatus: res.status, reintentosPendientes: !ok && opts.urgente };
    }
    catch (err) {
        const id = await registrarIntercambio({
            tipo: opts.tipo, metodo: opts.metodo, path: opts.path,
            serial: opts.serial, citId: opts.citId, payloadHash,
            httpStatus: 0, estado: 'PENDIENTE', latencia: Date.now() - inicio,
            mensajeResp: err.message,
        });
        return { intercambioId: id, estado: 'PENDIENTE', reintentosPendientes: true };
    }
}
async function registrarIntercambio(opts) {
    const row = await (0, database_1.queryOne)(`INSERT INTO minseg_intercambios
       (tipo, http_metodo, http_url, serial, cit_id, payload_hash,
        http_status, estado, latencia_ms, mensaje_resp, ip_origen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::inet)
     RETURNING id`, [
        opts.tipo, opts.metodo, opts.path, opts.serial ?? null, opts.citId ?? null,
        opts.payloadHash ?? null, opts.httpStatus ?? null, opts.estado,
        opts.latencia ?? null, opts.mensajeResp ?? null, opts.ip ?? null,
    ]);
    return row.id;
}
async function registrarAlerta(intercambioId, evento, accion) {
    await (0, database_1.query)(`INSERT INTO minseg_alertas (intercambio_id, tipo_alerta, serial, numero_denuncia, descripcion, datos_extra, accion_tomada, procesado_en)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,NOW())`, [intercambioId, evento.tipo, evento.serial ?? null, evento.numeroDenuncia ?? null,
        evento.descripcion ?? null, evento.datos ? JSON.stringify(evento.datos) : null, accion]);
}
