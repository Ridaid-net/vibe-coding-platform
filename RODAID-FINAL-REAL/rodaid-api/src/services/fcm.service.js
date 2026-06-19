"use strict";
// ─── RODAID · Firebase Cloud Messaging Service ───────────
// Envía push notifications a dispositivos web y Android.
//
// Autenticación:
//   - FCM HTTP v1 API (la legacy /fcm/send fue deprecada jun-2024)
//   - OAuth2 Bearer token generado con la Service Account
//   - Token se renueva automáticamente antes de vencer
//
// Modos:
//   LIVE (FCM_PROJECT_ID + FCM_PRIVATE_KEY + FCM_CLIENT_EMAIL):
//     → Envía mensajes reales via POST /v1/projects/{id}/messages:send
//   STUB (sin credenciales):
//     → Log solamente — útil para dev
//
// Plataformas soportadas:
//   WEB     → notification + webpush config (chrome/firefox service worker)
//   ANDROID → notification + android config (canal rodaid_alertas)
//   IOS     → apns config (cuando se agregue en el futuro)
//
// Tópicos (FCM topics):
//   denuncias_zona_{provincia}   → alertas de robo en la zona
//   cit_updates_{citId}          → actualizaciones de un CIT
//   sistema_rodaid               → mensajes del sistema
//
// Device token lifecycle:
//   POST /api/v1/usuarios/fcm-token { token, plataforma, dispositivo }
//   → INSERT o UPDATE fcm_tokens
//   DELETE /api/v1/usuarios/fcm-token { token }
//   → marcar activo=FALSE
//   Token inválido retornado por FCM → auto-desactivar
Object.defineProperty(exports, "__esModule", { value: true });
exports.enviarPushToken = enviarPushToken;
exports.enviarPushUsuario = enviarPushUsuario;
exports.enviarPushTopico = enviarPushTopico;
exports.registrarToken = registrarToken;
exports.desregistrarToken = desregistrarToken;
exports.getTokensUsuario = getTokensUsuario;
exports.suscribirTopico = suscribirTopico;
exports.desuscribirTopico = desuscribirTopico;
exports.getEstadisticas = getEstadisticas;
exports.getModo = getModo;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const env_1 = require("../config/env");
// ══════════════════════════════════════════════════════════
// MODO DE OPERACIÓN
// ══════════════════════════════════════════════════════════
const MODO_LIVE = !!(env_1.env.FCM_PROJECT_ID && env_1.env.FCM_PRIVATE_KEY && env_1.env.FCM_CLIENT_EMAIL);
const PROJECT_ID = env_1.env.FCM_PROJECT_ID ?? '';
const FCM_SEND_URL = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
// ══════════════════════════════════════════════════════════
// OAUTH2: generar Bearer token para FCM v1
// ══════════════════════════════════════════════════════════
let _accessToken = null;
let _tokenExpira = 0;
async function getOAuthToken() {
    if (!MODO_LIVE)
        return 'STUB_TOKEN';
    // Usar token cacheado si aún es válido (con 60s de buffer)
    if (_accessToken && Date.now() < _tokenExpira - 60_000)
        return _accessToken;
    try {
        // Importar firebase-admin para simplificar OAuth2
        // Alternativa manual: JWT firmado con RS256 usando la private key
        const admin = await import('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: env_1.env.FCM_PROJECT_ID,
                    privateKey: env_1.env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    clientEmail: env_1.env.FCM_CLIENT_EMAIL,
                }),
            });
        }
        const token = await admin.app().options.credential.getAccessToken();
        _accessToken = token.access_token;
        _tokenExpira = Date.now() + (token.expires_in ?? 3600) * 1000;
        return _accessToken;
    }
    catch (err) {
        logger_1.log.mensajeria.error({ err: err.message }, '✗ Error obteniendo OAuth token para FCM');
        return null;
    }
}
// ══════════════════════════════════════════════════════════
// CONSTRUIR MENSAJE FCM v1
// ══════════════════════════════════════════════════════════
function buildMessage(token, plataforma, payload) {
    const datos = {
        ...payload.datos,
        source: 'RODAID',
        click_url: payload.clickUrl ?? '',
    };
    const base = {
        token,
        ...(payload.silencioso ? {} : {
            notification: {
                title: payload.titulo,
                body: payload.cuerpo,
                ...(payload.imagen ? { image: payload.imagen } : {}),
            },
        }),
        data: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, String(v)])),
    };
    if (plataforma === 'ANDROID') {
        return {
            ...base,
            android: {
                priority: 'high',
                notification: {
                    channel_id: 'rodaid_alertas',
                    sound: 'default',
                    click_action: payload.clickUrl,
                    icon: payload.icono ?? 'ic_notification',
                    color: '#F97316', // naranja RODAID
                    ...(payload.imagen ? { image_url: payload.imagen } : {}),
                },
                collapse_key: 'RODAID',
            },
        };
    }
    if (plataforma === 'WEB') {
        return {
            ...base,
            webpush: {
                headers: { Urgency: payload.silencioso ? 'normal' : 'high' },
                notification: {
                    title: payload.titulo,
                    body: payload.cuerpo,
                    icon: payload.icono ?? 'https://rodaid.com.ar/icon-192.png',
                    badge: 'https://rodaid.com.ar/badge-72.png',
                    requireInteraction: false,
                    ...(payload.clickUrl ? { click_action: payload.clickUrl } : {}),
                    ...(payload.imagen ? { image: payload.imagen } : {}),
                },
                fcm_options: {
                    link: payload.clickUrl ?? 'https://rodaid.com.ar',
                },
            },
        };
    }
    // iOS — APNs via FCM (cuando la app iOS usa Firebase SDK)
    // Para APNs directo (sin Firebase) usar apns.service.ts
    const apsAlert = payload.silencioso ? undefined : {
        title: payload.titulo,
        body: payload.cuerpo,
        ...(payload.subtitulo ? { subtitle: payload.subtitulo } : {}),
    };
    return {
        ...base,
        apns: {
            headers: {
                'apns-priority': payload.silencioso ? '5' : '10',
                'apns-push-type': payload.silencioso ? 'background' : 'alert',
                'apns-topic': process.env.APNS_BUNDLE_ID ?? 'com.rodaid.app',
                ...(payload.collapseId ? { 'apns-collapse-id': payload.collapseId } : {}),
            },
            payload: {
                aps: {
                    ...(apsAlert ? { alert: apsAlert } : {}),
                    sound: payload.silencioso ? undefined : (payload.sound ?? 'default'),
                    ...(payload.badge !== undefined ? { badge: payload.badge } : { badge: 1 }),
                    ...(payload.mutableContent !== false ? { 'mutable-content': 1 } : {}),
                    'content-available': payload.silencioso ? 1 : 0,
                    ...(payload.categoria ? { category: payload.categoria } : {}),
                    ...(payload.threadId ? { 'thread-id': payload.threadId } : {}),
                },
                ...Object.fromEntries(Object.entries({ ...payload.datos, source: 'RODAID' }).map(([k, v]) => [k, String(v)])),
            },
            fcm_options: {
                image: payload.imagen ?? undefined,
            },
        },
    };
}
// ══════════════════════════════════════════════════════════
// ENVIAR A UN TOKEN
// ══════════════════════════════════════════════════════════
async function enviarPushToken(fcmToken, plataforma, payload, opts) {
    if (!MODO_LIVE) {
        logger_1.log.mensajeria.warn({
            token: fcmToken.slice(0, 10) + '...',
            plataforma, titulo: payload.titulo,
        }, '⚠ FCM STUB — configurar FCM_PROJECT_ID + FCM_PRIVATE_KEY + FCM_CLIENT_EMAIL');
        // Registrar intento en historial
        await registrarMensaje({ ...opts, plataforma, titulo: payload.titulo, cuerpo: payload.cuerpo, estado: 'ENVIADO', datos: payload.datos });
        return { enviado: true, messageId: 'stub_' + Date.now() };
    }
    const authToken = await getOAuthToken();
    if (!authToken)
        return { enviado: false, error: 'Sin token OAuth para FCM' };
    try {
        const mensaje = buildMessage(fcmToken, plataforma, payload);
        const res = await fetch(FCM_SEND_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ message: mensaje }),
            signal: AbortSignal.timeout(8_000),
        });
        const body = await res.json();
        if (!res.ok) {
            const errMsg = body.error?.message ?? `HTTP ${res.status}`;
            const tokenInvalido = ['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND']
                .includes(body.error?.status ?? '');
            if (tokenInvalido) {
                // Desactivar token inválido en DB
                await (0, database_1.query)(`UPDATE fcm_tokens SET activo=FALSE WHERE token=$1`, [fcmToken]).catch(() => { });
                logger_1.log.mensajeria.warn({ token: fcmToken.slice(0, 10) + '...', status: body.error?.status }, 'Token FCM inválido — desactivado');
            }
            await registrarMensaje({ ...opts, plataforma, titulo: payload.titulo, cuerpo: payload.cuerpo, estado: 'FALLIDO', error: errMsg, datos: payload.datos });
            return { enviado: false, error: errMsg, tokenInvalido };
        }
        const messageId = body.name ?? '';
        logger_1.log.mensajeria.info({ token: fcmToken.slice(0, 10) + '...', plataforma, titulo: payload.titulo, messageId }, '📱 Push FCM enviado');
        await registrarMensaje({ ...opts, plataforma, titulo: payload.titulo, cuerpo: payload.cuerpo, estado: 'ENVIADO', messageId, datos: payload.datos });
        return { enviado: true, messageId };
    }
    catch (err) {
        const errMsg = err.message;
        await registrarMensaje({ ...opts, plataforma, titulo: payload.titulo, cuerpo: payload.cuerpo, estado: 'FALLIDO', error: errMsg, datos: payload.datos });
        return { enviado: false, error: errMsg };
    }
}
// ══════════════════════════════════════════════════════════
// ENVIAR A TODOS LOS TOKENS DE UN USUARIO
// ══════════════════════════════════════════════════════════
async function enviarPushUsuario(usuarioId, payload, opts) {
    const plataformaFiltro = opts?.plataformas?.length
        ? `AND plataforma = ANY(ARRAY[${opts.plataformas.map(p => `'${p}'`).join(',')}])`
        : '';
    const tokens = await (0, database_1.query)(`SELECT id, token, plataforma FROM fcm_tokens
     WHERE usuario_id=$1 AND activo=TRUE ${plataformaFiltro}
     ORDER BY ultimo_uso DESC NULLS LAST`, [usuarioId]);
    if (tokens.length === 0) {
        return { enviados: 0, fallidos: 0, tokens_invalidos: [] };
    }
    const resultados = await Promise.allSettled(tokens.map(t => enviarPushToken(t.token, t.plataforma, payload, {
        tokenId: t.id, notifId: opts?.notifId, usuarioId,
    })));
    let enviados = 0;
    let fallidos = 0;
    const invalidos = [];
    resultados.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            if (r.value.enviado)
                enviados++;
            else {
                fallidos++;
                if (r.value.tokenInvalido)
                    invalidos.push(tokens[i].token);
            }
        }
        else {
            fallidos++;
        }
    });
    // Actualizar último uso de los tokens exitosos
    if (enviados > 0) {
        await (0, database_1.query)(`UPDATE fcm_tokens SET ultimo_uso=NOW() WHERE usuario_id=$1 AND activo=TRUE`, [usuarioId]).catch(() => { });
    }
    return { enviados, fallidos, tokens_invalidos: invalidos };
}
// ══════════════════════════════════════════════════════════
// ENVIAR A UN TÓPICO
// ══════════════════════════════════════════════════════════
async function enviarPushTopico(topico, payload) {
    if (!MODO_LIVE) {
        logger_1.log.mensajeria.warn({ topico, titulo: payload.titulo }, '⚠ FCM STUB — envío a tópico simulado');
        return { enviado: true, messageId: 'stub_topic_' + Date.now() };
    }
    const authToken = await getOAuthToken();
    if (!authToken)
        return { enviado: false, error: 'Sin token OAuth' };
    try {
        const topicoFormateado = `/topics/${topico}`;
        const res = await fetch(FCM_SEND_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({
                message: {
                    topic: topico,
                    notification: { title: payload.titulo, body: payload.cuerpo },
                    data: Object.fromEntries(Object.entries({ ...payload.datos, source: 'RODAID' }).map(([k, v]) => [k, String(v)])),
                    android: { priority: 'high', notification: { channel_id: 'rodaid_alertas', color: '#F97316' } },
                },
            }),
            signal: AbortSignal.timeout(8_000),
        });
        const body = await res.json();
        if (!res.ok)
            return { enviado: false, error: body.error?.message ?? `HTTP ${res.status}` };
        logger_1.log.mensajeria.info({ topico, titulo: payload.titulo, messageId: body.name }, '📢 Push FCM tópico enviado');
        return { enviado: true, messageId: body.name };
    }
    catch (err) {
        return { enviado: false, error: err.message };
    }
}
// ══════════════════════════════════════════════════════════
// GESTIÓN DE DEVICE TOKENS
// ══════════════════════════════════════════════════════════
async function registrarToken(opts) {
    // Upsert: si el token ya existe para este usuario → actualizar; si no → insertar
    const row = await (0, database_1.queryOne)(`INSERT INTO fcm_tokens (usuario_id, token, plataforma, dispositivo, app_version, ultimo_uso)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (usuario_id, token) DO UPDATE
       SET activo=TRUE, ultimo_uso=NOW(),
           dispositivo=EXCLUDED.dispositivo,
           app_version=EXCLUDED.app_version,
           actualizado_en=NOW()
     RETURNING id, (xmax=0) AS created`, [opts.usuarioId, opts.token, opts.plataforma, opts.dispositivo ?? null, opts.appVersion ?? null]);
    logger_1.log.mensajeria.info({
        usuarioId: opts.usuarioId.slice(0, 8),
        plataforma: opts.plataforma,
        nuevo: row?.created,
        dispositivo: opts.dispositivo,
    }, `📱 FCM token ${row?.created ? 'registrado' : 'actualizado'}`);
    return { tokenId: row.id, nuevo: !!row?.created };
}
async function desregistrarToken(token, usuarioId) {
    const result = await (0, database_1.query)(`UPDATE fcm_tokens SET activo=FALSE, actualizado_en=NOW()
     WHERE token=$1 AND usuario_id=$2 AND activo=TRUE
     RETURNING id`, [token, usuarioId]);
    return result.length > 0;
}
async function getTokensUsuario(usuarioId) {
    return (0, database_1.query)(`SELECT id, plataforma, dispositivo, ultimo_uso, activo, creado_en
     FROM fcm_tokens WHERE usuario_id=$1 ORDER BY ultimo_uso DESC NULLS LAST`, [usuarioId]);
}
// ══════════════════════════════════════════════════════════
// TÓPICOS: suscribir/desuscribir dispositivos
// ══════════════════════════════════════════════════════════
async function suscribirTopico(tokens, topico) {
    if (!MODO_LIVE) {
        logger_1.log.mensajeria.warn({ topico, count: tokens.length }, '⚠ FCM STUB — suscripción a tópico simulada');
        return;
    }
    const authToken = await getOAuthToken();
    if (!authToken)
        return;
    await fetch(`https://iid.googleapis.com/iid/v1:batchAdd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ registration_tokens: tokens, to: `/topics/${topico}` }),
    }).catch(() => { });
}
async function desuscribirTopico(tokens, topico) {
    if (!MODO_LIVE)
        return;
    const authToken = await getOAuthToken();
    if (!authToken)
        return;
    await fetch(`https://iid.googleapis.com/iid/v1:batchRemove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ registration_tokens: tokens, to: `/topics/${topico}` }),
    }).catch(() => { });
}
// ══════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ══════════════════════════════════════════════════════════
async function getEstadisticas(dias = 30) {
    const [tokens, mensajes] = await Promise.all([
        (0, database_1.queryOne)(`SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE plataforma='WEB')::text     AS web,
         COUNT(*) FILTER (WHERE plataforma='ANDROID')::text AS android,
         COUNT(*) FILTER (WHERE plataforma='IOS')::text     AS ios
       FROM fcm_tokens WHERE activo=TRUE`, []),
        (0, database_1.queryOne)(`SELECT
         COUNT(*) FILTER (WHERE estado='ENVIADO')::text  AS enviados,
         COUNT(*) FILTER (WHERE estado='FALLIDO')::text  AS fallidos
       FROM fcm_mensajes WHERE enviado_en > NOW()-($1||' days')::interval`, [dias]),
    ]);
    const env = parseInt(mensajes?.enviados ?? '0');
    const fall = parseInt(mensajes?.fallidos ?? '0');
    return {
        totalTokens: parseInt(tokens?.total ?? '0'),
        web: parseInt(tokens?.web ?? '0'),
        android: parseInt(tokens?.android ?? '0'),
        ios: parseInt(tokens?.ios ?? '0'),
        mensajesEnviados: env,
        mensajesFallidos: fall,
        tasaEntrega: (env + fall) > 0 ? Math.round(env / (env + fall) * 100) : 100,
    };
}
function getModo() { return MODO_LIVE ? 'LIVE' : 'STUB'; }
// ── Helper privado ──────────────────────────────────────
async function registrarMensaje(opts) {
    await (0, database_1.query)(`INSERT INTO fcm_mensajes
       (usuario_id, notif_id, token_id, plataforma, titulo, cuerpo,
        datos_extra, estado, fcm_message_id, error_msg)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`, [
        opts.usuarioId ?? null, opts.notifId ?? null, opts.tokenId ?? null,
        opts.plataforma ?? null, opts.titulo ?? null, opts.cuerpo ?? null,
        opts.datos ? JSON.stringify(opts.datos) : null,
        opts.estado, opts.messageId ?? null, opts.error ?? null,
    ]).catch(() => { });
}
