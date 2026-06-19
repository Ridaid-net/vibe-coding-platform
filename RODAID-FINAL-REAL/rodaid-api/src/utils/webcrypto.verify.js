"use strict";
// ─── RODAID · Verificación de Firma CIT en el Cliente ────
// Snippet listo para usar en el frontend (React, Vue, Next.js)
// o en un Service Worker.
//
// NO necesita librerías externas — usa la Web Crypto API
// nativa del browser (disponible en todos los browsers modernos).
//
// Algoritmo: RSA-PSS con SHA-256, saltLength=32 bytes
//   · El mismo que firma el servidor con node-forge
//   · Compatible con openssl dgst -sha256 -sigopt rsa_padding_mode:pss
//
// Uso:
//   const ok = await verificarFirmaCIT({
//     numeroCIT: 'RCIT-2026-001',
//     baseUrl: 'https://api.rodaid.com.ar/api/v1',
//   })
//   if (ok.valida) { mostrarBadge('✅ Firma válida') }
//
// Verificación de múltiples CITs en paralelo:
//   const resultados = await verificarLoteCITs(['RCIT-001', 'RCIT-002'])
//
// Verificación offline (con datos ya descargados):
//   const ok = await verificarFirmaOffline({ firmaBase64url, payloadJson, spkiBase64 })
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificarFirmaCIT = verificarFirmaCIT;
exports.verificarFirmaOffline = verificarFirmaOffline;
exports.verificarFirmaConJWK = verificarFirmaConJWK;
exports.verificarLoteCITs = verificarLoteCITs;
exports.cargarClavePublica = cargarClavePublica;
exports.verificarConClavePreCargada = verificarConClavePreCargada;
// ══════════════════════════════════════════════════════════
// 1. VERIFICACIÓN VÍA SERVIDOR (recomendada en apps)
// ══════════════════════════════════════════════════════════
/**
 * Obtiene y verifica la firma de un CIT consultando el servidor.
 * El servidor hace la verificación RSA-PSS en Node.js y devuelve el resultado.
 *
 * Ideal para: páginas de detalle de CIT, apps móviles, verificación pública.
 */
