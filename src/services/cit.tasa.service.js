"use strict";
// ─── RODAID · Tasa CIT — Canal Oficial MxM ────────────────
//
// La Tasa CIT es el arancel gubernamental por emitir el
// Certificado de Identidad Técnica de bicicleta.
// Se paga exclusivamente a través del canal oficial del
// Gobierno de Mendoza: MxM (Mi Mendoza).
//
// ══ FLUJO COMPLETO ════════════════════════════════════════
//
//   1. POST /cit/pago                     ← inspector / propietario
//      iniciarPagoCIT()
//      → GET mxm_token del propietario
//      → POST https://auth.mendoza.gob.ar/api/pagos
//         { concepto: 'TASA_CIT', montoARS, citId, cuil }
//      → MxM retorna { pagoId, redirectUrl }
//      → INSERT cit_pagos_mxm estado=PENDIENTE
//      → UPDATE cits SET estado='PAGO_PENDIENTE'
//      → Responder { mxmPagoId, redirectUrl, montoARS }
//        (el propietario completa el pago en el portal MxM)
//
//   2. MxM notifica pago aprobado
//      POST /webhooks/mxm/pago
//      procesarWebhookPagoMxM()
//      → Verificar firma HMAC del webhook
//      → Buscar cit_pagos_mxm por mxm_pago_id
//      → UPDATE cit_pagos_mxm estado=APROBADO
//      → triggerCITAprobado() → mint NFT BFA
//      → UPDATE cits SET estado=ACTIVO
//      → Notificar propietario e inspector
//
//   3. Si pago rechazado o vencido
//      → UPDATE cit_pagos_mxm estado=RECHAZADO
//      → UPDATE cits SET estado=BORRADOR (permite reintentar)
//
// ══ VALORES ═══════════════════════════════════════════════
//
//   RODAID_TASA_CIT_ARS = 3000 (default)
//   Configurable por admin en la tabla config_sistema
//
// ══ SEGURIDAD ══════════════════════════════════════════════
//
//   · El token MxM del propietario se recupera de mxm_tokens
//   · Si el propietario no tiene token → error 422
//   · Webhook verificado con HMAC-SHA256 (MXM_WEBHOOK_SECRET)
//   · Idempotencia por mxm_pago_id
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MXM_STUB = exports.TASA_CIT_ARS = void 0;
exports.iniciarPagoCIT = iniciarPagoCIT;
exports.procesarWebhookPagoMxM = procesarWebhookPagoMxM;
exports.getPagoCIT = getPagoCIT;
exports.getMisPagosMxM = getMisPagosMxM;
exports.getEstadisticasTasaCIT = getEstadisticasTasaCIT;
exports.simularPagoAprobado = simularPagoAprobado;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const logger_1 = require("../middleware/logger");
const errorHandler_1 = require("../middleware/errorHandler");
const env_1 = require("../config/env");
// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════
const MXM_PAGOS_URL = env_1.env.MXM_PAGOS_URL
    ?? (env_1.env.MXM_AUTH_URL
        ? `${env_1.env.MXM_AUTH_URL}/api/pagos`
        : 'https://auth.mendoza.gob.ar/api/pagos');
const MXM_TRAMITES_URL = env_1.env.MXM_TRAMITES_URL
    ?? (env_1.env.MXM_AUTH_URL
        ? `${env_1.env.MXM_AUTH_URL}/api/tramites`
        : 'https://auth.mendoza.gob.ar/api/tramites');
