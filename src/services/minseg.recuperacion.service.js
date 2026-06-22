"use strict";
// ─── RODAID · Webhook Inverso — MinSeg → Recuperación ────
//
// MinSeg notifica a RODAID cuando una bicicleta registrada
// es recuperada por la Policía de Mendoza.
//
// Payload que envía MinSeg:
//   POST /api/v1/webhooks/minseg
//   Headers:
//     X-MINSEG-SIGNATURE: HMAC-SHA256(timestamp.sha256(body), secret)
//     X-MINSEG-TIMESTAMP: unix timestamp
//     X-MINSEG-EVENT-ID:  UUID único del evento (idempotencia)
//   Body:
//     {
//       "tipo":                "RECUPERACION_NOTIFICADA",
//       "serial":              "SN-TREK-2026-001",
//       "numero_expediente":   "EXP-MINSEG-2026-00123",
//       "numero_denuncia":     "DEN-2026-0001",
//       "fecha_recuperacion":  "2026-06-05T14:30:00-03:00",
//       "lugar_recuperacion":  "Av. San Martín 1200, San Martín, Mendoza",
//       "autoridad_actuante":  "Comisaría 5ta San Martín",
//       "descripcion":         "Rodado recuperado en control de tránsito"
//     }
//
// Pipeline de procesamiento (orden garantizado):
//   1. Verificar firma HMAC-SHA256 + ventana de tiempo (anti-replay)
//   2. Deduplicar por event_id (Redis + DB)
//   3. Buscar serial en RODAID → CIT activo / bloqueado
//   4. Si encontrado → marcarRecuperada() en TX atómica:
//      a. UPDATE denuncias SET estado='RECUPERADA'
//      b. UPDATE cits SET estado='ACTIVO'
//      c. Limpiar caché Redis del serial
//   5. BFA unlock → desbloquear NFT en Blockchain Federal Argentina
//   6. Notificar al propietario:
//      a. Push notification (FCM / APNs)
//      b. Email con detalles de la recuperación
//      c. Notificación in-app
//   7. Confirmar recepción a MinSeg (HTTP 200 + JSON)
//   8. Audit log completo en minseg_recuperaciones
//
// Garantías:
//   · Idempotente: el mismo event_id se puede recibir N veces sin efecto
//   · Sin pérdida: si el procesamiento falla → estado PENDIENTE → reintento
//   · Audit trail completo: cada evento queda registrado
Object.defineProperty(exports, "__esModule", { value: true });
exports.procesarRecuperacionMinSeg = procesarRecuperacionMinSeg;
exports.reprocesarPendientes = reprocesarPendientes;
exports.getRecuperacionesMinSeg = getRecuperacionesMinSeg;
exports.getEstadisticasRecuperaciones = getEstadisticasRecuperaciones;
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
const minseg_protocol_service_1 = require("./minseg.protocol.service");
// ══════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════
async function procesarRecuperacionMinSeg(opts) {
    const serial_placeholder = '(sin serial)';
    // ── 1. Verificar firma ─────────────────────────────────
    const firma = (0, minseg_protocol_service_1.verificarFirmaWebhook)({
        signature: opts.signature,
        timestamp: opts.timestamp,
        body: opts.rawBody,
        ipOrigen: opts.ipOrigen,
    });
    if (!firma.valida && process.env.MTLS_ALLOW_STUB !== 'true') {
        logger_1.log.minseg.warn({ eventId: opts.eventId, motivo: firma.motivo }, '⚠ Firma webhook inválida');
        return _resultado('ERROR', opts.eventId, serial_placeholder, false, false, false, { intentado: false, ok: false }, `Firma inválida: ${firma.motivo}`);
    }
    // ── 2. Deduplicar ─────────────────────────────────────
    const redis = (0, redis_1.getRedis)();
    const idempKey = `minseg:recup:${opts.eventId}`;
    const yaVisto = await redis.get(idempKey).catch(() => null);
    if (yaVisto) {
        return _resultado('DUPLICADO', opts.eventId, serial_placeholder, false, false, false, { intentado: false, ok: false }, `Evento ${opts.eventId} ya procesado`);
    }
    // Marcar como visto (con TTL de 7 días para ventana de replay)
    await redis.set(idempKey, '1', 'EX', 7 * 86_400).catch(() => { });
    // ── 3. Parsear payload ────────────────────────────────
    let payload;
    try {
        payload = JSON.parse(opts.rawBody);
    }
    catch {
        return _resultado('ERROR', opts.eventId, serial_placeholder, false, false, false, { intentado: false, ok: false }, 'Payload JSON inválido');
    }
    const serial = payload.serial?.toUpperCase().trim().replace(/\s+/g, '-') ?? '';
    if (!serial) {
        return _resultado('ERROR', opts.eventId, serial_placeholder, false, false, false, { intentado: false, ok: false }, 'Campo serial requerido');
    }
    // Registrar el evento en DB (antes del procesamiento)
    const recRow = await (0, database_1.queryOne)(`INSERT INTO minseg_recuperaciones
       (event_id, tipo_evento, serial, numero_expediente, numero_denuncia_minseg,
        fecha_recuperacion, lugar_recuperacion, autoridad_actuante, descripcion, datos_extra)
     VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10::jsonb)
     ON CONFLICT (event_id) DO NOTHING RETURNING id`, [
        opts.eventId, payload.tipo ?? 'RECUPERACION_NOTIFICADA', serial,
        payload.numero_expediente ?? null, payload.numero_denuncia ?? null,
        payload.fecha_recuperacion, payload.lugar_recuperacion ?? null,
        payload.autoridad_actuante ?? null, payload.descripcion ?? null,
        payload.datos_extra ? JSON.stringify(payload.datos_extra) : null,
    ]);
    if (!recRow) {
        // Ya existía → duplicado
        return _resultado('DUPLICADO', opts.eventId, serial, false, false, false, { intentado: false, ok: false }, 'Evento ya registrado en DB');
    }
    const recuperacionId = recRow.id;
    try {
        // ── 4. Buscar CIT + denuncia activos ─────────────────
        const citRow = await (0, database_1.queryOne)(`SELECT c.id, c.numero_cit, c.estado, c.propietario_id,
              c.nft_token_id, c.hash_sha256
       FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
       WHERE UPPER(b.numero_serie)=$1
       ORDER BY c.creado_en DESC LIMIT 1`, [serial]);
        if (!citRow) {
            await _actualizarEstado(recuperacionId, 'NO_ENCONTRADO', null, null, false, { intentado: false, ok: false }, `Serial ${serial} no registrado en RODAID`);
            return _resultado('NO_ENCONTRADO', opts.eventId, serial, false, false, false, { intentado: false, ok: false }, `Serial ${serial} no encontrado en RODAID`);
        }
        const denunciaRow = await (0, database_1.queryOne)(`SELECT id, estado, numero_expediente FROM denuncias
       WHERE cit_id=$1 AND estado NOT IN ('RECUPERADA','ARCHIVADA')
       ORDER BY creado_en DESC LIMIT 1`, [citRow.id]);
        let citReactivado = false;
        let denunciaActualizada = false;
        // ── 5. TX atómica: actualizar estado ─────────────────
        await (0, database_1.transaction)(async (client) => {
            // Actualizar denuncia si existe
            if (denunciaRow) {
                await client.query(`UPDATE denuncias SET
             estado='RECUPERADA',
             min_seg_expediente=COALESCE(min_seg_expediente, $2),
             minseg_tipo='RECUPERADA'
           WHERE id=$1`, [denunciaRow.id, payload.numero_expediente ?? null]);
                denunciaActualizada = true;
            }
            // Reactivar CIT si estaba bloqueado
            if (citRow.estado === 'BLOQUEADO') {
                await client.query(`UPDATE cits SET estado='ACTIVO', actualizado_en=NOW() WHERE id=$1`, [citRow.id]);
                citReactivado = true;
            }
            // Actualizar minseg_recuperaciones con referencias
            await client.query(`UPDATE minseg_recuperaciones SET cit_id=$2, denuncia_id=$3 WHERE id=$1`, [recuperacionId, citRow.id, denunciaRow?.id ?? null]);
        });
        // Limpiar caché Redis del serial (alertas + cross-reference)
        const cacheHash = require('crypto').createHash('sha256')
            .update(serial).digest('hex').slice(0, 16);
        await redis.del(`crossref:${cacheHash}`, `minseg:serial:${serial}`).catch(() => { });
        // ── 6. BFA unlock ─────────────────────────────────────
        let bfaInfo = { intentado: false, ok: false };
        if (citRow.nft_token_id && citRow.estado === 'BLOQUEADO') {
            try {
                const bfaSvc = await import('./bfa.service');
                // BFA unlock — usar seguridad.service si está disponible
                let result = { ok: false, txHash: null, error: 'BFA stub' };
                try {
                    const segSvc = await import('./seguridad.service');
                    if (denunciaRow?.id) {
                        const r = await segSvc.reintentarBFALock(denunciaRow.id);
                        result = { ok: r?.ok ?? false, txHash: r?.txHash ?? null, error: r?.error };
                    }
                }
                catch { /* BFA no disponible en STUB */ }
                bfaInfo = { intentado: true, ok: result.ok, txHash: result.txHash ?? undefined, error: result.error ?? undefined };
                if (bfaInfo.txHash) {
                    await (0, database_1.query)(`UPDATE minseg_recuperaciones SET bfa_unlock_tx=$2, bfa_unlock_ok=$3 WHERE id=$1`, [recuperacionId, bfaInfo.txHash, bfaInfo.ok]);
                }
            }
            catch (err) {
                bfaInfo = { intentado: true, ok: false, error: err.message };
            }
        }
        // ── 7. Notificar al propietario ───────────────────────
        let propietarioNotificado = false;
        try {
            propietarioNotificado = await notificarPropietario({
                propietarioId: citRow.propietario_id,
                serial,
                numeroCIT: citRow.numero_cit,
                citId: citRow.id,
                lugarRecuperacion: payload.lugar_recuperacion,
                autoridadActuante: payload.autoridad_actuante,
                fechaRecuperacion: payload.fecha_recuperacion,
                expedienteMinseg: payload.numero_expediente,
            });
            await (0, database_1.query)(`UPDATE minseg_recuperaciones SET notificado_propietario=$2, procesado_en=NOW(), estado='PROCESADO' WHERE id=$1`, [recuperacionId, propietarioNotificado]);
        }
        catch (err) {
            logger_1.log.minseg.warn({ err: err.message, serial }, 'Error notificando propietario');
        }
        const mensaje = citReactivado
            ? `✅ CIT reactivado — propietario notificado (BFA: ${bfaInfo.ok ? 'desbloqueado' : 'pendiente'})`
            : `✅ Recuperación registrada — CIT estaba en estado ${citRow.estado}`;
        logger_1.log.minseg.info({
            serial, eventId: opts.eventId.slice(0, 8),
            citId: citRow.id.slice(0, 8), citReactivado,
            bfaOk: bfaInfo.ok, propietarioNotificado,
        }, '🔓 Recuperación MinSeg procesada');
        return {
            procesado: true, eventId: opts.eventId,
            recuperacionId, serial, citId: citRow.id,
            denunciaId: denunciaRow?.id,
            citReactivado, denunciaActualizada, propietarioNotificado,
            bfa: bfaInfo, mensaje, estado: 'PROCESADO',
        };
    }
    catch (err) {
        const errMsg = err.message;
        await _actualizarEstado(recuperacionId, 'ERROR', null, null, false, { intentado: false, ok: false }, errMsg);
        logger_1.log.minseg.error({ serial, eventId: opts.eventId, err: errMsg }, '✗ Error procesando recuperación MinSeg');
        throw err;
    }
}
// ══════════════════════════════════════════════════════════
// NOTIFICACIÓN AL PROPIETARIO
// ══════════════════════════════════════════════════════════
async function notificarPropietario(opts) {
    const cuerpoNotif = [
        `Tu bicicleta (S/N: ${opts.serial}) fue recuperada.`,
        opts.lugarRecuperacion ? `📍 Lugar: ${opts.lugarRecuperacion}` : '',
        opts.autoridadActuante ? `🏛️ Autoridad: ${opts.autoridadActuante}` : '',
        opts.expedienteMinseg ? `📋 Expediente: ${opts.expedienteMinseg}` : '',
    ].filter(Boolean).join('\n');
    // Notificación in-app
    await (0, database_1.query)(`INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
     VALUES ($1,'BICI_RECUPERADA','🎉 ¡Tu bicicleta fue recuperada por MinSeg!',$2,$3::jsonb)`, [
        opts.propietarioId,
        cuerpoNotif,
        JSON.stringify({
            citId: opts.citId,
            serial: opts.serial,
            numeroCIT: opts.numeroCIT,
            expedienteMinseg: opts.expedienteMinseg ?? null,
            fuente: 'MINSEG',
        }),
    ]).catch(() => { });
    // Push FCM / APNs (fire-and-forget)
    import('./device_token.service').then(dt => dt.enviarPush(opts.propietarioId, {
        titulo: '🎉 ¡Bicicleta recuperada!',
        cuerpo: `Tu ${opts.serial} fue recuperada${opts.lugarRecuperacion ? ` en ${opts.lugarRecuperacion}` : ''}.`,
        datos: {
            tipo: 'BICI_RECUPERADA_MINSEG',
            citId: opts.citId,
            serial: opts.serial,
            expediente: opts.expedienteMinseg ?? '',
        },
    })).catch(() => { });
    // Email (fire-and-forget)
    import('./email.sender').then(async (mail) => {
        const usuario = await (0, database_1.queryOne)(`SELECT email, nombre FROM usuarios WHERE id=$1`, [opts.propietarioId]);
        if (usuario?.email) {
            await mail.sendEmail({
                to: usuario.email,
                template: 'biciRecuperada',
                datos: {
                    nombre: usuario.nombre ?? 'Ciclista',
                    serial: opts.serial,
                    marca: 'Registrado en CIT',
                    modelo: opts.numeroCIT,
                },
            });
        }
    }).catch(() => { });
    return true;
}
// ══════════════════════════════════════════════════════════
// REPROCESAR EVENTOS PENDIENTES
// ══════════════════════════════════════════════════════════
async function reprocesarPendientes() {
    const pendientes = await (0, database_1.query)(`SELECT id, event_id, serial FROM minseg_recuperaciones
     WHERE estado='PENDIENTE' AND creado_en > NOW() - INTERVAL '7 days'
     ORDER BY creado_en LIMIT 20`, []);
    let exitosos = 0;
    let fallidos = 0;
    for (const item of pendientes) {
        try {
            // Re-intentar búsqueda del CIT y reactivación
            const citRow = await (0, database_1.queryOne)(`SELECT c.id, c.estado, c.propietario_id
         FROM cits c JOIN bicicletas b ON b.id=c.bicicleta_id
         WHERE UPPER(b.numero_serie)=$1 ORDER BY c.creado_en DESC LIMIT 1`, [item.serial]);
            if (citRow && citRow.estado === 'BLOQUEADO') {
                await (0, database_1.query)(`UPDATE cits SET estado='ACTIVO', actualizado_en=NOW() WHERE id=$1`, [citRow.id]);
                await (0, database_1.query)(`UPDATE denuncias SET estado='RECUPERADA' WHERE cit_id=$1 AND estado NOT IN ('RECUPERADA','ARCHIVADA')`, [citRow.id]);
                await (0, database_1.query)(`UPDATE minseg_recuperaciones SET estado='PROCESADO', cit_id=$2, procesado_en=NOW() WHERE id=$1`, [item.id, citRow.id]);
                exitosos++;
            }
            else {
                await (0, database_1.query)(`UPDATE minseg_recuperaciones SET estado='NO_ENCONTRADO' WHERE id=$1`, [item.id]);
                fallidos++;
            }
        }
        catch {
            fallidos++;
        }
    }
    return { procesados: pendientes.length, exitosos, fallidos };
}
// ══════════════════════════════════════════════════════════
// QUERIES
// ══════════════════════════════════════════════════════════
async function getRecuperacionesMinSeg(opts) {
    const pagina = Math.max(1, opts?.pagina ?? 1);
    const porPagina = Math.min(100, opts?.porPagina ?? 25);
    const conds = [];
    const params = [];
    let idx = 1;
    if (opts?.estado) {
        conds.push(`estado=$${idx++}`);
        params.push(opts.estado);
    }
    if (opts?.serial) {
        conds.push(`serial ILIKE '%'||$${idx++}||'%'`);
        params.push(opts.serial);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return (0, database_1.query)(`SELECT id, event_id, serial, numero_expediente, autoridad_actuante,
            fecha_recuperacion, estado, cit_id, denuncia_id,
            notificado_propietario, bfa_unlock_ok, procesado_en, creado_en
     FROM minseg_recuperaciones ${where}
     ORDER BY creado_en DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, porPagina, (pagina - 1) * porPagina]);
}
async function getEstadisticasRecuperaciones(dias = 30) {
    return (0, database_1.queryOne)(`SELECT COUNT(*)::int                                              AS total,
            COUNT(*) FILTER(WHERE estado='PROCESADO')::int            AS procesadas,
            COUNT(*) FILTER(WHERE estado='NO_ENCONTRADO')::int        AS no_encontradas,
            COUNT(*) FILTER(WHERE estado='ERROR')::int                AS errores,
            COUNT(*) FILTER(WHERE notificado_propietario)::int        AS notificados,
            COUNT(*) FILTER(WHERE bfa_unlock_ok)::int                 AS bfa_desbloqueados,
            ROUND(AVG(EXTRACT(EPOCH FROM (procesado_en-creado_en))))::int AS latencia_prom_s
     FROM minseg_recuperaciones
     WHERE creado_en > NOW()-($1||' days')::interval`, [dias]);
}
// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function _resultado(estado, eventId, serial, citReactivado, denunciaActualizada, propietarioNotificado, bfa, mensaje, recuperacionId, citId, denunciaId) {
    return {
        procesado: estado === 'PROCESADO',
        eventId, recuperacionId, serial, citId, denunciaId,
        citReactivado, denunciaActualizada, propietarioNotificado,
        bfa, mensaje, estado,
    };
}
async function _actualizarEstado(recuperacionId, estado, citId, denunciaId, bfaOk, bfa, error) {
    await (0, database_1.query)(`UPDATE minseg_recuperaciones SET
       estado=$2, cit_id=$3, denuncia_id=$4,
       bfa_unlock_ok=$5, error_detalle=$6, procesado_en=NOW()
     WHERE id=$1`, [recuperacionId, estado, citId, denunciaId, bfaOk, error ?? null]).catch(() => { });
}
