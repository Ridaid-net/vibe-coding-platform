"use strict";
// ─── RODAID · Centro de Preferencias de Notificaciones ───
// Gestiona qué notificaciones recibe cada usuario y
// por qué canal (push, email, MxM, in_app).
//
// Defaults por evento:
//   cit_aprobado     → push ✓ email ✓ mxm ✓ in_app ✓
//   cit_rechazado    → push ✓ email ✓ mxm ✓ in_app ✓
//   cit_por_vencer   → push ✓ email ✓ mxm ✓ in_app ✓
//   cit_vencido      → push ✓ email ✓ mxm ✓ in_app ✓
//   tasa_confirmada  → push ✓ email ✓ mxm ✓ in_app ✓
//   pago_rechazado   → push ✓ email ✓ mxm ✗ in_app ✓
//   denuncia_registrada → push ✓ email ✓ mxm ✓ in_app ✓
//   bici_recuperada  → push ✓ email ✓ mxm ✓ in_app ✓
//   alerta_zona      → push ✓ email ✗ mxm ✗ in_app ✗  ← suscripción opt-in
//   nueva_oferta     → push ✓ email ✓ mxm ✗ in_app ✓
//   venta_confirmada → push ✓ email ✓ mxm ✓ in_app ✓
//   compra_completada→ push ✓ email ✓ mxm ✓ in_app ✓
//   disputa_abierta  → push ✓ email ✓ mxm ✓ in_app ✓
//   disputa_resuelta → push ✓ email ✓ mxm ✓ in_app ✓
//   nft_transferido  → push ✓ email ✓ mxm ✓ in_app ✓
//   sistema_general  → push ✓ email ✗ mxm ✗ in_app ✓
//   token_expiracion → push ✓ email ✗ mxm ✗ in_app ✓
//   newsletter       → push ✗ email ✓ mxm ✗ in_app ✗  ← opt-out
//
// Notas importantes:
//   · Las notificaciones de seguridad crítica (denuncia, CIT rechazado)
//     SIEMPRE se envían in_app, independientemente de las preferencias.
//   · El canal MxM requiere que el usuario tenga MxM conectado (nivel 2).
//   · El token de desuscripción permite unsubscribe one-click desde email.
//
// Integración con los dispatchers:
//   Antes de enviar → await puedeNotificar(usuarioId, evento, canal)
//   Si false → omitir ese canal para ese usuario
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRUPOS_ORDEN = exports.EVENTO_META = void 0;
exports.getPreferencias = getPreferencias;
exports.getPreferenciasPorEvento = getPreferenciasPorEvento;
exports.setPreferencia = setPreferencia;
exports.setPreferenciasBulk = setPreferenciasBulk;
exports.resetarPreferencias = resetarPreferencias;
exports.toggleTodosEmail = toggleTodosEmail;
exports.toggleTodosPush = toggleTodosPush;
exports.puedeNotificar = puedeNotificar;
exports.generarUnsubToken = generarUnsubToken;
exports.procesarUnsubToken = procesarUnsubToken;
exports.getLinkDesuscripcion = getLinkDesuscripcion;
exports.getEstadisticasPreferencias = getEstadisticasPreferencias;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// DEFAULTS POR EVENTO Y CANAL
// ══════════════════════════════════════════════════════════
// true = activo por defecto, false = desactivado por defecto (opt-in)
const DEFAULTS = {
    cit_aprobado: { push: true, email: true, mxm: true, in_app: true },
    cit_rechazado: { push: true, email: true, mxm: true, in_app: true },
    cit_por_vencer: { push: true, email: true, mxm: true, in_app: true },
    cit_vencido: { push: true, email: true, mxm: true, in_app: true },
    tasa_confirmada: { push: true, email: true, mxm: true, in_app: true },
    pago_rechazado: { push: true, email: true, mxm: false, in_app: true },
    denuncia_registrada: { push: true, email: true, mxm: true, in_app: true },
    bici_recuperada: { push: true, email: true, mxm: true, in_app: true },
    alerta_zona: { push: false, email: false, mxm: false, in_app: false }, // opt-in
    nueva_oferta: { push: true, email: true, mxm: false, in_app: true },
    venta_confirmada: { push: true, email: true, mxm: true, in_app: true },
    compra_completada: { push: true, email: true, mxm: true, in_app: true },
    disputa_abierta: { push: true, email: true, mxm: true, in_app: true },
    disputa_resuelta: { push: true, email: true, mxm: true, in_app: true },
    nft_transferido: { push: true, email: true, mxm: true, in_app: true },
    sistema_general: { push: true, email: false, mxm: false, in_app: true },
    token_expiracion: { push: true, email: false, mxm: false, in_app: true },
    newsletter: { push: false, email: true, mxm: false, in_app: false },
};
// Eventos que SIEMPRE envían in_app, sin importar preferencias
const SIEMPRE_IN_APP = [
    'cit_aprobado', 'cit_rechazado', 'denuncia_registrada',
    'disputa_abierta', 'tasa_confirmada',
];
// ══════════════════════════════════════════════════════════
// CACHE
// ══════════════════════════════════════════════════════════
const CACHE_TTL = 300; // 5 minutos
const prefKey = (userId) => `notif:prefs:${userId}`;
async function invalidarCache(userId) {
    const redis = (0, redis_1.getRedis)();
    await redis.del(prefKey(userId)).catch(() => { });
}
// ══════════════════════════════════════════════════════════
// OBTENER PREFERENCIAS
// ══════════════════════════════════════════════════════════
async function getPreferencias(usuarioId) {
    // Cache Redis
    const redis = (0, redis_1.getRedis)();
    const cached = await redis.get(prefKey(usuarioId)).catch(() => null);
    if (cached)
        return JSON.parse(cached);
    // Preferencias guardadas en DB
    const rows = await (0, database_1.query)(`SELECT evento::text, canal::text, activo, hora_inicio, hora_fin
     FROM notif_preferencias WHERE usuario_id=$1`, [usuarioId]);
    const guardadas = new Map();
    for (const r of rows)
        guardadas.set(`${r.evento}:${r.canal}`, r);
    // Combinar con defaults
    const resultado = [];
    for (const [evento, canales] of Object.entries(DEFAULTS)) {
        for (const [canal, defaultActivo] of Object.entries(canales)) {
            const key = `${evento}:${canal}`;
            const guardada = guardadas.get(key);
            resultado.push({
                evento: evento,
                canal: canal,
                activo: guardada ? guardada.activo : defaultActivo,
                horaInicio: guardada?.hora_inicio ?? undefined,
                horaFin: guardada?.hora_fin ?? undefined,
                esDefault: !guardada,
            });
        }
    }
    await redis.set(prefKey(usuarioId), JSON.stringify(resultado), 'EX', CACHE_TTL).catch(() => { });
    return resultado;
}
/** Preferencias en formato organizado por evento (para el UI del centro) */
async function getPreferenciasPorEvento(usuarioId) {
    const prefs = await getPreferencias(usuarioId);
    const map = new Map();
    for (const p of prefs)
        map.set(`${p.evento}:${p.canal}`, p);
    const resultado = {};
    for (const evento of Object.keys(DEFAULTS)) {
        const meta = exports.EVENTO_META[evento];
        const canales = {};
        for (const canal of ['push', 'email', 'mxm', 'in_app']) {
            const p = map.get(`${evento}:${canal}`);
            canales[canal] = {
                activo: p ? p.activo : DEFAULTS[evento][canal],
                soportado: true, // todos los canales son técnicamente soportables
            };
        }
        resultado[evento] = {
            label: meta.label,
            grupo: meta.grupo,
            canales,
            critico: SIEMPRE_IN_APP.includes(evento),
        };
    }
    return resultado;
}
// ══════════════════════════════════════════════════════════
// ACTUALIZAR PREFERENCIAS
// ══════════════════════════════════════════════════════════
async function setPreferencia(usuarioId, evento, canal, activo, horario) {
    // Protección: in_app de eventos críticos siempre activo
    if (!activo && canal === 'in_app' && SIEMPRE_IN_APP.includes(evento)) {
        throw Object.assign(new Error(`La notificación in-app de "${evento}" no puede desactivarse por seguridad.`), { code: 'CANAL_OBLIGATORIO', status: 422 });
    }
    await (0, database_1.query)(`INSERT INTO notif_preferencias (usuario_id, evento, canal, activo, hora_inicio, hora_fin)
     VALUES ($1, $2::evento_notif, $3::canal_notif, $4::boolean, $5, $6)
     ON CONFLICT (usuario_id, evento, canal) DO UPDATE SET
       activo         = EXCLUDED.activo,
       hora_inicio    = EXCLUDED.hora_inicio,
       hora_fin       = EXCLUDED.hora_fin,
       actualizado_en = NOW()`, [usuarioId, evento, canal, activo, horario?.horaInicio ?? null, horario?.horaFin ?? null]);
    await invalidarCache(usuarioId);
    logger_1.log.mensajeria.info({
        usuarioId: usuarioId.slice(0, 8), evento, canal, activo,
    }, `Preferencia actualizada: ${evento}/${canal} → ${activo ? 'ON' : 'OFF'}`);
}
/** Actualizar múltiples preferencias en una sola operación */
async function setPreferenciasBulk(usuarioId, preferencias) {
    let actualizadas = 0;
    const errores = [];
    for (const p of preferencias) {
        try {
            await setPreferencia(usuarioId, p.evento, p.canal, p.activo);
            actualizadas++;
        }
        catch (err) {
            errores.push(`${p.evento}/${p.canal}: ${err.message}`);
        }
    }
    return { actualizadas, errores };
}
/** Restaurar todos los defaults del usuario */
async function resetarPreferencias(usuarioId) {
    await (0, database_1.query)(`DELETE FROM notif_preferencias WHERE usuario_id=$1`, [usuarioId]);
    await invalidarCache(usuarioId);
    logger_1.log.mensajeria.info({ usuarioId: usuarioId.slice(0, 8) }, 'Preferencias reseteadas a defaults');
}
/** Activar o desactivar todos los emails de una vez */
async function toggleTodosEmail(usuarioId, activo) {
    const eventos = Object.keys(DEFAULTS);
    let count = 0;
    for (const evento of eventos) {
        if (DEFAULTS[evento]['email']) { // solo modificar los que tienen email habilitado en defaults
            await (0, database_1.query)(`INSERT INTO notif_preferencias (usuario_id, evento, canal, activo)
         VALUES ($1, $2::evento_notif, 'email'::canal_notif, $3::boolean)
         ON CONFLICT (usuario_id, evento, canal) DO UPDATE SET activo=$3::boolean, actualizado_en=NOW()`, [usuarioId, evento, activo]);
            count++;
        }
    }
    await invalidarCache(usuarioId);
    return count;
}
/** Activar o desactivar todos los push de una vez */
async function toggleTodosPush(usuarioId, activo) {
    const eventos = Object.keys(DEFAULTS);
    let count = 0;
    for (const evento of eventos) {
        if (DEFAULTS[evento]['push']) {
            await (0, database_1.query)(`INSERT INTO notif_preferencias (usuario_id, evento, canal, activo)
         VALUES ($1, $2::evento_notif, 'push'::canal_notif, $3::boolean)
         ON CONFLICT (usuario_id, evento, canal) DO UPDATE SET activo=$3::boolean, actualizado_en=NOW()`, [usuarioId, evento, activo]);
            count++;
        }
    }
    await invalidarCache(usuarioId);
    return count;
}
// ══════════════════════════════════════════════════════════
// GATE: ¿puede recibir esta notificación?
// ══════════════════════════════════════════════════════════
async function puedeNotificar(usuarioId, evento, canal) {
    // Regla de seguridad: in_app de eventos críticos siempre sí
    if (canal === 'in_app' && SIEMPRE_IN_APP.includes(evento))
        return true;
    // Leer preferencia (incluye default si no hay entrada en DB)
    const prefs = await getPreferencias(usuarioId);
    const pref = prefs.find(p => p.evento === evento && p.canal === canal);
    if (!pref?.activo)
        return false;
    // Verificar horario silencioso
    if (pref.horaInicio !== undefined && pref.horaFin !== undefined) {
        const horaActual = new Date().getUTCHours();
        const { horaInicio, horaFin } = pref;
        if (horaInicio < horaFin) {
            // Rango normal: 22-08 → silencioso entre esas horas
            if (horaActual < horaInicio || horaActual >= horaFin)
                return false;
        }
        else {
            // Rango overnight: 22-06 → silencioso de 22 a 06
            if (horaActual >= horaInicio || horaActual < horaFin)
                return false;
        }
    }
    return true;
}
// ══════════════════════════════════════════════════════════
// UNSUBSCRIBE TOKEN (one-click desde email)
// ══════════════════════════════════════════════════════════
async function generarUnsubToken(usuarioId, evento, canal) {
    const token = crypto_1.default.randomBytes(32).toString('base64url');
    await (0, database_1.query)(`INSERT INTO notif_unsub_tokens (token, usuario_id, evento, canal)
     VALUES ($1, $2, $3::evento_notif, $4::canal_notif)`, [token, usuarioId, evento ?? null, canal ?? 'email']);
    return token;
}
async function procesarUnsubToken(token) {
    const row = await (0, database_1.queryOne)(`SELECT usuario_id, evento::text, canal::text, usado_en, expira_en
     FROM notif_unsub_tokens WHERE token=$1`, [token]);
    if (!row)
        return { ok: false, mensaje: 'Token de desuscripción inválido.' };
    if (row.usado_en)
        return { ok: false, mensaje: 'Este link ya fue usado.' };
    if (new Date(row.expira_en) < new Date())
        return { ok: false, mensaje: 'Link expirado.' };
    // Marcar como usado
    await (0, database_1.query)(`UPDATE notif_unsub_tokens SET usado_en=NOW() WHERE token=$1`, [token]);
    if (row.evento) {
        // Desuscribir de un evento específico
        await setPreferencia(row.usuario_id, row.evento, row.canal, false);
        return { ok: true, evento: row.evento, canal: row.canal, mensaje: `Desuscripto de "${row.evento}" (${row.canal}).` };
    }
    else {
        // Desuscribir de todos los emails
        await toggleTodosEmail(row.usuario_id, false);
        return { ok: true, canal: 'email', mensaje: 'Desuscripto de todos los emails de RODAID.' };
    }
}
/** Generar link de desuscripción para incluir en emails */
async function getLinkDesuscripcion(usuarioId, evento, baseUrl) {
    const token = await generarUnsubToken(usuarioId, evento, 'email');
    const base = baseUrl ?? process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar';
    return `${base}/notificaciones/unsub?token=${token}`;
}
// ══════════════════════════════════════════════════════════
// STATS ADMIN
// ══════════════════════════════════════════════════════════
async function getEstadisticasPreferencias() {
    const [usuarios, porCanal, porEvento] = await Promise.all([
        (0, database_1.queryOne)(`SELECT COUNT(DISTINCT usuario_id)::text AS count FROM notif_preferencias WHERE NOT activo`, []),
        (0, database_1.query)(`SELECT canal::text, COUNT(*)::text AS count FROM notif_preferencias
       WHERE NOT activo GROUP BY canal ORDER BY count DESC`, []),
        (0, database_1.query)(`SELECT evento::text, COUNT(*)::text AS count FROM notif_preferencias
       WHERE NOT activo GROUP BY evento ORDER BY count DESC LIMIT 10`, []),
    ]);
    const porCanalMap = { push: 0, email: 0, mxm: 0, in_app: 0 };
    for (const r of porCanal)
        porCanalMap[r.canal] = parseInt(r.count);
    return {
        usuariosConPreferencias: parseInt(usuarios?.count ?? '0'),
        desactivacionesPorCanal: porCanalMap,
        eventosMasDesactivados: porEvento.map(r => ({ evento: r.evento, count: parseInt(r.count) })),
    };
}
// ══════════════════════════════════════════════════════════
// METADATA DE EVENTOS (para el UI)
// ══════════════════════════════════════════════════════════
exports.EVENTO_META = {
    cit_aprobado: { label: 'CIT emitido', grupo: 'Certificación', descripcion: 'Cuando tu bicicleta es certificada exitosamente' },
    cit_rechazado: { label: 'CIT rechazado', grupo: 'Certificación', descripcion: 'Cuando tu certificación es rechazada' },
    cit_por_vencer: { label: 'CIT próximo a vencer', grupo: 'Certificación', descripcion: 'Recordatorios 30, 15, 7 y 1 día antes del vencimiento' },
    cit_vencido: { label: 'CIT vencido', grupo: 'Certificación', descripcion: 'Cuando tu certificado vence' },
    tasa_confirmada: { label: 'Pago de tasa confirmado', grupo: 'Pagos', descripcion: 'Confirmación de pago de tasa CIT' },
    pago_rechazado: { label: 'Pago rechazado', grupo: 'Pagos', descripcion: 'Cuando un pago no puede procesarse' },
    denuncia_registrada: { label: 'Denuncia de robo', grupo: 'Seguridad', descripcion: 'Cuando se registra una denuncia de robo' },
    bici_recuperada: { label: 'Bicicleta recuperada', grupo: 'Seguridad', descripcion: 'Cuando tu bicicleta es marcada como recuperada' },
    alerta_zona: { label: 'Alertas de robo en tu zona', grupo: 'Seguridad', descripcion: 'Robos reportados en tu área (opt-in)' },
    nueva_oferta: { label: 'Nueva oferta recibida', grupo: 'Marketplace', descripcion: 'Cuando alguien hace una oferta por tu publicación' },
    venta_confirmada: { label: 'Venta confirmada', grupo: 'Marketplace', descripcion: 'Cuando se completa una venta y se acreditan los fondos' },
    compra_completada: { label: 'Compra completada', grupo: 'Marketplace', descripcion: 'Cuando confirmás la recepción de tu compra' },
    disputa_abierta: { label: 'Disputa abierta', grupo: 'Marketplace', descripcion: 'Cuando se abre una disputa en una transacción' },
    disputa_resuelta: { label: 'Disputa resuelta', grupo: 'Marketplace', descripcion: 'Cuando se resuelve una disputa' },
    nft_transferido: { label: 'NFT / CIT transferido', grupo: 'Blockchain', descripcion: 'Cuando el CIT es transferido on-chain en la BFA' },
    sistema_general: { label: 'Mensajes del sistema', grupo: 'Sistema', descripcion: 'Comunicaciones generales de RODAID' },
    token_expiracion: { label: 'Token MxM por vencer', grupo: 'Sistema', descripcion: 'Aviso de renovación de tu sesión MxM' },
    newsletter: { label: 'Newsletter RODAID', grupo: 'Sistema', descripcion: 'Novedades y actualizaciones de la plataforma (opt-out)' },
};
exports.GRUPOS_ORDEN = ['Certificación', 'Pagos', 'Seguridad', 'Marketplace', 'Blockchain', 'Sistema'];
