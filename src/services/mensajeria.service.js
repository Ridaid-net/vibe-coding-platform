"use strict";
// ─── RODAID · Servicio de Mensajería ─────────────────────
// Sistema de mensajería privada entre compradores y vendedores
// dentro del contexto de una publicación del marketplace.
//
// Modelo:
//   Conversación = 1 publicación × 1 interesado × 1 vendedor
//   Cada publicación puede tener N conversaciones (una por interesado)
//   Los mensajes son inmutables (no se editan, solo se eliminan)
//
// Privacidad:
//   · Solo el par comprador/vendedor puede leer su conversación
//   · No se exponen datos de contacto hasta que la venta se concrete
//   · El contenido de mensajes eliminados se reemplaza por "[eliminado]"
//
// Rate limiting:
//   · Máximo 30 mensajes por conversación por hora por usuario
//   · Máximo 5 conversaciones nuevas por hora por usuario
//   · Mensajes de sistema (tipo SISTEMA) no cuentan contra el límite
//
// Tipos de mensaje:
//   TEXTO    → mensaje libre
//   OFERTA   → contraoferta de precio (datos: { precioOfertado, moneda })
//   SISTEMA  → notificación automática (reserva, pago, etc.)
Object.defineProperty(exports, "__esModule", { value: true });
exports.enviarMensaje = enviarMensaje;
exports.getMensajes = getMensajes;
exports.marcarLeidos = marcarLeidos;
exports.misConversaciones = misConversaciones;
exports.getConversacion = getConversacion;
exports.eliminarMensaje = eliminarMensaje;
exports.mensajeSistema = mensajeSistema;
exports.bloquearConversacion = bloquearConversacion;
exports.totalNoLeidos = totalNoLeidos;
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function mapConversacion(r) {
    return {
        id: r.id,
        publicacionId: r.publicacion_id,
        vendedorId: r.vendedor_id,
        interesadoId: r.interesado_id,
        ultimoMensajeEn: r.ultimo_mensaje_en ? new Date(r.ultimo_mensaje_en) : null,
        mensajesTotal: r.mensajes_total ?? 0,
        noLeidosVendedor: r.no_leidos_vendedor ?? 0,
        noLeidosInteresado: r.no_leidos_interesado ?? 0,
        bloqueada: r.bloqueada ?? false,
        creadaEn: new Date(r.creada_en),
        publicacion: r.pub_slug ? {
            slug: r.pub_slug,
            titulo: r.pub_titulo,
            precioARS: parseFloat(r.pub_precio),
            fotosUrls: Array.isArray(r.pub_fotos) ? r.pub_fotos
                : String(r.pub_fotos ?? '').replace(/[{}]/g, '').split(',').filter(Boolean),
        } : undefined,
        vendedor: r.vendedor_nombre ? { id: r.vendedor_id, nombre: r.vendedor_nombre } : undefined,
        interesado: r.interesado_nombre ? { id: r.interesado_id, nombre: r.interesado_nombre } : undefined,
        ultimoMensaje: r.ult_cuerpo ? {
            cuerpo: r.ult_cuerpo,
            remitenteId: r.ult_remitente,
            tipo: r.ult_tipo,
        } : undefined,
    };
}
function mapMensaje(r, miId) {
    return {
        id: r.id,
        conversacionId: r.conversacion_id,
        remitenteId: r.remitente_id,
        cuerpo: r.eliminado ? '[mensaje eliminado]' : r.cuerpo,
        adjuntos: Array.isArray(r.adjuntos) ? r.adjuntos
            : String(r.adjuntos ?? '').replace(/[{}]/g, '').split(',').filter(Boolean),
        leidoEn: r.leido_en ? new Date(r.leido_en) : null,
        eliminado: r.eliminado ?? false,
        tipo: r.tipo ?? 'TEXTO',
        datos: r.datos ? (typeof r.datos === 'object' ? r.datos : JSON.parse(r.datos)) : undefined,
        creadoEn: new Date(r.creado_en),
        esPropio: miId ? r.remitente_id === miId : undefined,
    };
}
// Rate limit en Redis para mensajes
async function checkRateLimitMensajes(usuarioId, conversacionId) {
    try {
        const redis = (0, redis_1.getRedis)();
        const key = `msg:rl:${usuarioId}:${conversacionId}`;
        const count = await redis.incr(key);
        if (count === 1)
            await redis.expire(key, 3600); // TTL 1h
        if (count > 30)
            throw Object.assign(new Error('Límite de mensajes alcanzado. Máximo 30 mensajes por hora en esta conversación.'), { code: 'RATE_LIMIT_MENSAJES', status: 429 });
    }
    catch (err) {
        if (err.code === 'RATE_LIMIT_MENSAJES')
            throw err;
        // Si Redis falla, continuar sin rate limit
    }
}
const SELECT_CONV = `
  c.id, c.publicacion_id, c.vendedor_id, c.interesado_id,
  c.ultimo_mensaje_en, c.mensajes_total,
  c.no_leidos_vendedor, c.no_leidos_interesado,
  c.bloqueada, c.creada_en,
  mp.slug AS pub_slug, mp.titulo AS pub_titulo,
  mp.precio_ars AS pub_precio, mp.fotos_urls AS pub_fotos,
  uv.nombre AS vendedor_nombre, ui.nombre AS interesado_nombre,
  (SELECT m.cuerpo FROM mensajes m WHERE m.conversacion_id=c.id
   ORDER BY m.creado_en DESC LIMIT 1) AS ult_cuerpo,
  (SELECT m.remitente_id FROM mensajes m WHERE m.conversacion_id=c.id
   ORDER BY m.creado_en DESC LIMIT 1) AS ult_remitente,
  (SELECT m.tipo FROM mensajes m WHERE m.conversacion_id=c.id
   ORDER BY m.creado_en DESC LIMIT 1) AS ult_tipo
`;
const JOIN_CONV = `
  JOIN marketplace_publicaciones mp ON mp.id=c.publicacion_id
  JOIN usuarios uv ON uv.id=c.vendedor_id
  JOIN usuarios ui ON ui.id=c.interesado_id
`;
// ══════════════════════════════════════════════════════════
// ENVIAR MENSAJE — crea conversación si no existe
// ══════════════════════════════════════════════════════════
async function enviarMensaje(input) {
    // 1. Cargar publicación
    const pub = await (0, database_1.queryOne)(`SELECT id, estado::text AS estado, vendedor_id, titulo
     FROM marketplace_publicaciones WHERE id = $1`, [input.publicacionId]);
    if (!pub)
        throw Object.assign(new Error('Publicación no encontrada'), { code: 'NOT_FOUND', status: 404 });
    if (pub.estado === 'CANCELADA')
        throw Object.assign(new Error('Esta publicación ya no está disponible para mensajes'), { code: 'PUB_UNAVAILABLE', status: 422 });
    // El remitente puede ser el vendedor (respondiendo) o un interesado (iniciando)
    const esVendedor = pub.vendedor_id === input.remitenteId;
    if (esVendedor && input.remitenteId === pub.vendedor_id &&
        !input.conversacionId) {
        throw Object.assign(new Error('El vendedor debe especificar conversacionId para responder'), { code: 'VENDOR_NEEDS_CONV_ID', status: 422 });
    }
    // 2. Obtener o crear conversación
    let conv = await (0, database_1.queryOne)(input.conversacionId
        ? `SELECT id, bloqueada, vendedor_id, interesado_id FROM mensajes_conversaciones WHERE id=$1 AND publicacion_id=$2`
        : `SELECT id, bloqueada, vendedor_id, interesado_id FROM mensajes_conversaciones WHERE publicacion_id=$1 AND interesado_id=$2`, input.conversacionId
        ? [input.conversacionId, input.publicacionId]
        : [input.publicacionId, input.remitenteId]);
    let nueva = false;
    if (!conv) {
        if (esVendedor)
            throw Object.assign(new Error('Conversación no encontrada para esta publicación'), { code: 'NOT_FOUND', status: 404 });
        // Rate limit para creación de nuevas conversaciones
        try {
            const redis = (0, redis_1.getRedis)();
            const keyNew = `msg:new:${input.remitenteId}`;
            const countNew = await redis.incr(keyNew);
            if (countNew === 1)
                await redis.expire(keyNew, 3600);
            if (countNew > 5)
                throw Object.assign(new Error('Máximo 5 conversaciones nuevas por hora. Reintentá más tarde.'), { code: 'RATE_LIMIT_CONV', status: 429 });
        }
        catch (err) {
            if (err.code === 'RATE_LIMIT_CONV')
                throw err;
        }
        // Crear nueva conversación
        const created = await (0, database_1.queryOne)(`INSERT INTO mensajes_conversaciones
         (publicacion_id, vendedor_id, interesado_id)
       VALUES ($1, $2, $3)
       RETURNING id`, [input.publicacionId, pub.vendedor_id, input.remitenteId]);
        conv = { id: created.id, bloqueada: false, vendedor_id: pub.vendedor_id, interesado_id: input.remitenteId };
        nueva = true;
    }
    if (conv.bloqueada)
        throw Object.assign(new Error('Esta conversación ha sido bloqueada por moderación'), { code: 'CONV_BLOQUEADA', status: 403 });
    // 3. Rate limit por mensajes en esta conversación
    if (input.tipo !== 'SISTEMA') {
        await checkRateLimitMensajes(input.remitenteId, conv.id);
    }
    // 4. Insertar mensaje
    const msg = await (0, database_1.queryOne)(`INSERT INTO mensajes
       (conversacion_id, remitente_id, cuerpo, tipo, datos, adjuntos)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`, [
        conv.id,
        input.remitenteId,
        input.cuerpo.trim(),
        input.tipo ?? 'TEXTO',
        input.datos ? JSON.stringify(input.datos) : null,
        input.adjuntos?.length ? `{${input.adjuntos.join(',')}}` : '{}',
    ]);
    // Invalidar caché de la conversación
    (0, redis_1.getRedis)().del(`msg:conv:${conv.id}`).catch(() => { });
    logger_1.log.mensajeria.debug({
        convId: conv.id,
        remitenteId: input.remitenteId,
        tipo: input.tipo ?? 'TEXTO',
        nueva,
    }, `✓ Mensaje enviado`);
    return {
        mensaje: mapMensaje(msg, input.remitenteId),
        conversacionId: conv.id,
        nueva,
    };
}
// ══════════════════════════════════════════════════════════
// LEER MENSAJES DE UNA CONVERSACIÓN
// ══════════════════════════════════════════════════════════
async function getMensajes(opts) {
    const limite = Math.min(opts.limite ?? 30, 100);
    // Verificar acceso
    const conv = await (0, database_1.queryOne)(`SELECT id, vendedor_id, interesado_id, bloqueada,
            no_leidos_vendedor, no_leidos_interesado
     FROM mensajes_conversaciones WHERE id = $1`, [opts.conversacionId]);
    if (!conv)
        throw Object.assign(new Error('Conversación no encontrada'), { code: 'NOT_FOUND', status: 404 });
    const esParticipante = conv.vendedor_id === opts.usuarioId || conv.interesado_id === opts.usuarioId;
    if (!esParticipante)
        throw Object.assign(new Error('No tenés acceso a esta conversación'), { code: 'FORBIDDEN', status: 403 });
    const totalNoLeidos = conv.vendedor_id === opts.usuarioId
        ? conv.no_leidos_vendedor
        : conv.no_leidos_interesado;
    // Paginación por cursor
    let cursorCond = '';
    const params = [opts.conversacionId];
    if (opts.cursor) {
        const cursorMsg = await (0, database_1.queryOne)(`SELECT creado_en FROM mensajes WHERE id = $1`, [opts.cursor]);
        if (cursorMsg) {
            params.push(cursorMsg.creado_en);
            cursorCond = `AND m.creado_en < $${params.length}`;
        }
    }
    params.push(limite + 1);
    const filas = await (0, database_1.query)(`SELECT m.id, m.conversacion_id, m.remitente_id, m.cuerpo, m.adjuntos,
            m.leido_en, m.eliminado, m.tipo, m.datos, m.creado_en
     FROM mensajes m
     WHERE m.conversacion_id = $1 ${cursorCond}
     ORDER BY m.creado_en DESC
     LIMIT $${params.length}`, params);
    const hayMas = filas.length > limite;
    const mensajes = filas.slice(0, limite).map((r) => mapMensaje(r, opts.usuarioId));
    // Marcar como leídos en background (fire-and-forget)
    marcarLeidos(opts.conversacionId, opts.usuarioId).catch(() => { });
    return { mensajes: mensajes.reverse(), hayMas, totalNoLeidos };
}
// ══════════════════════════════════════════════════════════
// MARCAR COMO LEÍDOS
// ══════════════════════════════════════════════════════════
async function marcarLeidos(conversacionId, usuarioId) {
    // Marcar mensajes individuales
    await (0, database_1.query)(`UPDATE mensajes SET leido_en=NOW()
     WHERE conversacion_id=$1 AND remitente_id!=$2 AND leido_en IS NULL`, [conversacionId, usuarioId]);
    // Resetear contador de no leídos para este usuario
    const conv = await (0, database_1.queryOne)(`SELECT vendedor_id FROM mensajes_conversaciones WHERE id=$1`, [conversacionId]);
    if (conv?.vendedor_id === usuarioId) {
        await (0, database_1.query)(`UPDATE mensajes_conversaciones SET no_leidos_vendedor=0 WHERE id=$1`, [conversacionId]);
    }
    else {
        await (0, database_1.query)(`UPDATE mensajes_conversaciones SET no_leidos_interesado=0 WHERE id=$1`, [conversacionId]);
    }
}
// ══════════════════════════════════════════════════════════
// MIS CONVERSACIONES
// ══════════════════════════════════════════════════════════
async function misConversaciones(usuarioId, opts = {}) {
    const limite = Math.min(opts.limite ?? 20, 50);
    const offset = ((opts.pagina ?? 1) - 1) * limite;
    const filtroNL = opts.soloNoLeidas
        ? `AND (CASE WHEN c.vendedor_id=$1 THEN c.no_leidos_vendedor ELSE c.no_leidos_interesado END) > 0`
        : '';
    const [rows, total] = await Promise.all([
        (0, database_1.query)(`SELECT ${SELECT_CONV}
       FROM mensajes_conversaciones c ${JOIN_CONV}
       WHERE (c.vendedor_id=$1 OR c.interesado_id=$1) ${filtroNL}
       ORDER BY c.ultimo_mensaje_en DESC NULLS LAST, c.creada_en DESC
       LIMIT $2 OFFSET $3`, [usuarioId, limite, offset]),
        (0, database_1.queryOne)(`SELECT COUNT(*)::text AS n FROM mensajes_conversaciones c
       WHERE (c.vendedor_id=$1 OR c.interesado_id=$1) ${filtroNL}`, [usuarioId]),
    ]);
    return {
        conversaciones: rows.map(mapConversacion),
        total: parseInt(total?.n ?? '0'),
    };
}
// ══════════════════════════════════════════════════════════
// CONVERSACIÓN DE UNA PUBLICACIÓN (vista completa)
// ══════════════════════════════════════════════════════════
async function getConversacion(opts) {
    const cond = opts.conversacionId
        ? 'c.id=$1'
        : 'c.publicacion_id=$1 AND (c.interesado_id=$2 OR c.vendedor_id=$2)';
    const params = opts.conversacionId
        ? [opts.conversacionId]
        : [opts.publicacionId, opts.usuarioId];
    const row = await (0, database_1.queryOne)(`SELECT ${SELECT_CONV} FROM mensajes_conversaciones c ${JOIN_CONV} WHERE ${cond}`, params);
    return row ? mapConversacion(row) : null;
}
// ══════════════════════════════════════════════════════════
// ELIMINAR MENSAJE (soft delete)
// ══════════════════════════════════════════════════════════
async function eliminarMensaje(mensajeId, usuarioId, esAdmin = false) {
    const msg = await (0, database_1.queryOne)(`SELECT remitente_id, eliminado FROM mensajes WHERE id=$1`, [mensajeId]);
    if (!msg)
        throw Object.assign(new Error('Mensaje no encontrado'), { code: 'NOT_FOUND', status: 404 });
    if (msg.eliminado)
        throw Object.assign(new Error('El mensaje ya fue eliminado'), { code: 'ALREADY_DELETED', status: 422 });
    if (!esAdmin && msg.remitente_id !== usuarioId)
        throw Object.assign(new Error('Solo podés eliminar tus propios mensajes'), { code: 'FORBIDDEN', status: 403 });
    await (0, database_1.query)(`UPDATE mensajes SET eliminado=TRUE, eliminado_por=$2 WHERE id=$1`, [mensajeId, usuarioId]);
}
// ══════════════════════════════════════════════════════════
// MENSAJE DE SISTEMA — automático (reserva, pago, entrega)
// ══════════════════════════════════════════════════════════
async function mensajeSistema(opts) {
    // Obtener vendedor de la publicación
    const pub = await (0, database_1.queryOne)(`SELECT vendedor_id FROM marketplace_publicaciones WHERE id=$1`, [opts.publicacionId]);
    if (!pub)
        return;
    // Usar el vendedor como remitente del sistema (o podrías tener un usuario SISTEMA)
    await enviarMensaje({
        publicacionId: opts.publicacionId,
        remitenteId: pub.vendedor_id, // Necesitamos el interesadoId para la conv
        cuerpo: opts.cuerpo,
        tipo: 'SISTEMA',
        datos: opts.datos,
    }).catch(err => logger_1.log.mensajeria.warn({ err: err.message }, 'Error enviando mensaje de sistema'));
}
// ══════════════════════════════════════════════════════════
// BLOQUEAR CONVERSACIÓN (admin)
// ══════════════════════════════════════════════════════════
async function bloquearConversacion(conversacionId, motivo) {
    await (0, database_1.query)(`UPDATE mensajes_conversaciones SET bloqueada=TRUE, motivo_bloqueo=$2 WHERE id=$1`, [conversacionId, motivo]);
    logger_1.log.mensajeria.warn({ conversacionId, motivo }, '🚫 Conversación bloqueada');
}
// ══════════════════════════════════════════════════════════
// STATS — total no leídos para un usuario (para el badge)
// ══════════════════════════════════════════════════════════
async function totalNoLeidos(usuarioId) {
    const r = await (0, database_1.queryOne)(`SELECT COALESCE(SUM(
       CASE WHEN c.vendedor_id=$1 THEN c.no_leidos_vendedor
            ELSE c.no_leidos_interesado END
     ), 0)::text AS n
     FROM mensajes_conversaciones c
     WHERE c.vendedor_id=$1 OR c.interesado_id=$1`, [usuarioId]);
    return parseInt(r?.n ?? '0');
}
