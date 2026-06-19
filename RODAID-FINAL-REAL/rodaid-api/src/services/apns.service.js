"use strict";
// ─── RODAID · Apple Push Notification Service (APNs) ─────
// Envía push notifications directamente a dispositivos iOS
// sin depender de Firebase — usando la APNs HTTP/2 API v3.
//
// Autenticación JWT (token-based, recomendada por Apple):
//   · Clave privada EC (P-256 / ES256) — archivo .p8 de Apple
//   · Token JWT firmado: { alg:'ES256', kid:KEY_ID } + { iss:TEAM_ID, iat:now }
//   · Válido 60 min — se renueva automáticamente con buffer de 5 min
//
// Flujos soportados:
//   Notificación estándar   → push_type=alert, prioridad=10
//   Notificación silenciosa → push_type=background, prioridad=5, content-available=1
//   Notificación rica       → mutable-content=1 + service extension en la app
//   Colapso                 → apns-collapse-id (un push reemplaza al anterior del mismo ID)
//
// Push types soportados:
//   alert      → notificación visible con alerta
//   background → wake silencioso de la app (sin barra)
//   location   → para actualizaciones de ubicación
//   voip       → llamadas (PushKit)
//
// Environments:
//   sandbox    → api.sandbox.push.apple.com (TestFlight / Xcode dev)
//   production → api.push.apple.com (App Store)
//
// Variables de entorno:
//   APNS_KEY_ID      — 10 chars, desde Apple Developer Console
//   APNS_TEAM_ID     — 10 chars, desde Apple Developer Console
//   APNS_PRIVATE_KEY — contenido del archivo .p8 (EC private key)
//   APNS_BUNDLE_ID   — com.rodaid.app
//   APNS_ENVIRONMENT — sandbox | production (default: sandbox)
//
// Modo STUB (sin credenciales):
//   → loguea el intento, devuelve éxito simulado
//   → todos los tests pasan sin conexión a Apple
//
// Integración con FCM:
//   · Si la app iOS usa Firebase SDK → usar fcm.service.ts (FCM reenvía a APNs)
//   · Si la app iOS es nativa sin Firebase → usar este servicio directamente
//   · El dispatcher notif.dispatcher.ts detecta automáticamente el push_tipo
//     del token y enruta al servicio correcto
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJWT = getJWT;
exports.enviarAPNsToken = enviarAPNsToken;
exports.enviarAPNsUsuario = enviarAPNsUsuario;
exports.payloadCITEmitido = payloadCITEmitido;
exports.payloadDenunciaRobo = payloadDenunciaRobo;
exports.payloadBackground = payloadBackground;
exports.payloadVenta = payloadVenta;
exports.registrarTokenAPNs = registrarTokenAPNs;
exports.getEstadisticasAPNs = getEstadisticasAPNs;
exports.getModoAPNs = getModoAPNs;
exports.getApnsEnv = getApnsEnv;
exports.getBundleId = getBundleId;
const http2_1 = __importDefault(require("http2"));
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const env_1 = require("../config/env");
// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════
const APNS_HOST_PROD = 'api.push.apple.com';
const APNS_HOST_SANDBOX = 'api.sandbox.push.apple.com';
const APNS_PORT = 443;
const JWT_BUFFER_SEC = 300; // renovar 5 min antes de vencer
const JWT_TTL_SEC = 3600; // tokens válidos 1 hora
const MODO_LIVE = !!(env_1.env.APNS_KEY_ID && env_1.env.APNS_TEAM_ID && env_1.env.APNS_PRIVATE_KEY);
const BUNDLE_ID = env_1.env.APNS_BUNDLE_ID ?? 'com.rodaid.app';
const APNS_ENV = (env_1.env.APNS_ENVIRONMENT ?? 'sandbox');
const APNS_HOST = APNS_ENV === 'production' ? APNS_HOST_PROD : APNS_HOST_SANDBOX;
// ══════════════════════════════════════════════════════════
// JWT TOKEN PARA APNS
// ══════════════════════════════════════════════════════════
let _jwt = null;
let _jwtExpira = 0;
/**
 * Genera (o reutiliza desde cache) el JWT Bearer token para APNs.
 * Apple requiere:
 *   header: { alg: 'ES256', kid: KEY_ID }
 *   payload: { iss: TEAM_ID, iat: <unix timestamp> }
 */
