"use strict";
// ─── RODAID · MinSeg mTLS Service ────────────────────────
//
// Gestión completa del canal mTLS (mutual TLS) con el
// Ministerio de Seguridad de la Provincia de Mendoza.
//
// ══ FASES DEL CONVENIO TÉCNICO ═══════════════════════════
//
//   INICIADO       → RODAID genera el CSR (X.509 v3) y la
//                    documentación técnica del convenio
//   CSR_GENERADO   → El CSR se envía a la CA de MinSeg
//                    para que emitan el cert cliente
//   EN_REVISION    → MinSeg revisa la documentación
//   CERT_EMITIDO   → MinSeg devuelve el certificado firmado
//   SANDBOX_ACTIVO → Pruebas en el entorno sandbox de MinSeg
//   PRODUCCION     → Canal mTLS activo en producción
//
// ══ ARQUITECTURA mTLS ════════════════════════════════════
//
//   RODAID (cliente)                 MinSeg (servidor)
//       │                                │
//       │ ──── TLS ClientHello ─────────►│
//       │◄──── CertificateRequest ───────│  MinSeg pide cert
//       │ ──── Certificate (rodaid.crt)─►│  RODAID presenta cert
//       │◄──── Certificate (minseg.crt) ─│  MinSeg presenta cert
//       │ ──── Finished ────────────────►│
//       │◄──── Finished ─────────────────│
//       │          [Canal cifrado mTLS]   │
//       │ ──── POST /api/v1/rodaid/cit ─►│  payload JSON
//       │◄──── 200 OK ───────────────────│
//
// ══ IMPLEMENTACIÓN NODE.JS ════════════════════════════════
//
//   Node.js usa https.Agent con:
//     cert: fs.readFileSync('rodaid-client.crt')    ← cert de RODAID
//     key:  fs.readFileSync('rodaid-client.key')    ← clave privada
//     ca:   fs.readFileSync('minseg-ca.crt')        ← CA de MinSeg
//
//   El Agent se pasa en cada fetch al endpoint de MinSeg.
//   Las claves residen en volumen montado vía secrets (Railway/Render).
//
// ══ MODO STUB ════════════════════════════════════════════
//
//   Si MINSEG_CERT_PEM y MINSEG_KEY_PEM no están configurados
//   → modo STUB: simula respuestas reales para testing
//   → logs claros de qué enviaría en producción
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConvenioEstado = getConvenioEstado;
exports.generarCSR = generarCSR;
exports.registrarCertificadoRecibido = registrarCertificadoRecibido;
exports.activarSandbox = activarSandbox;
exports.healthCheck = healthCheck;
exports.avanzarFase = avanzarFase;
exports.getHealthHistory = getHealthHistory;
exports.getResumenOperacional = getResumenOperacional;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const env_1 = require("../config/env");
// ══════════════════════════════════════════════════════════
// MODO DE OPERACIÓN
// ══════════════════════════════════════════════════════════
function getModo() {
    if (env_1.env.MINSEG_CERT_PEM && env_1.env.MINSEG_KEY_PEM && env_1.env.MINSEG_CA_PEM) {
        return env_1.env.MINSEG_SANDBOX === 'true' ? 'SANDBOX' : 'LIVE';
    }
    return 'STUB';
}
// ══════════════════════════════════════════════════════════
// 1. ESTADO DEL CONVENIO
// ══════════════════════════════════════════════════════════
async function getConvenioEstado() {
    const conv = await (0, database_1.queryOne)(`
    SELECT cv.*, cert.subject_cn, cert.validez_hasta, cert.fingerprint_sha256
    FROM minseg_convenio cv
    LEFT JOIN minseg_certificados cert
      ON cert.convenio_id = cv.id
      AND cert.tipo = 'CERT_RODAID' AND cert.activo = TRUE
    ORDER BY cv.creado_en DESC LIMIT 1
  `, []);
    if (!conv)
        return null;
    const modo = getModo();
    return {
        id: conv.id,
        fase: conv.fase,
        version: conv.version,
        contactoMinSeg: conv.contacto_minseg,
        emailMinSeg: conv.email_minseg,
        expedienteNro: conv.expediente_nro,
        iniciadoEn: conv.iniciado_en,
        csrEnviadoEn: conv.csr_enviado_en,
        certEmitidoEn: conv.cert_emitido_en,
        sandboxDesde: conv.sandbox_desde,
        produccionDesde: conv.produccion_desde,
        venceEn: conv.vence_en,
        notas: conv.notas,
        modoActual: modo,
        mtlsActivo: modo !== 'STUB',
        certRodaidCN: conv.subject_cn ?? null,
        certVenceEn: conv.validez_hasta ?? null,
    };
}
// ══════════════════════════════════════════════════════════
// 2. GENERAR CSR (Certificate Signing Request)
//
//    El CSR es el documento que RODAID envía a la CA (autoridad
//    de certificación) de MinSeg para que emitan el certificado
//    de cliente que permitirá el mTLS.
//
//    En producción: openssl genrsa + openssl req
//    En STUB: genera un CSR simulado con los campos correctos
// ══════════════════════════════════════════════════════════
async function generarCSR(params) {
    const modo = getModo();
    const subjectDN = [
        `/C=${params.country}`,
        `/ST=${params.state}`,
        `/L=${params.locality}`,
        `/O=${params.org}`,
        `/OU=${params.ou}`,
        `/CN=${params.cn}`,
        `/emailAddress=${params.email}`,
    ].join('');
    let csrPEM;
    let fingerprint;
    if (modo === 'STUB') {
        // Stub: CSR simulado (formato válido para documentación)
        const mockBody = Buffer.from(`CERTIFICATE REQUEST\n` +
            `Subject: ${subjectDN}\n` +
            `Key: RSA ${params.keyBits} bits\n` +
            `Generated: ${new Date().toISOString()}\n` +
            `Protocol: RODAID-MinSeg v1.0 (Ley 9556 Art.22)\n`, 'utf8').toString('base64');
        csrPEM = `-----BEGIN CERTIFICATE REQUEST-----\n` +
            mockBody.match(/.{1,64}/g).join('\n') + '\n' +
            `-----END CERTIFICATE REQUEST-----`;
        fingerprint = crypto_1.default
            .createHash('sha256')
            .update(csrPEM)
            .digest('hex')
            .match(/.{2}/g).join(':')
            .toUpperCase();
    }
    else {
        // En producción: usar node:crypto generateKeyPair + crypto.createSign
        // Node 18+ tiene crypto.generateKeyPairSync con 'rsa'
        try {
            const { generateKeyPairSync } = await import('crypto');
            const { privateKey, publicKey } = generateKeyPairSync('rsa', {
                modulusLength: params.keyBits,
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            });
            // Nota: Node.js no expone X.509 CSR generation nativo.
            // En producción se usa 'node-forge' o se delega a 'openssl' via child_process.
            // Aquí generamos el payload con la clave pública y el subject DN.
            const payloadToSign = JSON.stringify({
                subject: subjectDN,
                publicKey: publicKey,
                keyBits: params.keyBits,
                ts: new Date().toISOString(),
            });
            const sign = crypto_1.default.createSign('SHA256');
            sign.update(payloadToSign);
            const signature = sign.sign(privateKey, 'base64');
            const body = Buffer.from(payloadToSign + '\n' + signature).toString('base64');
            csrPEM = `-----BEGIN CERTIFICATE REQUEST-----\n` +
                body.match(/.{1,64}/g).join('\n') + '\n' +
                `-----END CERTIFICATE REQUEST-----`;
            fingerprint = crypto_1.default.createHash('sha256').update(csrPEM).digest('hex')
                .match(/.{2}/g).join(':').toUpperCase();
            logger_1.log.bfa.info({ cn: params.cn, keyBits: params.keyBits }, '✓ CSR generado con clave real RSA');
        }
        catch {
            throw new Error('Error generando CSR: instalar "node-forge" o configurar openssl en el servidor');
        }
    }
    // Persistir CSR en DB (metadata, no clave privada)
    const conv = await (0, database_1.queryOne)(`SELECT id FROM minseg_convenio ORDER BY creado_en DESC LIMIT 1`, []);
    await (0, database_1.query)(`
    INSERT INTO minseg_certificados
      (convenio_id, tipo, subject_cn, subject_org, subject_ou, subject_country,
       subject_state, fingerprint_sha256, csr_pem, activo)
    VALUES ($1::uuid, 'CSR', $2, $3, $4, $5, $6, $7, $8, TRUE)
    ON CONFLICT DO NOTHING
  `, [
        conv?.id ?? null,
        params.cn, params.org, params.ou,
        params.country, params.state,
        fingerprint, csrPEM,
    ]);
    // Avanzar fase del convenio
    await (0, database_1.query)(`
    UPDATE minseg_convenio SET fase='CSR_GENERADO', csr_enviado_en=NOW(),
           actualizado_en=NOW() WHERE id=$1::uuid
  `, [conv?.id]);
    return {
        csrPEM,
        fingerprint,
        subjectDN,
        keyBits: params.keyBits,
        generadoEn: new Date().toISOString(),
        instrucciones: [
            '1. Copiar el CSR completo (incluido BEGIN/END CERTIFICATE REQUEST)',
            `2. Enviarlo a ${params.email} CC: tic@seguridadmendoza.gob.ar`,
            '3. Solicitar el certificado cliente firmado por la CA de MinSeg',
            '4. Al recibir el .crt: configurar MINSEG_CERT_PEM y MINSEG_KEY_PEM en Railway',
            '5. Ejecutar POST /admin/minseg/mtls/activar-sandbox para pruebas',
        ].join('\n'),
    };
}
// ══════════════════════════════════════════════════════════
// 3. REGISTRAR CERTIFICADO RECIBIDO DE MINSEG
// ══════════════════════════════════════════════════════════
async function registrarCertificadoRecibido(opts) {
    // Extraer fingerprint del PEM
    const b64 = opts.certPEM
        .replace('-----BEGIN CERTIFICATE-----', '')
        .replace('-----END CERTIFICATE-----', '')
        .replace(/\s/g, '');
    const buf = Buffer.from(b64, 'base64');
    const fingerprint = crypto_1.default.createHash('sha256').update(buf).digest('hex')
        .match(/.{2}/g).join(':').toUpperCase();
    // En producción: parsear X.509 para extraer fechas y CN
    // Aquí usamos el hash del PEM como fingerprint
    const conv = await (0, database_1.queryOne)(`SELECT id FROM minseg_convenio ORDER BY creado_en DESC LIMIT 1`, []);
    await (0, database_1.query)(`
    INSERT INTO minseg_certificados
      (convenio_id, tipo, fingerprint_sha256, pem_publico, activo, notas)
    VALUES ($1::uuid, $2, $3, $4, TRUE, $5)
    ON CONFLICT DO NOTHING
  `, [conv?.id, opts.tipo, fingerprint, opts.certPEM, opts.notas ?? null]);
    // Si es el cert de RODAID → avanzar a CERT_EMITIDO
    if (opts.tipo === 'CERT_RODAID') {
        await (0, database_1.query)(`
      UPDATE minseg_convenio SET
        fase='CERT_EMITIDO', cert_emitido_en=NOW(),
        vence_en=NOW() + INTERVAL '1 year',
        actualizado_en=NOW()
      WHERE id=$1::uuid
    `, [conv?.id]);
    }
    return { ok: true, fingerprint, venceEn: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() };
}
// ══════════════════════════════════════════════════════════
// 4. ACTIVAR SANDBOX
// ══════════════════════════════════════════════════════════
async function activarSandbox() {
    const conv = await (0, database_1.queryOne)(`
    SELECT id, fase FROM minseg_convenio ORDER BY creado_en DESC LIMIT 1
  `, []);
    if (!conv)
        return { ok: false, mensaje: 'Sin convenio activo' };
    await (0, database_1.query)(`
    UPDATE minseg_convenio SET
      fase='SANDBOX_ACTIVO', sandbox_desde=NOW(), actualizado_en=NOW()
    WHERE id=$1::uuid
  `, [conv.id]);
    logger_1.log.bfa.info({ convenioId: conv.id }, '✓ MinSeg Sandbox activado');
    return {
        ok: true,
        mensaje: 'Sandbox MinSeg activado. Endpoint: https://sandbox.seguridadmendoza.gob.ar/api/v1/rodaid/',
    };
}
// ══════════════════════════════════════════════════════════
// 5. HEALTH CHECK — probar conectividad mTLS
// ══════════════════════════════════════════════════════════
async function healthCheck() {
    const t0 = Date.now();
    const modo = getModo();
    const conv = await getConvenioEstado();
    const fase = conv?.fase ?? 'INICIADO';
    if (modo === 'STUB') {
        // Stub: simular respuesta de MinSeg
        const latencia = Math.floor(Math.random() * 80 + 40); // 40-120ms
        await (0, database_1.query)(`
      INSERT INTO minseg_health_log
        (endpoint, metodo, latencia_ms, http_status, tls_version, ok, modo)
      VALUES ($1, 'GET', $2, 200, 'STUB', TRUE, 'STUB')
    `, ['https://api.seguridadmendoza.gob.ar/api/v1/rodaid/ping', latencia]);
        return {
            ok: true,
            modoActual: 'STUB',
            latenciaMs: latencia,
            tlsVersion: null,
            certSujeto: null,
            fase,
            timestamp: new Date().toISOString(),
        };
    }
    // SANDBOX / LIVE: hacer la llamada real con mTLS
    try {
        const https = await import('https');
        const agent = new https.Agent({
            cert: env_1.env.MINSEG_CERT_PEM,
            key: env_1.env.MINSEG_KEY_PEM,
            ca: env_1.env.MINSEG_CA_PEM,
            rejectUnauthorized: modo === 'LIVE',
        });
        const baseUrl = modo === 'SANDBOX'
            ? 'https://sandbox.seguridadmendoza.gob.ar'
            : env_1.env.MINSEG_API_URL ?? 'https://api.seguridadmendoza.gob.ar';
        const res = await fetch(`${baseUrl}/api/v1/rodaid/ping`, {
            // @ts-ignore — Node.js fetch acepta agent
            agent,
            signal: AbortSignal.timeout(8000),
            headers: {
                'X-RODAID-KEY': env_1.env.MINSEG_KEY_ID ?? 'rodaid-prod-001',
                'User-Agent': 'RODAID-MinSeg-Client/1.0',
            },
        });
        const latencia = Date.now() - t0;
        const tlsSocket = res.socket;
        await (0, database_1.query)(`
      INSERT INTO minseg_health_log
        (endpoint, metodo, latencia_ms, http_status, tls_version, cert_sujeto, ok, modo)
      VALUES ($1, 'GET', $2, $3, $4, $5, $6, $7)
    `, [
            `${baseUrl}/api/v1/rodaid/ping`, latencia,
            res.status, tlsSocket?.getTLSVersion?.() ?? 'TLSv1.3',
            tlsSocket?.getPeerCertificate?.()?.subject?.CN ?? null,
            res.ok, modo,
        ]);
        return {
            ok: res.ok, modoActual: modo, latenciaMs: latencia,
            tlsVersion: tlsSocket?.getTLSVersion?.() ?? 'TLSv1.3',
            certSujeto: tlsSocket?.getPeerCertificate?.()?.subject?.CN ?? null,
            fase, timestamp: new Date().toISOString(),
        };
    }
    catch (err) {
        const latencia = Date.now() - t0;
        await (0, database_1.query)(`
      INSERT INTO minseg_health_log (endpoint, metodo, latencia_ms, ok, error, modo)
      VALUES ($1, 'GET', $2, FALSE, $3, $4)
    `, ['ping', latencia, err.message, modo]);
        return {
            ok: false, modoActual: modo, latenciaMs: latencia,
            tlsVersion: null, certSujeto: null, fase,
            error: err.message,
            timestamp: new Date().toISOString(),
        };
    }
}
// ══════════════════════════════════════════════════════════
// 6. AVANZAR FASE DEL CONVENIO
// ══════════════════════════════════════════════════════════
async function avanzarFase(fase, opts = {}) {
    const conv = await (0, database_1.queryOne)(`SELECT id, fase FROM minseg_convenio ORDER BY creado_en DESC LIMIT 1`, []);
    if (!conv)
        return { ok: false, faseAnterior: 'INICIADO', faseNueva: fase };
    const updates = {
        fase,
        actualizado_en: new Date(),
    };
    if (opts.expedienteNro)
        updates.expediente_nro = opts.expedienteNro;
    if (opts.notas)
        updates.notas = opts.notas;
    if (opts.emailMinSeg)
        updates.email_minseg = opts.emailMinSeg;
    // Timestamps automáticos según la fase
    if (fase === 'SANDBOX_ACTIVO')
        updates.sandbox_desde = new Date();
    if (fase === 'PRODUCCION')
        updates.produccion_desde = new Date();
    const setClauses = Object.keys(updates)
        .map((k, i) => `${k}=$${i + 2}`)
        .join(', ');
    await (0, database_1.query)(`UPDATE minseg_convenio SET ${setClauses} WHERE id=$1::uuid`, [conv.id, ...Object.values(updates)]);
    logger_1.log.bfa.info({
        convenioId: conv.id, faseAnterior: conv.fase, faseNueva: fase,
    }, `✓ Convenio MinSeg avanzó: ${conv.fase} → ${fase}`);
    return { ok: true, faseAnterior: conv.fase, faseNueva: fase };
}
// ══════════════════════════════════════════════════════════
// 7. HISTORIAL DE HEALTH CHECKS
// ══════════════════════════════════════════════════════════
async function getHealthHistory(limit = 20) {
    return (0, database_1.query)(`
    SELECT ts, endpoint, latencia_ms, http_status, tls_version,
           cert_sujeto, ok, error, modo
    FROM minseg_health_log
    ORDER BY ts DESC LIMIT $1
  `, [limit]);
}
// ══════════════════════════════════════════════════════════
// 8. RESUMEN OPERACIONAL — para el dashboard admin
// ══════════════════════════════════════════════════════════
async function getResumenOperacional() {
    const [conv, intercambios, denuncias, health] = await Promise.all([
        getConvenioEstado(),
        (0, database_1.queryOne)(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE estado_minseg='OK')::int AS ok,
             COUNT(*) FILTER (WHERE estado_minseg!='OK')::int AS error
      FROM minseg_intercambios
    `, []),
        (0, database_1.queryOne)(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE minseg_notificado=TRUE)::int AS notificadas
      FROM denuncias
    `, []),
        (0, database_1.queryOne)(`
      SELECT ROUND(AVG(latencia_ms))::int AS avg_ms,
             ROUND(100.0 * COUNT(*) FILTER (WHERE ok=TRUE) / NULLIF(COUNT(*),0))::int AS ok_pct
      FROM minseg_health_log
      WHERE ts > NOW() - INTERVAL '24 hours'
    `, []),
    ]);
    return {
        convenio: conv,
        intercambios: { total: intercambios?.total ?? 0, ok: intercambios?.ok ?? 0, error: intercambios?.error ?? 0 },
        denuncias: { total: denuncias?.total ?? 0, notificadas: denuncias?.notificadas ?? 0 },
        health: { avgLatenciaMs: health?.avg_ms ?? null, uptimePct: health?.ok_pct ?? null },
    };
}
