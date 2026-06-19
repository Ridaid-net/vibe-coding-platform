"use strict";
// ─── RODAID · Device Token Service ───────────────────────
// Gestión unificada de tokens de dispositivo para push
// notifications. Abstrae FCM (Android/Web) y APNs (iOS)
// detrás de una interfaz única.
//
// Tabla: device_tokens (no fcm_tokens — esa fue un naming error)
//
// Flujo de registro:
//   App → POST /usuarios/device-token { token, proveedor, plataforma }
//   → upsert en device_tokens (deduplicación por usuario+token)
//   → responde { tokenId, nuevo }
//
// Flujo de envío:
//   servicio → enviarPush(usuarioId, payload)
//   → SELECT tokens activos y válidos del usuario
//   → para cada token:
//       proveedor=FCM  → fcm.service.enviarPushToken()
//       proveedor=APNS → apns.service.enviarAPNsToken()
//   → registrar resultado (enviados, fallos, token_invalido)
//
// Token rotation (FCM notifica que el token cambió):
//   POST /usuarios/device-token/rotar { tokenViejo, tokenNuevo }
//   → desactivar el viejo con motivo ROTACION
//   → registrar el nuevo
//
// Limpieza de tokens:
//   limpiarInactivos(dias=90) — llamar con cron semanal
//   → DELETE tokens no activos con > 90 días de antigüedad
//   → UPDATE valido=FALSE para tokens que fallaron > 5 veces
//
// Estadísticas:
//   getEstadisticas() — tokens totales, por plataforma,
//     tasa de entrega, stale tokens, etc.
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarDeviceToken = registrarDeviceToken;
exports.desactivarToken = desactivarToken;
exports.desactivarTodosLosTokens = desactivarTodosLosTokens;
exports.rotarToken = rotarToken;
exports.getTokensUsuario = getTokensUsuario;
exports.enviarPush = enviarPush;
exports.enviarPushMultiple = enviarPushMultiple;
exports.limpiarTokensInactivos = limpiarTokensInactivos;
exports.getEstadisticas = getEstadisticas;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const redis_1 = require("../config/redis");
// ══════════════════════════════════════════════════════════
// REGISTRO DE TOKENS
// ══════════════════════════════════════════════════════════
async function registrarDeviceToken(opts) {
    // Validación mínima
    if (!opts.token || opts.token.length < 10) {
        throw Object.assign(new Error('Token inválido (muy corto)'), { code: 'INVALID_TOKEN', status: 400 });
    }
    const row = await (0, database_1.queryOne)(`INSERT INTO device_tokens
       (usuario_id, token, proveedor, plataforma, dispositivo, app_version,
        locale, apns_env, bundle_id, fcm_project, ultimo_uso)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (usuario_id, token) DO UPDATE SET
       activo         = TRUE,
       valido         = TRUE,
       motivo_baja    = NULL,
       ultimo_uso     = NOW(),
       dispositivo    = COALESCE(EXCLUDED.dispositivo, device_tokens.dispositivo),
       app_version    = COALESCE(EXCLUDED.app_version,  device_tokens.app_version),
       locale         = COALESCE(EXCLUDED.locale,        device_tokens.locale),
       apns_env       = COALESCE(EXCLUDED.apns_env,      device_tokens.apns_env),
       bundle_id      = COALESCE(EXCLUDED.bundle_id,     device_tokens.bundle_id),
       fcm_project    = COALESCE(EXCLUDED.fcm_project,   device_tokens.fcm_project)
     RETURNING id, (xmax=0) AS created`, [
        opts.usuarioId, opts.token, opts.proveedor, opts.plataforma,
        opts.dispositivo ?? null, opts.appVersion ?? null,
        opts.locale ?? 'es-AR',
        opts.apnsEnv ?? 'sandbox', opts.bundleId ?? null, opts.fcmProject ?? null,
    ]);
    // Invalidar cache de tokens del usuario
    await invalidarCacheTokens(opts.usuarioId);
    logger_1.log.mensajeria.info({
        usuarioId: opts.usuarioId.slice(0, 8),
        proveedor: opts.proveedor,
        plataforma: opts.plataforma,
        nuevo: row?.created,
        dispositivo: opts.dispositivo,
    }, `📲 Token ${opts.proveedor}/${opts.plataforma} ${row?.created ? 'registrado' : 'actualizado'}`);
    return { tokenId: row.id, nuevo: !!row?.created };
}
// ══════════════════════════════════════════════════════════
// DESACTIVAR TOKEN
// ══════════════════════════════════════════════════════════
async function desactivarToken(token, usuarioId, motivo = 'USER_REQUEST') {
    const result = await (0, database_1.query)(`UPDATE device_tokens SET
       activo=FALSE, motivo_baja=$3, desactivado_en=NOW()
     WHERE token=$1 AND usuario_id=$2 AND activo=TRUE
     RETURNING id`, [token, usuarioId, motivo]);
    if (result.length > 0)
        await invalidarCacheTokens(usuarioId);
    return result.length > 0;
}
/** Desactivar todos los tokens de un usuario (logout completo) */
async function desactivarTodosLosTokens(usuarioId, motivo = 'LOGOUT') {
    const result = await (0, database_1.query)(`UPDATE device_tokens SET activo=FALSE, motivo_baja=$2, desactivado_en=NOW()
     WHERE usuario_id=$1 AND activo=TRUE RETURNING id`, [usuarioId, motivo]);
    await invalidarCacheTokens(usuarioId);
    logger_1.log.mensajeria.info({ usuarioId: usuarioId.slice(0, 8), count: result.length, motivo }, `🗑 ${result.length} tokens desactivados (${motivo})`);
    return result.length;
}
// ══════════════════════════════════════════════════════════
// ROTACIÓN DE TOKEN
// ══════════════════════════════════════════════════════════
/**
 * Cuando FCM devuelve un nuevo token (rotation), el cliente envía
 * ambos para que el backend actualice el registro.
 */