async function verificarFirmaCIT(opts) {
    const base = opts.baseUrl ?? 'https://api.rodaid.com.ar/api/v1';
    // Obtener firma del servidor
    const url = opts.citId
        ? `${base}/firma/cit/${opts.citId}`
        : `${base}/firma/verificar?numeroCIT=${opts.numeroCIT}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        if (resp.status === 404)
            return { valida: false, revocada: false, error: 'CIT sin firma registrada', fuente: 'servidor' };
        return { valida: false, revocada: false, error: `HTTP ${resp.status}`, fuente: 'servidor' };
    }
    const data = (await resp.json());
    if (data.data.revocada) {
        return { valida: false, revocada: true, firmadoEn: data.data.firmado_en, fuente: 'servidor' };
    }
    // Verificar la firma localmente con Web Crypto API (doble verificación)
    const verif = await verificarFirmaOffline({
        firmaBase64url: data.data.firma_base64url,
        payloadJson: data.data.payload_json,
        certPEM: data.data.cert_pem,
    });
    return {
        valida: verif.valida,
        revocada: false,
        firmadoEn: data.data.firmado_en,
        validaHasta: data.data.valida_hasta,
        certSerial: data.data.cert_serial,
        payload: verif.payload,
        error: verif.error,
        fuente: 'servidor',
    };
}
// ══════════════════════════════════════════════════════════
// 2. VERIFICACIÓN OFFLINE (solo Web Crypto API)
// ══════════════════════════════════════════════════════════
/**
 * Verifica una firma RSA-PSS-SHA256 completamente en el browser.
 * No requiere conexión a internet una vez que se tienen los datos.
 *
 * Ideal para: verificación de CITs guardados offline, kioscos, etc.
 *
 * @param opts.firmaBase64url  La firma en base64url (del campo firma_base64url en DB)
 * @param opts.payloadJson     El payload canónico firmado (el JSON exacto que se firmó)
 * @param opts.spkiBase64      Clave pública SPKI en Base64 (de GET /firma/clave-publica)
 * @param opts.certPEM         Alternativa: certificado PEM completo
 */
async function verificarFirmaOffline(opts) {
    try {
        // 1. Convertir firma de base64url a ArrayBuffer
        const firmaBytes = base64urlToArrayBuffer(opts.firmaBase64url);
        // 2. Encodear el payload como UTF-8 bytes
        const payloadBytes = new TextEncoder().encode(opts.payloadJson);
        // 3. Obtener la clave pública
        let pubKey;
        if (opts.spkiBase64) {
            // Importar desde SPKI DER (lo que devuelve /firma/clave-publica)
            const spkiBytes = base64ToArrayBuffer(opts.spkiBase64);
            pubKey = await crypto.subtle.importKey('spki', spkiBytes, {
                name: 'RSA-PSS',
                hash: 'SHA-256',
            }, false, // no extractable
            ['verify']);
        }
        else if (opts.certPEM) {
            // Extraer la clave pública del PEM del certificado
            const spkiBase64 = extractPublicKeyFromCertPEM(opts.certPEM);
            const spkiBytes = base64ToArrayBuffer(spkiBase64);
            pubKey = await crypto.subtle.importKey('spki', spkiBytes, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['verify']);
        }
        else {
            return { valida: false, fuente: 'offline', error: 'Se requiere spkiBase64 o certPEM' };
        }
        // 4. Verificar con Web Crypto API
        //    saltLength debe coincidir con el servidor (RSA_PSS_SALTLEN_DIGEST = 32 para SHA-256)
        const valida = await crypto.subtle.verify({
            name: 'RSA-PSS',
            saltLength: 32,
        }, pubKey, firmaBytes, payloadBytes);
        // 5. Parsear el payload si la firma es válida
        let payload;
        if (valida) {
            try {
                payload = JSON.parse(opts.payloadJson);
            }
            catch { /* ignorar */ }
        }
        return { valida, payload, fuente: 'offline' };
    }
    catch (err) {
        return { valida: false, fuente: 'offline', error: err.message };
    }
}
// ══════════════════════════════════════════════════════════
// 3. VERIFICAR CON JWK (JSON Web Key)
// ══════════════════════════════════════════════════════════
/**
 * Alternativa usando JWK — más simple si ya tenés la clave en formato JWK.
 * La API devuelve el JWK en GET /firma/clave-publica { data.jwk }
 */
async function verificarFirmaConJWK(opts) {
    const pubKey = await crypto.subtle.importKey('jwk', opts.jwk, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'RSA-PSS', saltLength: 32 }, pubKey, base64urlToArrayBuffer(opts.firmaBase64url), new TextEncoder().encode(opts.payloadJson));
}
// ══════════════════════════════════════════════════════════
// 4. VERIFICACIÓN EN LOTE (múltiples CITs)
// ══════════════════════════════════════════════════════════
async function verificarLoteCITs(citIds, baseUrl) {
    const resultados = await Promise.allSettled(citIds.map(citId => verificarFirmaCIT({ citId, baseUrl })));
    const out = {};
    citIds.forEach((id, i) => {
        const r = resultados[i];
        out[id] = r.status === 'fulfilled'
            ? r.value
            : { valida: false, revocada: false, error: r.reason.message, fuente: 'servidor' };
    });
    return out;
}
// ══════════════════════════════════════════════════════════
// 5. CACHÉ DE CLAVE PÚBLICA (evitar fetch repetidos)
// ══════════════════════════════════════════════════════════
let _clavePublicaCacheada = null;
/**
 * Obtiene la clave pública del servidor y la cachea en memoria.
 * Llamar una sola vez al iniciar la app.
 */
async function cargarClavePublica(baseUrl = 'https://api.rodaid.com.ar/api/v1') {
    if (_clavePublicaCacheada)
        return _clavePublicaCacheada;
    const resp = await fetch(`${baseUrl}/firma/clave-publica`);
    const data = (await resp.json());
    const spkiBytes = base64ToArrayBuffer(data.data.spkiBase64);
    _clavePublicaCacheada = await crypto.subtle.importKey('spki', spkiBytes, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['verify']);
    return _clavePublicaCacheada;
}
/**
 * Verificar usando la clave pre-cargada (ultra-rápido — sin red).
 */
async function verificarConClavePreCargada(opts) {
    return crypto.subtle.verify({ name: 'RSA-PSS', saltLength: 32 }, opts.pubKey, base64urlToArrayBuffer(opts.firmaBase64url), new TextEncoder().encode(opts.payloadJson));
}
// ══════════════════════════════════════════════════════════
// HELPERS INTERNOS
// ══════════════════════════════════════════════════════════
function base64urlToArrayBuffer(b64url) {
    // base64url → base64 standard
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        buf[i] = bin.charCodeAt(i);
    return buf.buffer;
}
function base64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        buf[i] = bin.charCodeAt(i);
    return buf.buffer;
}
/**
 * Extrae la clave pública SPKI de un certificado X.509 en PEM.
 * Funciona para certificados RSA estándar.
 */
function extractPublicKeyFromCertPEM(certPEM) {
    // Un certificado X.509 DER tiene la clave pública en un campo estándar.
    // Para simplificar el browser snippet, usamos el enfoque de parseo básico.
    // En producción: usar una librería como forge o pkijs en el browser si se necesita
    // soporte amplio de formatos de certificados.
    // Strip PEM headers and get DER bytes
    const b64 = certPEM
        .replace('-----BEGIN CERTIFICATE-----', '')
        .replace('-----END CERTIFICATE-----', '')
        .replace(/\s/g, '');
    const derBytes = atob(b64);
    const der = new Uint8Array(derBytes.length);
    for (let i = 0; i < derBytes.length; i++)
        der[i] = derBytes.charCodeAt(i);
    // Parse ASN.1 DER: Certificate → TBSCertificate → SubjectPublicKeyInfo
    // Structure: SEQUENCE { SEQUENCE { ... subjectPublicKeyInfo SEQUENCE ... } ... }
    // This is a simplified parser for standard RSA certificates
    const spki = extractSPKIFromCertDER(der);
    if (!spki)
        throw new Error('No se pudo extraer la clave pública del certificado');
    // Convert to base64
    let b64out = '';
    const chunk = 48;
    for (let i = 0; i < spki.length; i += chunk) {
        const slice = spki.slice(i, i + chunk);
        b64out += btoa(String.fromCharCode(...slice));
    }
    return b64out;
}
function extractSPKIFromCertDER(der) {
    // ASN.1 DER parser para extraer SubjectPublicKeyInfo
    // Certificate SEQUENCE
    let pos = 0;
    if (der[pos++] !== 0x30)
        return null; // SEQUENCE
    pos = skipLength(der, pos).pos; // skip length
    // TBSCertificate SEQUENCE
    if (der[pos++] !== 0x30)
        return null;
    const tbs = skipLength(der, pos);
    pos = tbs.pos;
    // Skip version (CONTEXT [0] if present)
    if (der[pos] === 0xa0) {
        pos++;
        const l = skipLength(der, pos);
        pos = l.pos + l.len;
    }
    // Skip serialNumber INTEGER
    pos = skipTag(der, pos, 0x02);
    // Skip signature AlgorithmIdentifier SEQUENCE
    pos = skipTag(der, pos, 0x30);
    // Skip issuer Name SEQUENCE
    pos = skipTag(der, pos, 0x30);
    // Skip validity SEQUENCE
    pos = skipTag(der, pos, 0x30);
    // Skip subject Name SEQUENCE
    pos = skipTag(der, pos, 0x30);
    // Now we should be at SubjectPublicKeyInfo SEQUENCE
    if (der[pos] !== 0x30)
        return null;
    const spkiStart = pos;
    pos++;
    const lenInfo = skipLength(der, pos);
    const spkiEnd = lenInfo.pos + lenInfo.len;
    return der.slice(spkiStart, spkiEnd);
}
function skipLength(der, pos) {
    if (der[pos] < 0x80)
        return { pos: pos + 1, len: der[pos] };
    const numBytes = der[pos] & 0x7f;
    pos++;
    let len = 0;
    for (let i = 0; i < numBytes; i++)
        len = (len << 8) | der[pos++];
    return { pos, len };
}
function skipTag(der, pos, expectedTag) {
    if (der[pos] !== expectedTag)
        throw new Error(`Expected tag 0x${expectedTag.toString(16)} at pos ${pos}, got 0x${der[pos].toString(16)}`);
    pos++;
    const { pos: newPos, len } = skipLength(der, pos);
    return newPos + len;
}
