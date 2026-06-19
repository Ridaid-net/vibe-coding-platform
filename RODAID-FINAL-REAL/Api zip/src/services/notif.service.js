"use strict";
// ─── RODAID · Notification Service ───────────────────────
// Maneja el ciclo completo de notificaciones al ciclista:
//   1. CIT aprobado → tokenId, txHash, link BFA explorer
//   2. CIT rechazado → motivo, link de apelación
//   3. CIT por vencer (30, 15, 7, 1 días antes)
//   4. Denuncia de robo registrada
//   5. Bicicleta recuperada
//   6. Venta confirmada en Marketplace
//
// Canales:
//   IN_APP  → tabla notificaciones (siempre)
//   EMAIL   → Resend SDK (si RESEND_API_KEY configurado)
//   PUSH    → FCM Firebase (si FCM_SERVER_KEY configurado)
//
// Preferencias por usuario:
//   notif_preferencias.email_activo / push_activo / cit_aprobado / etc.
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificar = notificar;
exports.notificarCITAprobado = notificarCITAprobado;
exports.notificarCITRechazado = notificarCITRechazado;
exports.notificarCITPorVencer = notificarCITPorVencer;
exports.notificarDenunciaRegistrada = notificarDenunciaRegistrada;
exports.notificarBiciRecuperada = notificarBiciRecuperada;
exports.notificarVentaConfirmada = notificarVentaConfirmada;
exports.notificarCompraCompletada = notificarCompraCompletada;
exports.procesarNotifVencimiento = procesarNotifVencimiento;
exports.getMisNotificaciones = getMisNotificaciones;
exports.marcarLeida = marcarLeida;
exports.marcarTodasLeidas = marcarTodasLeidas;
exports.getSetPreferencias = getSetPreferencias;
exports.registrarFCMToken = registrarFCMToken;
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const env_1 = require("../config/env");
// ══════════════════════════════════════════════════════════
// PREFERENCIAS
// ══════════════════════════════════════════════════════════
async function getPreferencias(usuarioId) {
    const prefs = await (0, database_1.queryOne)(`SELECT email_activo, push_activo, fcm_token, cit_aprobado, cit_rechazado,
            cit_por_vencer, denuncia_registrada, venta_confirmada
     FROM notif_preferencias WHERE usuario_id = $1`, [usuarioId]);
    // Defaults si no existe registro
    return prefs ?? {
        email_activo: true, push_activo: true, fcm_token: null,
        cit_aprobado: true, cit_rechazado: true, cit_por_vencer: true,
        denuncia_registrada: true, venta_confirmada: true,
    };
}
/** Verifica si el usuario quiere recibir este tipo de notificación */
function tipoHabilitado(prefs, tipo) {
    const map = {
        'CIT_APROBADO': 'cit_aprobado',
        'CIT_RECHAZADO': 'cit_rechazado',
        'CIT_POR_VENCER': 'cit_por_vencer',
        'DENUNCIA_REGISTRADA': 'denuncia_registrada',
        'BICI_RECUPERADA': 'denuncia_registrada',
        'VENTA_CONFIRMADA': 'venta_confirmada',
        'COMPRA_COMPLETADA': 'venta_confirmada',
    };
    const campo = map[tipo];
    return campo ? Boolean(prefs[campo]) : true;
}
// ══════════════════════════════════════════════════════════
// EMAIL — Resend SDK
// ══════════════════════════════════════════════════════════
async function enviarEmail(usuario, titulo, cuerpo, datos) {
    if (!env_1.env.RESEND_API_KEY) {
        logger_1.log.bfa.warn({ email: usuario.email }, '⚠️  EMAIL STUB — configurar RESEND_API_KEY');
        return { enviado: false, error: 'RESEND_API_KEY no configurado' };
    }
    try {
        const html = buildEmailHTML(usuario.nombre, titulo, cuerpo, datos);
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${env_1.env.RESEND_API_KEY}`,
            },
            body: JSON.stringify({
                from: 'RODAID <notificaciones@rodaid.com.ar>',
                to: [usuario.email],
                subject: titulo,
                html,
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Resend ${res.status}: ${err.slice(0, 100)}`);
        }
        const { id } = await res.json();
        logger_1.log.bfa.info({ emailId: id, to: usuario.email, titulo }, '✉ Email enviado via Resend');
        return { enviado: true, emailId: id };
    }
    catch (err) {
        const errMsg = err.message;
        logger_1.log.bfa.warn({ to: usuario.email, errMsg }, '✗ Email falló');
        return { enviado: false, error: errMsg };
    }
}
// ══════════════════════════════════════════════════════════
// PUSH — Firebase Cloud Messaging (FCM v1)
// ══════════════════════════════════════════════════════════
async function enviarPush(fcmToken, titulo, cuerpo, datos) {
    // Delegar a FCM v1 service
    try {
        const { enviarPushToken } = await import('./fcm.service');
        const r = await enviarPushToken(fcmToken, 'ANDROID', { titulo, cuerpo, datos: Object.fromEntries(Object.entries(datos ?? {}).map(([k, v]) => [k, String(v)])) });
        return r;
    }
    catch (e) {
        return { enviado: false, error: e.message };
    }
    return { enviado: false, error: 'Not reached' };
    if (false) { // dead code — below code is unreachable
        try {
            const res = await fetch('https://fcm.googleapis.com/fcm/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `key=${env_1.env.FCM_SERVER_KEY}`,
                },
                body: JSON.stringify({
                    to: fcmToken,
                    notification: { title: titulo, body: cuerpo },
                    data: { ...datos, source: 'RODAID' },
                    android: {
                        priority: 'high',
                        notification: { sound: 'default', channel_id: 'rodaid_notif' },
                    },
                    apns: {
                        payload: { aps: { sound: 'default', badge: 1 } },
                    },
                }),
                signal: AbortSignal.timeout(8_000),
            });
            if (!res.ok)
                throw new Error(`FCM ${res.status}`);
            const body = await res.json();
            if (body.failure > 0) {
                throw new Error(body.results[0]?.error ?? 'FCM delivery failure');
            }
            logger_1.log.bfa.info({ token: fcmToken.slice(0, 10) + '...', titulo }, '📱 Push enviado via FCM');
            return { enviado: true };
        }
        catch (err) {
            const errMsg = err.message;
            logger_1.log.bfa.warn({ token: fcmToken.slice(0, 10) + '...', errMsg }, '✗ Push FCM falló');
            return { enviado: false, error: errMsg };
        }
    }
}
// ══════════════════════════════════════════════════════════
// ORQUESTADOR PRINCIPAL
// ══════════════════════════════════════════════════════════
async function notificar(input) {
    const timer = (0, logger_1.startTimer)('notif', { tipo: input.tipo, usuarioId: input.usuarioId });
    // 1. Cargar preferencias y datos del usuario en paralelo
    const [prefs, usuario] = await Promise.all([
        getPreferencias(input.usuarioId),
        (0, database_1.queryOne)(`SELECT id, nombre, apellido, email FROM usuarios WHERE id = $1`, [input.usuarioId]),
    ]);
    if (!usuario) {
        logger_1.log.bfa.warn({ usuarioId: input.usuarioId }, 'Notificación: usuario no encontrado');
        return {
            notifId: '', inApp: false,
            email: { enviado: false, error: 'Usuario no encontrado' },
            push: { enviado: false },
            preferencias: prefs,
        };
    }
    // 2. Insertar notificación IN_APP (siempre, independiente de preferencias)
    const notifRow = await (0, database_1.queryOne)(`INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
     VALUES ($1, $2::tipo_notificacion, $3, $4, $5)
     RETURNING id`, [
        input.usuarioId,
        input.tipo,
        input.titulo,
        input.cuerpo,
        JSON.stringify(input.datos ?? {}),
    ]);
    const notifId = notifRow.id;
    // 3. Verificar si el tipo está habilitado en preferencias
    const tipoEnabled = input.forzarEmail || input.forzarPush || tipoHabilitado(prefs, input.tipo);
    let emailResult = { enviado: false };
    let pushResult = { enviado: false };
    if (tipoEnabled) {
        // 4. Enviar email y push en paralelo
        const [emailRes, pushRes] = await Promise.all([
            // Email: si tiene API key y usuario lo quiere
            (input.forzarEmail || prefs.email_activo) && usuario.email
                ? enviarEmail(usuario, input.titulo, input.cuerpo, input.datos)
                : Promise.resolve({ enviado: false, error: 'email desactivado' }),
            // Push: si tiene token FCM y usuario lo quiere
            (input.forzarPush || prefs.push_activo) && prefs.fcm_token
                ? enviarPush(prefs.fcm_token, input.titulo, input.cuerpo, input.datos)
                : Promise.resolve({ enviado: false, error: 'push desactivado o sin token' }),
        ]);
        emailResult = emailRes;
        pushResult = pushRes;
        // 5. Persistir resultado de envío
        await (0, database_1.query)(`UPDATE notificaciones
       SET email_enviado     = $2,
           email_enviado_en  = CASE WHEN $2 THEN NOW() ELSE NULL END,
           email_id          = $3,
           push_enviado      = $4,
           push_enviado_en   = CASE WHEN $4 THEN NOW() ELSE NULL END,
           push_error        = $5
       WHERE id = $1`, [
            notifId,
            emailResult.enviado, emailResult.emailId ?? null,
            pushResult.enviado, pushResult.error ?? null,
        ]);
    }
    const ms = timer({ notifId, email: emailResult.enviado, push: pushResult.enviado });
    logger_1.log.bfa.info({
        notifId, tipo: input.tipo, usuarioId: input.usuarioId,
        email: emailResult.enviado, push: pushResult.enviado, ms,
    }, `✓ Notificación enviada · ${input.tipo}`);
    return { notifId, inApp: true, email: emailResult, push: pushResult, preferencias: prefs };
}
// ══════════════════════════════════════════════════════════
// NOTIFICACIONES ESPECÍFICAS
// ══════════════════════════════════════════════════════════
/** CIT aprobado y NFT acuñado en BFA */
async function notificarCITAprobado(input) {
    const custodialMsg = input.esCustodial
        ? '\n\nEl NFT está en custodia RODAID. Registrá tu wallet para reclamarlo.'
        : `\n\nEl NFT fue transferido a tu wallet: ${input.txHash.slice(0, 10)}...`;
    return notificar({
        usuarioId: input.usuarioId,
        tipo: 'CIT_APROBADO',
        titulo: `✅ CIT ${input.numeroCIT} activado · NFT #${input.tokenId} en BFA`,
        cuerpo: [
            `Tu Certificado de Identidad Técnica fue aprobado y registrado en la Blockchain Federal Argentina.`,
            ``,
            `📋 Certificado: ${input.numeroCIT}`,
            `🚲 Serie: ${input.serial}`,
            `🔗 NFT Token ID: #${input.tokenId}`,
            `📅 Vence: ${new Date(input.venceEn).toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })}`,
            ``,
            `Verificar en BFA: ${input.bfaExplorerUrl}`,
            custodialMsg,
        ].join('\n'),
        datos: input,
    });
}
/** CIT rechazado por alerta del Ministerio de Seguridad */
async function notificarCITRechazado(input) {
    return notificar({
        usuarioId: input.usuarioId,
        tipo: 'CIT_RECHAZADO',
        titulo: `❌ CIT ${input.numeroCIT} rechazado — Alerta de seguridad`,
        cuerpo: [
            `Tu solicitud de CIT fue rechazada porque el rodado figura en la base de datos del Ministerio de Seguridad de Mendoza.`,
            ``,
            `📋 Certificado: ${input.numeroCIT}`,
            `🚲 Serie: ${input.serial}`,
            `⚠️  Motivo: ${input.motivo}`,
            input.minSegExpediente ? `📁 Expediente Min.Seg.: ${input.minSegExpediente}` : '',
            ``,
            `Si creés que hay un error, comunicarte con la Comisaría más cercana o con el Ministerio de Seguridad.`,
        ].filter(Boolean).join('\n'),
        datos: input,
        forzarEmail: true, // siempre enviar email en rechazos
    });
}
/** CIT próximo a vencer */
async function notificarCITPorVencer(input) {
    return notificar({
        usuarioId: input.usuarioId,
        tipo: 'CIT_POR_VENCER',
        titulo: `⏰ Tu CIT ${input.numeroCIT} vence en ${input.diasRestantes} días`,
        cuerpo: [
            `Tu Certificado de Identidad Técnica está próximo a vencer.`,
            ``,
            `📋 Certificado: ${input.numeroCIT}`,
            `🚲 Serie: ${input.serial}`,
            `📅 Vence el: ${new Date(input.venceEn).toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })}`,
            `⏳ Días restantes: ${input.diasRestantes}`,
            ``,
            `Agendá una nueva inspección técnica en un Taller Aliado RODAID para renovarlo.`,
        ].join('\n'),
        datos: input,
    });
}
/** Denuncia de robo registrada */
async function notificarDenunciaRegistrada(input) {
    return notificar({
        usuarioId: input.usuarioId,
        tipo: 'DENUNCIA_REGISTRADA',
        titulo: `🚨 Denuncia de robo registrada · ${input.serial}`,
        cuerpo: [
            `Tu denuncia fue registrada exitosamente.`,
            ``,
            `🚲 Serie: ${input.serial}`,
            `📋 CIT: ${input.numeroCIT} → bloqueado en blockchain`,
            input.minSegExpediente ? `📁 Expediente Min.Seg.: ${input.minSegExpediente}` : '⚠️  Ministerio de Seguridad será notificado próximamente',
            input.bfaTxHash ? `🔗 TX bloqueo BFA: ${input.bfaTxHash.slice(0, 16)}...` : '',
            ``,
            `Ninguna venta puede realizarse mientras el CIT esté bloqueado.`,
            `Cuando recuperes tu bicicleta, marcala como recuperada en la app RODAID.`,
        ].filter(Boolean).join('\n'),
        datos: input,
        forzarEmail: true,
    });
}
/** Bicicleta recuperada */
async function notificarBiciRecuperada(input) {
    return notificar({
        usuarioId: input.usuarioId,
        tipo: 'BICI_RECUPERADA',
        titulo: `✅ ¡Bicicleta recuperada! · CIT ${input.numeroCIT} reactivado`,
        cuerpo: [
            `¡Buenas noticias! Tu bicicleta fue marcada como recuperada.`,
            ``,
            `🚲 Serie: ${input.serial}`,
            `📋 CIT: ${input.numeroCIT} → reactivado en blockchain`,
            ``,
            `Recomendamos realizar una nueva inspección técnica para refrescar el CIT.`,
        ].join('\n'),
        datos: input,
    });
}
/** Venta confirmada (vendedor) */
async function notificarVentaConfirmada(input) {
    return notificar({
        usuarioId: input.usuarioId,
        tipo: 'VENTA_CONFIRMADA',
        titulo: `💰 Venta confirmada · $${input.montoVendedor.toLocaleString('es-AR')} disponibles`,
        cuerpo: [
            `El comprador confirmó la recepción de la bicicleta.`,
            ``,
            `📋 CIT transferido: ${input.numeroCIT}`,
            `👤 Comprador: ${input.compradorNombre}`,
            `💵 Monto acreditado: $${input.montoVendedor.toLocaleString('es-AR')} ARS`,
            ``,
            `Nota: se descontó el 2.5% de comisión RODAID.`,
        ].join('\n'),
        datos: input,
    });
}
/** Compra completada (comprador) */
async function notificarCompraCompletada(input) {
    return notificar({
        usuarioId: input.usuarioId,
        tipo: 'COMPRA_COMPLETADA',
        titulo: `🚲 Compra completada · Sos el nuevo propietario`,
        cuerpo: [
            `¡Felicitaciones! La compra fue confirmada exitosamente.`,
            ``,
            `📋 CIT transferido: ${input.numeroCIT}`,
            `🚲 Serie: ${input.serial}`,
            input.tokenId ? `🔗 NFT Token ID: #${input.tokenId}` : '',
            ``,
            `El CIT y el NFT quedaron registrados a tu nombre en RODAID y en la Blockchain Federal Argentina.`,
        ].filter(Boolean).join('\n'),
        datos: input,
    });
}
// ══════════════════════════════════════════════════════════
// NOTIFICACIONES EN BATCH (por vencimiento)
// ══════════════════════════════════════════════════════════
/** Busca CITs próximos a vencer y notifica — ejecutado por cron diario */
async function procesarNotifVencimiento() {
    const hoy = new Date();
    const umbrales = [30, 15, 7, 1]; // días antes de vencer
    let total = 0;
    let enviadas = 0;
    for (const dias of umbrales) {
        const fechaObjetivo = new Date(hoy);
        fechaObjetivo.setDate(hoy.getDate() + dias);
        const porVencer = await (0, database_1.query)(`SELECT c.propietario_id, c.numero_cit, b.numero_serie, c.fecha_vencimiento
       FROM cits c
       JOIN bicicletas b ON b.id = c.bicicleta_id
       WHERE c.estado = 'ACTIVO'
         AND c.fecha_vencimiento::date = $1::date
         AND NOT EXISTS (
           SELECT 1 FROM notificaciones n
           WHERE n.usuario_id = c.propietario_id
             AND n.tipo = 'CIT_POR_VENCER'
             AND n.datos->>'numeroCIT' = c.numero_cit
             AND n.creado_en::date = CURRENT_DATE
         )`, [fechaObjetivo.toISOString().split('T')[0]]);
        for (const cit of porVencer) {
            total++;
            try {
                await notificarCITPorVencer({
                    usuarioId: cit.propietario_id,
                    numeroCIT: cit.numero_cit,
                    serial: cit.numero_serie,
                    venceEn: cit.fecha_vencimiento.toISOString(),
                    diasRestantes: dias,
                });
                enviadas++;
            }
            catch (err) {
                logger_1.log.bfa.warn({ numeroCIT: cit.numero_cit, err: err.message }, 'Notif vencimiento falló');
            }
        }
    }
    logger_1.log.bfa.info({ total, enviadas }, `✓ Notificaciones de vencimiento procesadas`);
    return { total, enviadas };
}
// ══════════════════════════════════════════════════════════
// EMAIL HTML TEMPLATE
// ══════════════════════════════════════════════════════════
function buildEmailHTML(nombre, titulo, cuerpo, datos) {
    const NAVY = '#0F1E35';
    const ORANGE = '#F97316';
    const TEAL = '#0D9488';
    // Convertir saltos de línea a HTML
    const cuerpoPárrafos = cuerpo
        .split('\n')
        .map(l => l.trim() === '' ? '<br>' : `<p style="margin:8px 0;color:#374151;line-height:1.6">${l}</p>`)
        .join('');
    // Botón CTA según tipo de notificación
    const citId = datos?.citId ?? datos?.numeroCIT;
    const ctaUrl = citId
        ? `https://rodaid.com.ar/cit/${citId}`
        : 'https://rodaid.com.ar';
    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
        <!-- Header -->
        <tr><td style="background:${NAVY};padding:28px 40px">
          <p style="margin:0;color:white;font-size:22px;font-weight:700;letter-spacing:-0.5px">RODAID</p>
          <p style="margin:4px 0 0;color:#94A3B8;font-size:11px">Certificación de Bicicletas · Ley 9556 · Mendoza</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px">
          <h1 style="margin:0 0 24px;color:${NAVY};font-size:20px;line-height:1.3">${titulo}</h1>
          <p style="margin:0 0 16px;color:#6B7280;font-size:14px">Hola, <strong>${nombre}</strong>.</p>
          <div style="margin:0 0 28px">${cuerpoPárrafos}</div>
          <a href="${ctaUrl}"
             style="display:inline-block;background:${ORANGE};color:white;text-decoration:none;
                    padding:14px 28px;border-radius:8px;font-size:15px;font-weight:700">
            Ver en RODAID →
          </a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="border-top:1px solid #E5E7EB;padding:20px 40px;background:#F9FAFB">
          <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.5">
            Enviado por RODAID · Mendoza, Argentina<br>
            Ley Provincial N° 9556 · rodaid.com.ar<br>
            Para cambiar tus preferencias de notificación, ingresá a la app.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
// ══════════════════════════════════════════════════════════
// API PÚBLICA — consultas y gestión
// ══════════════════════════════════════════════════════════
async function getMisNotificaciones(usuarioId, opts = {}) {
    const { soloNoLeidas = false, page = 1, limit = 20 } = opts;
    const offset = (page - 1) * limit;
    const where = soloNoLeidas
        ? `WHERE usuario_id=$1 AND leida=FALSE`
        : `WHERE usuario_id=$1`;
    const [items, counts] = await Promise.all([
        (0, database_1.query)(`SELECT id, tipo, titulo, cuerpo, datos, leida, leida_en,
              email_enviado, push_enviado, creado_en
       FROM notificaciones ${where}
       ORDER BY creado_en DESC
       LIMIT $2 OFFSET $3`, [usuarioId, limit, offset]),
        (0, database_1.queryOne)(`SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE leida=FALSE)::text AS no_leidas
       FROM notificaciones WHERE usuario_id=$1`, [usuarioId]),
    ]);
    return {
        items,
        total: parseInt(counts?.total ?? '0'),
        noLeidas: parseInt(counts?.no_leidas ?? '0'),
    };
}
async function marcarLeida(notifId, usuarioId) {
    const row = await (0, database_1.queryOne)(`UPDATE notificaciones
     SET leida=TRUE, leida_en=NOW()
     WHERE id=$1 AND usuario_id=$2 AND leida=FALSE
     RETURNING id`, [notifId, usuarioId]);
    return !!row;
}
async function marcarTodasLeidas(usuarioId) {
    const rows = await (0, database_1.query)(`UPDATE notificaciones
     SET leida=TRUE, leida_en=NOW()
     WHERE usuario_id=$1 AND leida=FALSE
     RETURNING id`, [usuarioId]);
    return rows.length;
}
async function getSetPreferencias(usuarioId, update) {
    if (update) {
        const campos = Object.entries(update)
            .map(([k], i) => `${k}=$${i + 2}`)
            .join(', ');
        await (0, database_1.query)(`INSERT INTO notif_preferencias (usuario_id, ${Object.keys(update).join(', ')}, actualizado_en)
       VALUES ($1, ${Object.keys(update).map((_, i) => `$${i + 2}`).join(', ')}, NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET ${campos}, actualizado_en=NOW()`, [usuarioId, ...Object.values(update)]);
    }
    return getPreferencias(usuarioId);
}
async function registrarFCMToken(usuarioId, fcmToken) {
    await (0, database_1.query)(`INSERT INTO notif_preferencias (usuario_id, fcm_token, actualizado_en)
     VALUES ($1, $2, NOW())
     ON CONFLICT (usuario_id) DO UPDATE SET fcm_token=$2, actualizado_en=NOW()`, [usuarioId, fcmToken]);
}