async function rotarToken(opts) {
    // 1. Registrar el token nuevo
    const nuevo = await registrarDeviceToken({
        usuarioId: opts.usuarioId,
        token: opts.tokenNuevo,
        proveedor: opts.proveedor,
        plataforma: opts.plataforma,
        dispositivo: opts.dispositivo,
        appVersion: opts.appVersion,
    });
    // 2. Desactivar el token viejo
    const tokenViejoRow = await (0, database_1.queryOne)(`SELECT id FROM device_tokens WHERE token=$1 AND usuario_id=$2`, [opts.tokenViejo, opts.usuarioId]);
    await desactivarToken(opts.tokenViejo, opts.usuarioId, 'ROTACION');
    // 3. Registrar la rotación para auditoría
    if (tokenViejoRow) {
        await (0, database_1.query)(`INSERT INTO device_token_rotaciones (usuario_id, token_viejo_id, token_nuevo_id, motivo)
       VALUES ($1,$2,$3,'FCM_TOKEN_REFRESH')`, [opts.usuarioId, tokenViejoRow.id, nuevo.tokenId]).catch(() => { });
    }
    logger_1.log.mensajeria.info({
        usuarioId: opts.usuarioId.slice(0, 8),
        viejo: opts.tokenViejo.slice(0, 10) + '...',
        nuevo: opts.tokenNuevo.slice(0, 10) + '...',
    }, '🔄 Token rotado');
    return { tokenId: nuevo.tokenId, rotado: true };
}
// ══════════════════════════════════════════════════════════
// OBTENER TOKENS
// ══════════════════════════════════════════════════════════
const CACHE_TTL = 300; // 5 minutos
async function getTokensUsuario(usuarioId, opciones) {
    // Intentar cache Redis para reducir queries
    if (!opciones?.plataformas && opciones?.soloActivos !== false) {
        const redis = (0, redis_1.getRedis)();
        const cacheKey = `dt:tokens:${usuarioId}`;
        const cached = await redis.get(cacheKey).catch(() => null);
        if (cached)
            return JSON.parse(cached);
    }
    const condPlataforma = opciones?.plataformas?.length
        ? `AND plataforma = ANY(ARRAY[${opciones.plataformas.map(p => `'${p}'`).join(',')}])`
        : '';
    const condActivo = opciones?.soloActivos !== false ? 'AND activo=TRUE AND valido=TRUE' : '';
    const rows = await (0, database_1.query)(`SELECT id, usuario_id, token, proveedor, plataforma, dispositivo, app_version,
            locale, apns_env, bundle_id, activo, valido, motivo_baja,
            enviados, fallos, ultimo_envio, ultimo_uso, creado_en
     FROM device_tokens
     WHERE usuario_id=$1 ${condActivo} ${condPlataforma}
     ORDER BY ultimo_uso DESC NULLS LAST`, [usuarioId]);
    const tokens = rows.map(mapRow);
    // Cachear resultado
    if (!opciones?.plataformas && opciones?.soloActivos !== false) {
        const redis = (0, redis_1.getRedis)();
        await redis.set(`dt:tokens:${usuarioId}`, JSON.stringify(tokens), 'EX', CACHE_TTL).catch(() => { });
    }
    return tokens;
}
// ══════════════════════════════════════════════════════════
// ENVIAR PUSH — DESPACHO UNIFICADO
// ══════════════════════════════════════════════════════════
async function enviarPush(usuarioId, payload, opts) {
    const tokens = await getTokensUsuario(usuarioId, {
        plataformas: opts?.plataformas,
        soloActivos: true,
    });
    if (tokens.length === 0) {
        return { enviados: 0, fallidos: 0, tokensInvalidos: [], detalles: [] };
    }
    const maxFallos = opts?.maxFallos ?? 5;
    const resultados = await Promise.allSettled(tokens.map(async (t) => {
        const ok = await despacharAProveedor(t, payload, usuarioId, opts?.notifId);
        return { tokenId: t.id, plataforma: t.plataforma, token: t.token, ...ok };
    }));
    let enviados = 0;
    let fallidos = 0;
    const invalidos = [];
    const detalles = [];
    for (let i = 0; i < resultados.length; i++) {
        const r = resultados[i];
        const token = tokens[i];
        if (r.status === 'fulfilled') {
            const { ok, error, tokenInvalido } = r.value;
            detalles.push({ tokenId: token.id, plataforma: token.plataforma, ok, error });
            if (ok) {
                enviados++;
                await (0, database_1.query)(`UPDATE device_tokens SET
             enviados=enviados+1, ultimo_envio=NOW(), ultimo_uso=NOW()
           WHERE id=$1`, [token.id]).catch(() => { });
            }
            else {
                fallidos++;
                const nuevosFallos = token.fallos + 1;
                if (tokenInvalido) {
                    invalidos.push(token.token);
                    await (0, database_1.query)(`UPDATE device_tokens SET
               activo=FALSE, valido=FALSE, motivo_baja='INVALID_TOKEN',
               fallos=fallos+1, ultimo_error=$2, desactivado_en=NOW()
             WHERE id=$1`, [token.id, error ?? 'Token inválido']).catch(() => { });
                }
                else {
                    await (0, database_1.query)(`UPDATE device_tokens SET fallos=fallos+1, ultimo_error=$2,
               activo = CASE WHEN fallos+1 >= $3 THEN FALSE ELSE activo END,
               motivo_baja = CASE WHEN fallos+1 >= $3 THEN 'INACTIVO' ELSE motivo_baja END
             WHERE id=$1`, [token.id, error ?? 'Error desconocido', maxFallos]).catch(() => { });
                    if (nuevosFallos >= maxFallos) {
                        logger_1.log.mensajeria.warn({ tokenId: token.id.slice(0, 8), fallos: nuevosFallos }, `Token desactivado por ${nuevosFallos} fallos consecutivos`);
                    }
                }
            }
        }
        else {
            fallidos++;
            detalles.push({ tokenId: token.id, plataforma: token.plataforma, ok: false, error: r.reason?.message });
        }
    }
    if (enviados > 0 || invalidos.length > 0) {
        await invalidarCacheTokens(usuarioId);
    }
    return { enviados, fallidos, tokensInvalidos: invalidos, detalles };
}
/** Despachar al proveedor correcto */
async function despacharAProveedor(token, payload, usuarioId, notifId) {
    try {
        if (token.proveedor === 'APNS') {
            const { enviarAPNsToken } = await import('./apns.service');
            const r = await enviarAPNsToken(token.token, {
                titulo: payload.titulo,
                subtitulo: payload.subtitulo,
                cuerpo: payload.cuerpo,
                badge: payload.badge ?? 1,
                sound: payload.sound ?? 'default',
                categoria: payload.categoria,
                collapseId: payload.collapseId,
                silencioso: payload.silencioso,
                mutableContent: payload.mutableContent,
                threadId: payload.threadId,
                datos: payload.datos,
            }, {
                bundleId: token.bundleId ?? undefined,
                entorno: token.apnsEnv ?? 'sandbox',
                tokenId: token.id,
                usuarioId,
            });
            return { ok: r.enviado, error: r.error, tokenInvalido: r.tokenInvalido };
        }
        // FCM (Android, Web, iOS via FCM)
        const { enviarPushToken } = await import('./fcm.service');
        const r = await enviarPushToken(token.token, token.plataforma, {
            titulo: payload.titulo,
            cuerpo: payload.cuerpo,
            icono: payload.icono,
            imagen: payload.imagen,
            clickUrl: payload.clickUrl,
            datos: payload.datos,
            silencioso: payload.silencioso,
            badge: payload.badge,
            sound: payload.sound,
            subtitulo: payload.subtitulo,
            mutableContent: payload.mutableContent,
            collapseId: payload.collapseId,
            categoria: payload.categoria,
            threadId: payload.threadId,
        }, { tokenId: token.id, notifId, usuarioId });
        return { ok: r.enviado, error: r.error, tokenInvalido: r.tokenInvalido };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
// ══════════════════════════════════════════════════════════
// ENVÍO BATCH: múltiples usuarios a la vez
// ══════════════════════════════════════════════════════════
async function enviarPushMultiple(usuarioIds, payload, opts) {
    const concurrencia = opts?.concurrencia ?? 10;
    let totalEnviados = 0;
    let totalFallidos = 0;
    let sinTokens = 0;
    // Procesar en lotes de N para no saturar la DB
    for (let i = 0; i < usuarioIds.length; i += concurrencia) {
        const lote = usuarioIds.slice(i, i + concurrencia);
        const resultados = await Promise.allSettled(lote.map(uid => enviarPush(uid, payload, { plataformas: opts?.plataformas })));
        for (const r of resultados) {
            if (r.status === 'fulfilled') {
                totalEnviados += r.value.enviados;
                totalFallidos += r.value.fallidos;
                if (r.value.enviados === 0 && r.value.fallidos === 0)
                    sinTokens++;
            }
            else {
                totalFallidos++;
            }
        }
    }
    logger_1.log.mensajeria.info({
        total: usuarioIds.length, totalEnviados, totalFallidos, sinTokens,
    }, `📢 Batch push completado`);
    return { totalEnviados, totalFallidos, usuariosSinTokens: sinTokens };
}
// ══════════════════════════════════════════════════════════
// LIMPIEZA DE TOKENS STALE
// ══════════════════════════════════════════════════════════
async function limpiarTokensInactivos(diasAntiguedad = 90) {
    // 1. Eliminar tokens inactivos con más de N días
    const eliminados = await (0, database_1.query)(`DELETE FROM device_tokens
     WHERE NOT activo AND desactivado_en < NOW() - ($1||' days')::interval
     RETURNING id`, [diasAntiguedad]);
    // 2. Marcar como inválidos tokens sin uso en 60 días y con > 3 fallos
    const invalidados = await (0, database_1.query)(`UPDATE device_tokens SET valido=FALSE, motivo_baja='INACTIVO'
     WHERE activo=TRUE AND valido=TRUE
       AND (ultimo_uso IS NULL OR ultimo_uso < NOW() - INTERVAL '60 days')
       AND fallos > 3
     RETURNING id`, []);
    if (eliminados.length > 0 || invalidados.length > 0) {
        logger_1.log.mensajeria.info({
            eliminados: eliminados.length, invalidados: invalidados.length,
        }, `🧹 Tokens limpiados`);
    }
    return { eliminados: eliminados.length, invalidados: invalidados.length };
}
// ══════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ══════════════════════════════════════════════════════════
async function getEstadisticas() {
    const row = await (0, database_1.queryOne)(`SELECT
       COUNT(*)::text                                             AS total,
       COUNT(*) FILTER (WHERE activo AND valido)::text           AS activos,
       COUNT(*) FILTER (WHERE NOT valido)::text                  AS invalidos,
       COUNT(*) FILTER (WHERE plataforma='WEB')::text            AS web,
       COUNT(*) FILTER (WHERE plataforma='ANDROID')::text        AS android,
       COUNT(*) FILTER (WHERE plataforma='IOS')::text            AS ios,
       COUNT(*) FILTER (WHERE proveedor='FCM')::text             AS fcm,
       COUNT(*) FILTER (WHERE proveedor='APNS')::text            AS apns,
       COUNT(*) FILTER (WHERE activo AND valido
         AND (ultimo_uso IS NULL OR ultimo_uso < NOW()-INTERVAL'30 days'))::text AS stale,
       COALESCE(SUM(enviados),0)::text                           AS enviados_total,
       COALESCE(SUM(fallos),0)::text                             AS fallos_total
     FROM device_tokens`, []);
    const env = parseInt(row?.enviados_total ?? '0');
    const fall = parseInt(row?.fallos_total ?? '0');
    return {
        total: parseInt(row?.total ?? '0'),
        activos: parseInt(row?.activos ?? '0'),
        invalidos: parseInt(row?.invalidos ?? '0'),
        porPlataforma: {
            WEB: parseInt(row?.web ?? '0'),
            ANDROID: parseInt(row?.android ?? '0'),
            IOS: parseInt(row?.ios ?? '0'),
        },
        porProveedor: {
            FCM: parseInt(row?.fcm ?? '0'),
            APNS: parseInt(row?.apns ?? '0'),
        },
        tasaEntrega: (env + fall) > 0 ? Math.round(env / (env + fall) * 100) : 100,
        stale: parseInt(row?.stale ?? '0'),
    };
}
// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
async function invalidarCacheTokens(usuarioId) {
    const redis = (0, redis_1.getRedis)();
    await redis.del(`dt:tokens:${usuarioId}`).catch(() => { });
}
function mapRow(row) {
    return {
        id: row.id,
        usuarioId: row.usuario_id,
        token: row.token,
        proveedor: row.proveedor,
        plataforma: row.plataforma,
        dispositivo: row.dispositivo ?? undefined,
        appVersion: row.app_version ?? undefined,
        locale: row.locale ?? 'es-AR',
        apnsEnv: row.apns_env ?? undefined,
        bundleId: row.bundle_id ?? undefined,
        activo: row.activo,
        valido: row.valido,
        motivoBaja: row.motivo_baja ?? undefined,
        enviados: row.enviados ?? 0,
        fallos: row.fallos ?? 0,
        ultimoEnvio: row.ultimo_envio ? new Date(row.ultimo_envio) : undefined,
        ultimoUso: row.ultimo_uso ? new Date(row.ultimo_uso) : undefined,
        creadoEn: new Date(row.creado_en),
    };
}