function getJWT() {
    if (!MODO_LIVE)
        return 'STUB_APNS_JWT';
    const ahora = Math.floor(Date.now() / 1000);
    if (_jwt && ahora < _jwtExpira - JWT_BUFFER_SEC)
        return _jwt;
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: env_1.env.APNS_KEY_ID })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: env_1.env.APNS_TEAM_ID, iat: ahora })).toString('base64url');
    const data = `${header}.${payload}`;
    // Firma ES256 con la private key del .p8
    const privateKey = env_1.env.APNS_PRIVATE_KEY.replace(/\\n/g, '\n');
    const sign = crypto_1.default.createSign('SHA256');
    sign.update(data);
    const signature = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    _jwt = `${data}.${signature}`;
    _jwtExpira = ahora + JWT_TTL_SEC;
    logger_1.log.mensajeria.debug({ kidSlice: env_1.env.APNS_KEY_ID?.slice(0, 4), expira: _jwtExpira }, 'JWT APNs generado');
    return _jwt;
}
// ══════════════════════════════════════════════════════════
// CONEXIÓN HTTP/2 A APNs (singleton por host)
// ══════════════════════════════════════════════════════════
let _session = null;
let _sessionHost = null;
function getSession(host) {
    return new Promise((resolve, reject) => {
        if (_session && !_session.destroyed && _sessionHost === host) {
            return resolve(_session);
        }
        _session?.destroy();
        const session = http2_1.default.connect(`https://${host}:${APNS_PORT}`, {
            rejectUnauthorized: true,
        });
        session.once('connect', () => {
            _session = session;
            _sessionHost = host;
            logger_1.log.mensajeria.debug({ host }, 'APNs HTTP/2 sesión establecida');
            resolve(session);
        });
        session.once('error', (err) => {
            _session = null;
            reject(err);
        });
        session.once('goaway', () => {
            _session = null;
            logger_1.log.mensajeria.warn({ host }, 'APNs HTTP/2 GOAWAY — sesión cerrada por Apple');
        });
    });
}
function closeSession() {
    if (_session && !_session.destroyed) {
        _session.destroy();
        _session = null;
    }
}
// ══════════════════════════════════════════════════════════
// CONSTRUIR PAYLOAD APS
// ══════════════════════════════════════════════════════════
function buildApsPayload(opts) {
    const aps = {};
    if (!opts.silencioso) {
        aps.alert = {
            ...(opts.titulo ? { title: opts.titulo } : {}),
            ...(opts.subtitulo ? { subtitle: opts.subtitulo } : {}),
            ...(opts.cuerpo ? { body: opts.cuerpo } : {}),
        };
        aps.sound = opts.sound ?? 'default';
    }
    if (opts.badge !== undefined)
        aps.badge = opts.badge;
    if (opts.categoria)
        aps['category'] = opts.categoria;
    if (opts.threadId)
        aps['thread-id'] = opts.threadId;
    if (opts.silencioso)
        aps['content-available'] = 1;
    if (opts.mutableContent)
        aps['mutable-content'] = 1;
    const datos = { ...opts.datos, source: 'RODAID' };
    return { aps, ...datos };
}
// ══════════════════════════════════════════════════════════
// ENVIAR A UN TOKEN APNS
// ══════════════════════════════════════════════════════════
async function enviarAPNsToken(deviceToken, opts, meta) {
    const bundleId = meta?.bundleId ?? BUNDLE_ID;
    const entorno = meta?.entorno ?? APNS_ENV;
    const host = entorno === 'production' ? APNS_HOST_PROD : APNS_HOST_SANDBOX;
    if (!MODO_LIVE) {
        logger_1.log.mensajeria.warn({
            token: deviceToken.slice(0, 10) + '...',
            bundleId, titulo: opts.titulo ?? '(background)',
        }, '⚠ APNs STUB — configurar APNS_KEY_ID + APNS_TEAM_ID + APNS_PRIVATE_KEY');
        await registrarMensaje({
            usuarioId: meta?.usuarioId, tokenId: meta?.tokenId,
            deviceToken, bundleId,
            pushType: opts.pushType ?? (opts.silencioso ? 'background' : 'alert'),
            titulo: opts.titulo, subtitulo: opts.subtitulo, cuerpo: opts.cuerpo,
            badge: opts.badge, sound: typeof opts.sound === 'string' ? opts.sound : 'default',
            datos: opts.datos, prioridad: opts.prioridad ?? (opts.silencioso ? 5 : 10),
            estado: 'ENVIADO',
        });
        return { enviado: true, apnsId: 'stub_' + crypto_1.default.randomUUID(), stub: true };
    }
    const jwt = getJWT();
    const pushType = opts.pushType ?? (opts.silencioso ? 'background' : 'alert');
    const prioridad = opts.prioridad ?? (opts.silencioso ? 5 : 10);
    const body = Buffer.from(JSON.stringify(buildApsPayload(opts)));
    try {
        const session = await getSession(host);
        const resultado = await new Promise((resolve) => {
            const req = session.request({
                ':method': 'POST',
                ':path': `/3/device/${deviceToken}`,
                ':scheme': 'https',
                ':authority': host,
                'authorization': `bearer ${jwt}`,
                'content-type': 'application/json',
                'content-length': body.length.toString(),
                'apns-topic': bundleId,
                'apns-push-type': pushType,
                'apns-priority': prioridad.toString(),
                'apns-expiration': (opts.expiracion ?? 0).toString(),
                ...(opts.collapseId ? { 'apns-collapse-id': opts.collapseId } : {}),
            });
            let respHeaders = {};
            let respBody = '';
            req.on('response', (headers) => { respHeaders = headers; });
            req.on('data', (chunk) => { respBody += chunk; });
            req.on('end', () => {
                const status = parseInt(String(respHeaders[':status'] ?? '0'));
                const apnsId = String(respHeaders['apns-id'] ?? '');
                if (status === 200) {
                    resolve({ enviado: true, apnsId });
                    return;
                }
                // Error de APNs
                let errorCode;
                let errorMsg = `HTTP ${status}`;
                try {
                    const parsed = JSON.parse(respBody);
                    errorCode = parsed.reason;
                    errorMsg = `${parsed.reason}: ${parsed.timestamp ?? ''}`;
                }
                catch { /* noop */ }
                const tokenInvalido = ['Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic']
                    .includes(errorCode ?? '');
                resolve({ enviado: false, apnsId, errorCode, error: errorMsg, tokenInvalido });
            });
            req.on('error', (err) => {
                closeSession();
                resolve({ enviado: false, error: err.message });
            });
            req.setTimeout(8_000, () => {
                req.destroy();
                resolve({ enviado: false, error: 'APNs timeout (8s)' });
            });
            req.write(body);
            req.end();
        });
        // Desactivar token inválido
        if (resultado.tokenInvalido && meta?.tokenId) {
            await (0, database_1.query)(`UPDATE fcm_tokens SET activo=FALSE WHERE id=$1`, [meta.tokenId]).catch(() => { });
            logger_1.log.mensajeria.warn({ token: deviceToken.slice(0, 10) + '...', code: resultado.errorCode }, 'Token APNs inválido — desactivado');
        }
        const estado = resultado.enviado ? 'ENVIADO'
            : resultado.tokenInvalido ? 'INVALIDO' : 'FALLIDO';
        await registrarMensaje({
            usuarioId: meta?.usuarioId, tokenId: meta?.tokenId,
            deviceToken, apnsId: resultado.apnsId, bundleId,
            pushType, titulo: opts.titulo, subtitulo: opts.subtitulo,
            cuerpo: opts.cuerpo, badge: opts.badge,
            sound: typeof opts.sound === 'string' ? opts.sound : 'default',
            datos: opts.datos, prioridad, estado,
            errorCode: resultado.errorCode, error: resultado.error,
        });
        if (resultado.enviado) {
            logger_1.log.mensajeria.info({
                token: deviceToken.slice(0, 10) + '...', bundleId, pushType,
                titulo: opts.titulo ?? '(background)', apnsId: resultado.apnsId,
            }, '🍎 APNs push enviado');
        }
        else {
            logger_1.log.mensajeria.warn({
                token: deviceToken.slice(0, 10) + '...', errorCode: resultado.errorCode,
            }, `✗ APNs fallido: ${resultado.error}`);
        }
        return resultado;
    }
    catch (err) {
        const errMsg = err.message;
        await registrarMensaje({
            usuarioId: meta?.usuarioId, tokenId: meta?.tokenId,
            deviceToken, bundleId, pushType,
            titulo: opts.titulo, cuerpo: opts.cuerpo,
            prioridad, estado: 'FALLIDO', error: errMsg,
        });
        closeSession();
        return { enviado: false, error: errMsg };
    }
}
// ══════════════════════════════════════════════════════════
// ENVIAR A TODOS LOS TOKENS IOS DE UN USUARIO
// ══════════════════════════════════════════════════════════
async function enviarAPNsUsuario(usuarioId, opts, opcionesMeta) {
    const tokens = await (0, database_1.query)(`SELECT id, token, apns_env, bundle_id, push_tipo
     FROM fcm_tokens
     WHERE usuario_id=$1 AND activo=TRUE AND plataforma='IOS'
     ORDER BY ultimo_uso DESC NULLS LAST`, [usuarioId]);
    if (tokens.length === 0)
        return { enviados: 0, fallidos: 0, tokens_invalidos: [] };
    const resultados = await Promise.allSettled(tokens.map(t => {
        if (t.push_tipo === 'fcm') {
            // Token FCM para iOS → delegar a fcm.service
            const { enviarPushToken } = require('./fcm.service');
            return enviarPushToken(t.token, 'IOS', opts, {
                tokenId: t.id, notifId: opcionesMeta?.notifId, usuarioId,
            });
        }
        // Token APNs nativo
        return enviarAPNsToken(t.token, opts, {
            bundleId: t.bundle_id ?? BUNDLE_ID,
            entorno: t.apns_env ?? APNS_ENV,
            tokenId: t.id,
            usuarioId,
        });
    }));
    let enviados = 0;
    let fallidos = 0;
    const invalidos = [];
    resultados.forEach((r, i) => {
        const ok = r.status === 'fulfilled' && r.value.enviado;
        if (ok) {
            enviados++;
        }
        else {
            fallidos++;
            if (r.status === 'fulfilled' && r.value.tokenInvalido) {
                invalidos.push(tokens[i].token);
            }
        }
    });
    if (enviados > 0) {
        await (0, database_1.query)(`UPDATE fcm_tokens SET ultimo_uso=NOW() WHERE usuario_id=$1 AND plataforma='IOS' AND activo=TRUE`, [usuarioId]).catch(() => { });
    }
    return { enviados, fallidos, tokens_invalidos: invalidos };
}
// ══════════════════════════════════════════════════════════
// PAYLOADS PREDEFINIDOS PARA RODAID
// ══════════════════════════════════════════════════════════
/** Notificación de CIT emitido — con badge + deep link */
function payloadCITEmitido(numeroCIT, marca, modelo) {
    return {
        titulo: '✅ CIT emitido',
        subtitulo: `${marca} ${modelo}`,
        cuerpo: `Tu certificado ${numeroCIT} fue registrado en la Blockchain Federal Argentina.`,
        sound: 'default',
        badge: 1,
        mutableContent: true,
        datos: { tipo: 'CIT_APROBADO', numeroCIT, url: `rodaid://cit/${numeroCIT}` },
        categoria: 'CIT_EMITIDO',
        collapseId: `cit-${numeroCIT}`,
    };
}
/** Notificación de denuncia — urgente, máxima prioridad */
function payloadDenunciaRobo(serial, numeroDenuncia) {
    return {
        titulo: '🚨 Denuncia registrada',
        cuerpo: `S/N ${serial} — CIT bloqueado. Denuncia N° ${numeroDenuncia}`,
        sound: { name: 'default', critical: true, volume: 1.0 },
        prioridad: 10,
        datos: { tipo: 'DENUNCIA_REGISTRADA', serial, numeroDenuncia, url: `rodaid://denuncias/${numeroDenuncia}` },
        categoria: 'DENUNCIA_ROBO',
    };
}
/** Notificación silenciosa — actualizar estado en background */
function payloadBackground(tipo, datos) {
    return {
        silencioso: true,
        pushType: 'background',
        prioridad: 5,
        datos: { tipo, ...datos },
    };
}
/** Notificación de venta */
function payloadVenta(marca, modelo, montoNeto) {
    return {
        titulo: '💰 Venta confirmada',
        subtitulo: `${marca} ${modelo}`,
        cuerpo: `$${montoNeto.toLocaleString('es-AR')} ARS acreditados`,
        sound: 'default',
        badge: 1,
        datos: { tipo: 'VENTA_CONFIRMADA', url: 'rodaid://wallet' },
        categoria: 'VENTA_COMPLETADA',
    };
}
// ══════════════════════════════════════════════════════════
// REGISTRAR TOKEN APNS NATIVO
// ══════════════════════════════════════════════════════════
async function registrarTokenAPNs(opts) {
    const row = await (0, database_1.queryOne)(`INSERT INTO fcm_tokens
       (usuario_id, token, plataforma, dispositivo, app_version,
        apns_env, bundle_id, push_tipo, ultimo_uso)
     VALUES ($1,$2,'IOS',$3,$4,$5,$6,'apns',NOW())
     ON CONFLICT (usuario_id, token) DO UPDATE
       SET activo=TRUE, ultimo_uso=NOW(), apns_env=$5,
           bundle_id=$6, app_version=$4, actualizado_en=NOW()
     RETURNING id, (xmax=0) AS created`, [
        opts.usuarioId, opts.deviceToken,
        opts.dispositivo ?? null, opts.appVersion ?? null,
        opts.entorno, opts.bundleId ?? BUNDLE_ID,
    ]);
    logger_1.log.mensajeria.info({
        usuarioId: opts.usuarioId.slice(0, 8),
        entorno: opts.entorno, nuevo: row?.created,
    }, `🍎 Token APNs ${row?.created ? 'registrado' : 'actualizado'}`);
    return { tokenId: row.id, nuevo: !!row?.created };
}
// ══════════════════════════════════════════════════════════
// ESTADÍSTICAS APNs
// ══════════════════════════════════════════════════════════
async function getEstadisticasAPNs(dias = 30) {
    const [msgs, tokens] = await Promise.all([
        (0, database_1.queryOne)(`SELECT
         COUNT(*)::text                                         AS total,
         COUNT(*) FILTER (WHERE estado='ENVIADO')::text        AS env,
         COUNT(*) FILTER (WHERE estado='FALLIDO')::text        AS fall,
         COUNT(*) FILTER (WHERE estado='INVALIDO')::text       AS inv
       FROM apns_mensajes WHERE enviado_en > NOW()-($1||' days')::interval`, [dias]),
        (0, database_1.queryOne)(`SELECT
         COUNT(*) FILTER (WHERE apns_env='sandbox')::text    AS sandbox,
         COUNT(*) FILTER (WHERE apns_env='production')::text AS production
       FROM fcm_tokens WHERE plataforma='IOS' AND activo=TRUE AND push_tipo='apns'`, []),
    ]);
    const total = parseInt(msgs?.total ?? '0');
    const env = parseInt(msgs?.env ?? '0');
    return {
        totalMensajes: total,
        enviados: env,
        fallidos: parseInt(msgs?.fall ?? '0'),
        invalidos: parseInt(msgs?.inv ?? '0'),
        sandbox: parseInt(tokens?.sandbox ?? '0'),
        production: parseInt(tokens?.production ?? '0'),
        tasaEntrega: total > 0 ? Math.round(env / total * 100) : 100,
    };
}
function getModoAPNs() { return MODO_LIVE ? 'LIVE' : 'STUB'; }
function getApnsEnv() { return APNS_ENV; }
function getBundleId() { return BUNDLE_ID; }
// ── Helper privado ──────────────────────────────────────
async function registrarMensaje(opts) {
    await (0, database_1.query)(`INSERT INTO apns_mensajes
       (usuario_id, token_id, device_token, apns_id, bundle_id, push_type,
        titulo, subtitulo, cuerpo, badge, sound, categoria,
        datos_extra, collapse_id, prioridad, estado, error_code, error_msg)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18)`, [
        opts.usuarioId ?? null, opts.tokenId ?? null,
        opts.deviceToken, opts.apnsId ?? null, opts.bundleId ?? null,
        opts.pushType ?? 'alert',
        opts.titulo ?? null, opts.subtitulo ?? null, opts.cuerpo ?? null,
        opts.badge ?? null, opts.sound ?? null, opts.categoria ?? null,
        opts.datos ? JSON.stringify(opts.datos) : null,
        opts.collapseId ?? null, opts.prioridad ?? 10,
        opts.estado, opts.errorCode ?? null, opts.error ?? null,
    ]).catch(() => { });
}