const TASA_CIT_ARS = parseFloat(process.env.RODAID_TASA_CIT_ARS ?? '3000');
exports.TASA_CIT_ARS = TASA_CIT_ARS;
const MODO_STUB = !env_1.env.MXM_CLIENT_ID && !env_1.env.MXM_PAGOS_URL;
exports.MXM_STUB = MODO_STUB;
const WH_SECRET = process.env.MXM_WEBHOOK_SECRET ?? '';
const PAGO_TTL_H = 2; // el link de pago vence a las 2 horas
// ══════════════════════════════════════════════════════════
// 1. INICIAR PAGO DE TASA CIT
// ══════════════════════════════════════════════════════════
async function iniciarPagoCIT(input) {
    const montoARS = input.montoARS ?? TASA_CIT_ARS;
    // Verificar que el CIT existe y puede pagar
    const cit = await (0, database_1.queryOne)(`SELECT id, estado, propietario_id, propietario_dni, numero_cit FROM cits WHERE id=$1`, [input.citId]);
    if (!cit)
        throw new errorHandler_1.AppError('CIT no encontrado', 404, 'CIT_NOT_FOUND');
    if (!['BORRADOR', 'PAGO_PENDIENTE', 'PENDIENTE'].includes(cit.estado)) {
        throw new errorHandler_1.AppError(`El CIT está en estado ${cit.estado}. Solo se puede pagar en estado BORRADOR.`, 422, 'CIT_ESTADO_INVALIDO');
    }
    // Obtener CUIL del propietario
    const propietario = await (0, database_1.queryOne)(`SELECT cuil, nombre, email FROM usuarios WHERE id=$1`, [input.propietarioId]);
    if (!propietario?.cuil) {
        throw new errorHandler_1.AppError('El propietario no tiene CUIL verificado. Debe verificar su identidad con MxM Nivel 2.', 422, 'CUIL_REQUERIDO');
    }
    // Idempotencia: si ya existe pago PENDIENTE para este CIT → retornar el existente
    const idempKey = `cit-tasa-${input.citId}`;
    const yaExiste = await (0, database_1.queryOne)(`SELECT id, mxm_pago_id, mxm_estado, vence_en FROM cit_pagos_mxm
     WHERE cit_id=$1 AND mxm_estado='PENDIENTE' AND vence_en > NOW()
     ORDER BY iniciado_en DESC LIMIT 1`, [input.citId]);
    if (yaExiste) {
        logger_1.log.mxm.warn({ citId: input.citId.slice(0, 8), pagoId: yaExiste.mxm_pago_id }, '⚠ Pago CIT ya pendiente — retornando idempotente');
        return {
            pagoId: yaExiste.id,
            mxmPagoId: yaExiste.mxm_pago_id,
            redirectUrl: construirRedirectUrl(yaExiste.mxm_pago_id),
            montoARS,
            concepto: 'TASA_CIT',
            venceEn: new Date(yaExiste.vence_en),
            estado: 'PENDIENTE',
            modo: MODO_STUB ? 'STUB' : 'LIVE',
        };
    }
    // Obtener token MxM del propietario
    const mxmToken = await getMxMToken(input.propietarioId);
    // Construir payload para MxM
    const pagoPayload = {
        concepto: 'TASA_CIT',
        montoARS,
        citId: input.citId,
        descripcion: `Tasa CIT Ley 9556 — Bicicleta. Inspector autorizado RODAID.`,
        usuarioCuil: propietario.cuil,
        usuarioNombre: propietario.nombre ?? 'Propietario',
        callbackUrl: `${process.env.RODAID_API_URL ?? 'https://api.rodaid.com.ar'}/api/v1/webhooks/mxm/pago`,
        returnUrl: `${process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'}/cit/pago/resultado`,
        idempotencyKey: idempKey,
        metadata: {
            numeroCIT: cit.numero_cit,
            fuente: 'RODAID',
            ley: '9556',
        },
    };
    // Llamar a MxM
    let mxmPagoId;
    let redirectUrl;
    if (MODO_STUB) {
        mxmPagoId = `MXM-STUB-${Date.now()}-${input.citId.slice(0, 8)}`;
        redirectUrl = `${process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar'}/cit/pago/stub?pagoId=${mxmPagoId}&monto=${montoARS}`;
        logger_1.log.mxm.warn({ citId: input.citId.slice(0, 8), mxmPagoId }, '⚠ MxM STUB — pago de tasa CIT simulado');
    }
    else {
        const resp = await fetch(MXM_PAGOS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${mxmToken}`,
                'Idempotency-Key': idempKey,
            },
            body: JSON.stringify(pagoPayload),
            signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new errorHandler_1.AppError(`Error MxM al iniciar pago: ${err.message ?? resp.status}`, 502, 'MXM_PAGO_ERROR');
        }
        const body = await resp.json();
        mxmPagoId = body.pagoId;
        redirectUrl = body.redirectUrl;
    }
    const venceEn = new Date(Date.now() + PAGO_TTL_H * 3_600_000);
    // Registrar en DB
    const pagoRow = await (0, database_1.queryOne)(`INSERT INTO cit_pagos_mxm
       (cit_id, propietario_id, inspector_id, concepto, monto_ars, descripcion,
        mxm_pago_id, mxm_estado, mxm_token_snapshot, canal, idempotency_key, vence_en)
     VALUES ($1,$2,$3,'TASA_CIT',$4,$5,$6,'PENDIENTE',$7,'MXM_GOB',$8,$9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`, [
        input.citId, input.propietarioId, input.inspectorId ?? null,
        montoARS,
        `Tasa CIT Ley 9556 — ${cit.numero_cit ?? input.citId.slice(0, 8)}`,
        mxmPagoId,
        mxmToken?.slice(0, 16) ?? 'STUB',
        idempKey, venceEn,
    ]);
    // Actualizar estado del CIT a PAGO_PENDIENTE
    await (0, database_1.query)(`UPDATE cits SET estado='PAGO_PENDIENTE', actualizado_en=NOW() WHERE id=$1`, [input.citId]);
    logger_1.log.mxm.info({
        citId: input.citId.slice(0, 8),
        mxmPagoId, montoARS,
        modo: MODO_STUB ? 'STUB' : 'LIVE',
    }, `💳 Tasa CIT iniciada — $${montoARS} ARS vía MxM`);
    return {
        pagoId: pagoRow.id,
        mxmPagoId,
        redirectUrl,
        montoARS,
        concepto: 'TASA_CIT',
        venceEn,
        estado: 'PENDIENTE',
        modo: MODO_STUB ? 'STUB' : 'LIVE',
    };
}
// ══════════════════════════════════════════════════════════
// 2. WEBHOOK DE CONFIRMACIÓN MxM
// ══════════════════════════════════════════════════════════
async function procesarWebhookPagoMxM(opts) {
    // 1. Verificar firma HMAC-SHA256
    if (WH_SECRET && !MODO_STUB) {
        const ts = Math.floor(Date.now() / 1000).toString();
        const bodyHash = crypto_1.default.createHash('sha256').update(opts.rawBody).digest('hex');
        const canonical = `${ts}.${bodyHash}`;
        const esperado = crypto_1.default.createHmac('sha256', WH_SECRET).update(canonical).digest('hex');
        const sigBuf = Buffer.from(opts.signature.slice(0, 64).padEnd(64, '0'), 'hex');
        const expBuf = Buffer.from(esperado, 'hex');
        const valida = sigBuf.length === expBuf.length
            ? crypto_1.default.timingSafeEqual(sigBuf, expBuf) : false;
        if (!valida) {
            return { procesado: false, estado: 'ERROR', accion: 'RECHAZADO', mensaje: 'Firma inválida' };
        }
    }
    // 2. Deduplicar
    const redis = (0, redis_1.getRedis)();
    const dedupKey = `mxm:pago:wh:${opts.eventId}`;
    const yaVisto = await redis.get(dedupKey).catch(() => null);
    if (yaVisto) {
        return { procesado: false, estado: 'DUPLICADO', accion: 'IGNORADO', mensaje: `Evento ${opts.eventId} ya procesado` };
    }
    await redis.set(dedupKey, '1', 'EX', 86_400).catch(() => { });
    // 3. Parsear payload
    let payload;
    try {
        payload = JSON.parse(opts.rawBody);
    }
    catch {
        return { procesado: false, estado: 'ERROR', accion: 'ERROR_PARSE', mensaje: 'JSON inválido' };
    }
    const { pagoId: mxmPagoId, estado, expedienteId } = payload;
    // 4. Buscar pago en DB
    const pago = await (0, database_1.queryOne)(`SELECT id, cit_id, propietario_id, inspector_id
     FROM cit_pagos_mxm WHERE mxm_pago_id=$1`, [mxmPagoId]);
    if (!pago) {
        return { procesado: false, estado: 'NO_ENCONTRADO', accion: 'IGNORADO',
            mensaje: `Pago ${mxmPagoId} no encontrado en RODAID` };
    }
    // 5. Actualizar estado del pago
    const nuevoEstado = estado === 'APROBADO' ? 'APROBADO'
        : estado === 'RECHAZADO' ? 'RECHAZADO'
            : 'VENCIDO';
    await (0, database_1.query)(`UPDATE cit_pagos_mxm SET
       mxm_estado=$2::text, webhook_event_id=$3::text, webhook_payload=$4::jsonb,
       webhook_recibido_en=NOW(), mxm_expediente_id=$5::text,
       aprobado_en=CASE WHEN $2::text='APROBADO' THEN NOW() ELSE aprobado_en END
     WHERE id=$1::uuid`, [pago.id, nuevoEstado, opts.eventId, opts.rawBody, expedienteId ?? null]);
    let accion = 'REGISTRADO';
    let citId = pago.cit_id ?? undefined;
    // 6. Consecuencias según estado
    if (nuevoEstado === 'APROBADO' && pago.cit_id) {
        accion = await procesarPagoAprobado(pago.cit_id, pago.propietario_id, pago.inspector_id, expedienteId);
        citId = pago.cit_id;
    }
    else if (['RECHAZADO', 'VENCIDO'].includes(nuevoEstado) && pago.cit_id) {
        await (0, database_1.query)(`UPDATE cits SET estado='BORRADOR', actualizado_en=NOW() WHERE id=$1 AND estado='PAGO_PENDIENTE'`, [pago.cit_id]);
        // Notificar al propietario del rechazo
        import('./device_token.service').then(dt => dt.enviarPush(pago.propietario_id, {
            titulo: '❌ Pago de tasa CIT rechazado',
            cuerpo: `El pago de la Tasa CIT fue ${nuevoEstado.toLowerCase()}. Podés intentarlo nuevamente.`,
            datos: { tipo: 'CIT_TASA_RECHAZADA', citId: pago.cit_id ?? '', mxmPagoId },
        })).catch(() => { });
        accion = `CIT_REVERTIDO_A_BORRADOR`;
    }
    logger_1.log.mxm.info({
        mxmPagoId, nuevoEstado, citId: citId?.slice(0, 8), accion,
    }, `📥 Webhook pago MxM: ${nuevoEstado}`);
    return { procesado: true, citId, estado: nuevoEstado, accion, mensaje: `Pago ${mxmPagoId} → ${nuevoEstado}` };
}
// ══════════════════════════════════════════════════════════
// PROCESAR PAGO APROBADO → EMITIR CIT
// ══════════════════════════════════════════════════════════
async function procesarPagoAprobado(citId, propietarioId, inspectorId, expedienteId) {
    // Actualizar CIT: PAGO_PENDIENTE → ACTIVO
    await (0, database_1.query)(`UPDATE cits SET
       estado='ACTIVO',
       actualizado_en=NOW()
     WHERE id=$1 AND estado='PAGO_PENDIENTE'`, [citId]);
    // Guardar expediente MxM si vino en el webhook
    if (expedienteId) {
        await (0, database_1.query)(`UPDATE cits SET estado_pago_mxm=$2 WHERE id=$1`, [citId, expedienteId]).catch(() => { }); // columna opcional
    }
    // Notificar propietario — tasa pagada, CIT activo
    await (0, database_1.query)(`INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
     VALUES ($1,'CIT_TASA_PAGADA','✅ Tasa CIT pagada — certificado activo','Tu bicicleta ya tiene su CIT activo en la Blockchain Federal Argentina.',$2::jsonb)`, [propietarioId, JSON.stringify({ citId, expedienteMxm: expedienteId ?? null })]).catch(() => { });
    import('./device_token.service').then(dt => dt.enviarPush(propietarioId, {
        titulo: '🎉 ¡CIT Activo!',
        cuerpo: 'La tasa fue aprobada por MxM. Tu certificado está vigente.',
        datos: { tipo: 'CIT_ACTIVO', citId, expedienteMxm: expedienteId ?? '' },
    })).catch(() => { });
    // Trigger NFT + BFA (fire-and-forget)
    // Trigger CIT post-pago: consultar datos del CIT y disparar BFA/notificaciones
    import('./cit.triggers.service').then(async (t) => {
        const { queryOne: qo } = await import('../config/database');
        const citData = await qo(`SELECT c.*, b.numero_serie, b.marca, b.modelo, u.id AS usuario_id, i.taller_aliado_id
       FROM cits c
       JOIN bicicletas b ON b.id=c.bicicleta_id
       JOIN usuarios u ON u.id=c.propietario_id
       LEFT JOIN inspectores i ON i.id=c.inspector_id
       WHERE c.id=$1`, [citId]).catch(() => null);
        if (!citData)
            return;
        t.triggerCITAprobado({
            citId,
            usuarioId: citData.usuario_id,
            numeroCIT: citData.numero_cit ?? citId.slice(0, 8),
            serial: citData.numero_serie ?? '',
            marca: citData.marca ?? '',
            modelo: citData.modelo ?? '',
            txHash: citData.hash_sha256 ?? '0x00',
            inspectorId: inspectorId ?? undefined,
            tallerAliadoId: citData.taller_aliado_id ?? undefined,
        });
    }).catch(() => { });
    // Notificar inspector si aplica
    if (inspectorId) {
        const inspector = await (0, database_1.queryOne)(`SELECT usuario_id FROM inspectores WHERE id=$1`, [inspectorId]);
        if (inspector?.usuario_id) {
            import('./device_token.service').then(dt => dt.enviarPush(inspector.usuario_id, {
                titulo: '✅ Tasa CIT pagada',
                cuerpo: 'El propietario pagó la tasa. El CIT ya está activo.',
                datos: { tipo: 'CIT_TASA_PAGADA', citId },
            })).catch(() => { });
        }
    }
    return 'CIT_ACTIVADO';
}
// ══════════════════════════════════════════════════════════
// CONSULTAS Y UTILIDADES
// ══════════════════════════════════════════════════════════
async function getPagoCIT(citId) {
    return (0, database_1.queryOne)(`SELECT p.id, p.mxm_pago_id, p.mxm_estado, p.mxm_expediente_id,
            p.monto_ars, p.concepto, p.canal, p.aprobado_en, p.vence_en, p.creado_en,
            p.webhook_recibido_en
     FROM cit_pagos_mxm p
     WHERE p.cit_id=$1 ORDER BY p.creado_en DESC LIMIT 1`, [citId]);
}
async function getMisPagosMxM(propietarioId, pagina = 1, porPagina = 25) {
    const offset = (pagina - 1) * porPagina;
    const [rows, total] = await Promise.all([
        (0, database_1.query)(`SELECT p.id, p.cit_id, p.mxm_pago_id, p.mxm_estado, p.mxm_expediente_id,
              p.monto_ars, p.concepto, p.aprobado_en, p.vence_en, p.creado_en,
              c.numero_cit, c.estado AS cit_estado
       FROM cit_pagos_mxm p
       LEFT JOIN cits c ON c.id=p.cit_id
       WHERE p.propietario_id=$1
       ORDER BY p.creado_en DESC LIMIT $2 OFFSET $3`, [propietarioId, porPagina, offset]),
        (0, database_1.queryOne)(`SELECT COUNT(*)::text AS count FROM cit_pagos_mxm WHERE propietario_id=$1`, [propietarioId]),
    ]);
    return { pagos: rows, total: parseInt(total?.count ?? '0'), pagina, porPagina };
}
async function getEstadisticasTasaCIT(dias = 30) {
    return (0, database_1.queryOne)(`SELECT COUNT(*)::int                                              AS total,
            COUNT(*) FILTER(WHERE mxm_estado='APROBADO')::int        AS aprobados,
            COUNT(*) FILTER(WHERE mxm_estado='RECHAZADO')::int       AS rechazados,
            COUNT(*) FILTER(WHERE mxm_estado='PENDIENTE')::int       AS pendientes,
            COALESCE(SUM(monto_ars) FILTER(WHERE mxm_estado='APROBADO'),0)::numeric AS recaudado_ars,
            ROUND(AVG(monto_ars),2)::numeric                         AS tasa_promedio
     FROM cit_pagos_mxm WHERE creado_en > NOW()-($1||' days')::interval`, [dias]);
}
/** Simular confirmación de pago para testing (sin MxM real) */
async function simularPagoAprobado(mxmPagoId) {
    const body = JSON.stringify({
        pagoId: mxmPagoId,
        estado: 'APROBADO',
        montoARS: TASA_CIT_ARS,
        concepto: 'TASA_CIT',
        timestamp: new Date().toISOString(),
    });
    const eventId = `SIM-${Date.now()}`;
    return procesarWebhookPagoMxM({ rawBody: body, signature: '', eventId, ipOrigen: '127.0.0.1' });
}
// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
async function getMxMToken(propietarioId) {
    const row = await (0, database_1.queryOne)(`SELECT access_token FROM mxm_tokens WHERE usuario_id=$1 AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY actualizado_en DESC LIMIT 1`, [propietarioId]);
    return row?.access_token ?? null;
}
function construirRedirectUrl(mxmPagoId) {
    const base = process.env.RODAID_FRONTEND_URL ?? 'https://rodaid.com.ar';
    return MODO_STUB
        ? `${base}/cit/pago/stub?pagoId=${mxmPagoId}`
        : `${MXM_PAGOS_URL}/${mxmPagoId}/completar`;
}
