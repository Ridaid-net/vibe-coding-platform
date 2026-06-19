"use strict";
// ─── RODAID · Firma Digital — PKCS#7 Detached Signature ──
// RFC 5652 CMS SignedData · SHA-256 · RSA-PKCS1v15 2048 bits
//
// Estrategia correcta para PKCS#7 detached con node-forge:
//   1. Firmar CON el contenido (forge computa SHA-256 del PDF)
//   2. Convertir a ASN.1 → extraer eContent del encapContentInfo
//   3. Persistir DER "sin contenido" (detached, ~2-4 KB)
//
// Verificación (2 pasos independientes):
//   a. Integridad: SHA-256(PDF) == messageDigest en atributos firmados
//   b. Autenticidad: RSA.verify(sha256(authAttributes), signature, pubKey)
//
// Equivalente OpenSSL:
//   openssl cms -verify -in firma.p7s -inform DER \
//     -content original.pdf -noverify -out /dev/null
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.obtenerParLlaves = obtenerParLlaves;
exports.invalidarCacheLlaves = invalidarCacheLlaves;
exports.firmarPDF = firmarPDF;
exports.verificarFirmaPDF = verificarFirmaPDF;
exports.getFirmaCIT = getFirmaCIT;
exports.getInfoCertActivo = getInfoCertActivo;
exports.rotarLlaves = rotarLlaves;
exports.revocarFirma = revocarFirma;
exports.cargarP12 = cargarP12;
exports.construirPayloadCIT = construirPayloadCIT;
exports.canonicalizarPayload = canonicalizarPayload;
exports.hashPayloadCIT = hashPayloadCIT;
exports.firmarPayloadCIT = firmarPayloadCIT;
exports.verificarFirmaPayload = verificarFirmaPayload;
exports.exportarClavePublicaWebCrypto = exportarClavePublicaWebCrypto;
exports.revocarFirmaPayload = revocarFirmaPayload;
exports.getHistorialFirmas = getHistorialFirmas;
const node_forge_1 = __importDefault(require("node-forge"));
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
const env_1 = require("../config/env");
// ══════════════════════════════════════════════════════════
// OIDs usados
// ══════════════════════════════════════════════════════════
const OID_MD = '1.2.840.113549.1.9.4'; // messageDigest
const OID_SIGN_TIME = '1.2.840.113549.1.9.5'; // signingTime
// ══════════════════════════════════════════════════════════
// GESTIÓN DEL PAR DE LLAVES RODAID
// ══════════════════════════════════════════════════════════
let _cache = null;
async function obtenerParLlaves() {
    if (_cache)
        return _cache;
    // 1. Desde env (producción)
    if (env_1.env.RODAID_FIRMA_CERT_PEM && env_1.env.RODAID_FIRMA_KEY_PEM) {
        try {
            const cert = node_forge_1.default.pki.certificateFromPem(env_1.env.RODAID_FIRMA_CERT_PEM);
            const key = node_forge_1.default.pki.privateKeyFromPem(env_1.env.RODAID_FIRMA_KEY_PEM);
            logger_1.log.firma.info({ source: 'env', serial: cert.serialNumber }, '🔑 Llaves cargadas desde env');
            _cache = { privateKey: key, certificate: cert };
            return _cache;
        }
        catch (err) {
            logger_1.log.firma.warn({ err: err.message }, 'Error cargando llaves env');
        }
    }
    // 2. Desde DB
    const fila = await (0, database_1.queryOne)(`SELECT cert_pem, clave_privada FROM rodaid_clave_firma WHERE activa=TRUE ORDER BY generada_en DESC LIMIT 1`, []);
    if (fila?.cert_pem && fila?.clave_privada) {
        try {
            const cert = node_forge_1.default.pki.certificateFromPem(fila.cert_pem);
            const key = node_forge_1.default.pki.privateKeyFromPem(fila.clave_privada);
            logger_1.log.firma.info({ source: 'db', serial: cert.serialNumber }, '🔑 Llaves cargadas desde DB');
            _cache = { privateKey: key, certificate: cert };
            return _cache;
        }
        catch (err) {
            logger_1.log.firma.warn({ err: err.message }, 'Error cargando llaves DB');
        }
    }
    // 3. Generar nuevo par
    logger_1.log.firma.info('🔑 Generando nuevo par RSA-2048...');
    const par = await _generarParLlaves();
    await _persistirParLlaves(par);
    _cache = par;
    return par;
}
function invalidarCacheLlaves() {
    _cache = null;
}
async function _generarParLlaves() {
    // Usar Node.js nativo (más rápido que forge.pki.rsa.generateKeyPair)
    const { privateKey: privPEM, publicKey: pubPEM } = crypto_1.default.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const privateKey = node_forge_1.default.pki.privateKeyFromPem(privPEM);
    const publicKey = node_forge_1.default.pki.publicKeyFromPem(pubPEM);
    const cert = node_forge_1.default.pki.createCertificate();
    cert.publicKey = publicKey;
    cert.serialNumber = crypto_1.default.randomBytes(16).toString('hex').toUpperCase();
    const now = new Date();
    const expiry = new Date(now);
    expiry.setFullYear(expiry.getFullYear() + 2);
    cert.validity.notBefore = now;
    cert.validity.notAfter = expiry;
    const attrs = [
        { name: 'commonName', value: 'RODAID PDF Signing Certificate' },
        { name: 'organizationName', value: 'RODAID' },
        { name: 'organizationalUnitName', value: 'Certificación de Bicicletas' },
        { name: 'countryName', value: 'AR' },
        { name: 'stateOrProvinceName', value: 'Mendoza' },
        { name: 'localityName', value: 'San Martín' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
        { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(privateKey, node_forge_1.default.md.sha256.create());
    logger_1.log.firma.info({ serial: cert.serialNumber, validaHasta: expiry.toISOString() }, '✓ Par RSA-2048 + certificado X.509 generado');
    return { privateKey, certificate: cert };
}
async function _persistirParLlaves({ privateKey, certificate }) {
    const certPEM = node_forge_1.default.pki.certificateToPem(certificate);
    const keyPEM = node_forge_1.default.pki.privateKeyToPem(privateKey);
    await (0, database_1.query)(`UPDATE rodaid_clave_firma SET activa=FALSE`, []);
    await (0, database_1.query)(`INSERT INTO rodaid_clave_firma (cert_serial,cert_pem,clave_privada,subject,valida_desde,valida_hasta,activa)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE)
     ON CONFLICT (cert_serial) DO UPDATE SET activa=TRUE`, [
        certificate.serialNumber,
        certPEM, keyPEM,
        certificate.subject.getField('CN')?.value ?? 'RODAID',
        certificate.validity.notBefore,
        certificate.validity.notAfter,
    ]);
}
// ══════════════════════════════════════════════════════════
// FIRMA PKCS#7 DETACHED
// ══════════════════════════════════════════════════════════
async function firmarPDF(pdfBuffer, citId, numeroCIT) {
    const t0 = Date.now();
    const { privateKey, certificate } = await obtenerParLlaves();
    const pdfHash = crypto_1.default.createHash('sha256').update(pdfBuffer).digest('hex');
    // Idempotencia
    const existente = await (0, database_1.queryOne)(`SELECT id, firma_hex, cert_serial, firmado_en, valida_hasta
     FROM firmas_pdf WHERE cit_id=$1 AND pdf_hash_sha256=$2 AND revocada=FALSE`, [citId, pdfHash]);
    if (existente) {
        logger_1.log.firma.info({ citId, id: existente.id }, '✓ Firma reutilizada (idempotente)');
        const derBuf = Buffer.from(existente.firma_hex, 'hex');
        return {
            firmaDER: derBuf,
            firmaHex: existente.firma_hex,
            firmaBase64: derBuf.toString('base64'),
            pdfHashSHA256: pdfHash,
            certSerial: existente.cert_serial,
            certSubject: certificate.subject.getField('CN')?.value ?? 'RODAID',
            firmadoEn: new Date(existente.firmado_en),
            validaHasta: new Date(existente.valida_hasta ?? certificate.validity.notAfter),
            firmaId: existente.id,
        };
    }
    // ── Construir PKCS#7 SignedData CON contenido ─────────────
    // forge calcula SHA-256 del PDF y lo pone en messageDigest
    const p7 = node_forge_1.default.pkcs7.createSignedData();
    p7.content = node_forge_1.default.util.createBuffer(pdfBuffer.toString('binary'));
    p7.addCertificate(certificate);
    p7.addSigner({
        key: node_forge_1.default.pki.privateKeyToPem(privateKey),
        certificate,
        digestAlgorithm: node_forge_1.default.pki.oids.sha256,
        authenticatedAttributes: [
            { type: node_forge_1.default.pki.oids.contentType, value: node_forge_1.default.pki.oids.data },
            { type: node_forge_1.default.pki.oids.signingTime }, // forge pone timestamp automático
            { type: node_forge_1.default.pki.oids.messageDigest }, // forge pone SHA-256 del content
        ],
    });
    p7.sign();
    // ── Convertir a ASN.1 y remover eContent → detached ───────
    const asn1 = p7.toAsn1();
    //
    // Estructura CMS (simplificada):
    //   ContentInfo SEQUENCE
    //     contentType OID (1.2.840.113549.1.7.2)
    //     [0] EXPLICIT
    //       SignedData SEQUENCE
    //         version
    //         digestAlgorithms
    //         encapContentInfo SEQUENCE ← aquí está el PDF
    //           eContentType OID
    //           [0] EXPLICIT eContent ← esto borramos
    //         certificates
    //         signerInfos
    //
    try {
        const signedDataNode = asn1.value[1].value[0]; // SignedData SEQUENCE
        const encapContentInfo = signedDataNode.value[2]; // encapContentInfo SEQUENCE
        if (Array.isArray(encapContentInfo.value) && encapContentInfo.value.length > 1) {
            encapContentInfo.value.splice(1, 1); // eliminar [0] EXPLICIT eContent
        }
    }
    catch (err) {
        logger_1.log.firma.warn({ err: err.message }, 'No se pudo hacer detached — eContent permanece');
    }
    // ── Serializar DER ────────────────────────────────────────
    const derBuf = Buffer.from(node_forge_1.default.asn1.toDer(asn1).getBytes(), 'binary');
    const firmaHex = derBuf.toString('hex');
    const ms = Date.now() - t0;
    const certSerial = certificate.serialNumber;
    const certSubject = certificate.subject.getField('CN')?.value ?? 'RODAID';
    const firmadoEn = new Date();
    const validaHasta = certificate.validity.notAfter;
    // ── Persistir en DB ───────────────────────────────────────
    const row = await (0, database_1.queryOne)(`INSERT INTO firmas_pdf
       (cit_id, pdf_hash_sha256, firma_der, firma_hex,
        cert_serial, cert_subject, cert_pem, firmado_en, valida_hasta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (cit_id, pdf_hash_sha256) DO UPDATE
       SET revocada=FALSE, firmado_en=EXCLUDED.firmado_en
     RETURNING id`, [citId, pdfHash, derBuf, firmaHex,
        certSerial, certSubject,
        node_forge_1.default.pki.certificateToPem(certificate),
        firmadoEn, validaHasta]);
    logger_1.log.firma.info({
        citId, numeroCIT, firmaId: row?.id,
        hash: pdfHash.slice(0, 16) + '...',
        bytes: derBuf.length, ms,
    }, `✓ PDF firmado PKCS#7 detached (${derBuf.length}B · ${ms}ms)`);
    return {
        firmaDER: derBuf,
        firmaHex,
        firmaBase64: derBuf.toString('base64'),
        pdfHashSHA256: pdfHash,
        certSerial,
        certSubject,
        firmadoEn,
        validaHasta,
        firmaId: row?.id ?? '',
    };
}
// ══════════════════════════════════════════════════════════
// VERIFICACIÓN — 2 checks independientes
// ══════════════════════════════════════════════════════════
async function verificarFirmaPDF(pdfBuffer, firmaDER) {
    const pdfHash = crypto_1.default.createHash('sha256').update(pdfBuffer).digest('hex');
    let hashEnFirma = null;
    let firmaRSA = false;
    let certSubject = null;
    let certSerial = null;
    let certVigente = null;
    let firmadoEn = null;
    try {
        // Parsear DER → ASN.1 → PKCS#7
        const asn1 = node_forge_1.default.asn1.fromDer(firmaDER.toString('binary'));
        const p7 = node_forge_1.default.pkcs7.messageFromAsn1(asn1);
        const rc = p7.rawCapture;
        // ── A. Integridad: extraer messageDigest de atributos firmados ──
        const attrs = rc.authenticatedAttributes ?? [];
        let authAttrsDER = null;
        for (const attr of attrs) {
            const oid = node_forge_1.default.asn1.derToOid(attr.value[0].value);
            if (oid === OID_MD) {
                hashEnFirma = Buffer.from(attr.value[1].value[0].value, 'binary').toString('hex');
            }
            if (oid === OID_SIGN_TIME) {
                try {
                    const stRaw = attr.value[1]?.value[0]?.value;
                    if (stRaw && typeof stRaw === 'string')
                        firmadoEn = new Date(stRaw);
                }
                catch { /* ignore */ }
            }
        }
        // DER del SET de atributos firmados (lo que firma RSA)
        const authAttrsAsn1 = node_forge_1.default.asn1.create(node_forge_1.default.asn1.Class.UNIVERSAL, node_forge_1.default.asn1.Type.SET, true, attrs);
        authAttrsDER = Buffer.from(node_forge_1.default.asn1.toDer(authAttrsAsn1).getBytes(), 'binary');
        // ── B. Autenticidad: verificar RSA con Node.js crypto ──────────
        const cert = p7.certificates?.[0];
        if (cert && authAttrsDER) {
            certSubject = cert.subject.getField('CN')?.value ?? null;
            certSerial = cert.serialNumber;
            const now = new Date();
            certVigente = cert.validity.notBefore <= now && cert.validity.notAfter >= now;
            const sigBytes = Buffer.from(rc.signature, 'binary');
            const certPEM = node_forge_1.default.pki.certificateToPem(cert);
            try {
                const verifier = crypto_1.default.createVerify('RSA-SHA256');
                verifier.update(authAttrsDER);
                firmaRSA = verifier.verify(certPEM, sigBytes);
            }
            catch {
                firmaRSA = false;
            }
        }
        const hashCoincide = hashEnFirma === pdfHash;
        const valida = hashCoincide && firmaRSA && certVigente !== false;
        return {
            valida,
            motivo: valida
                ? `Firma válida. PDF íntegro. Firmado por ${certSubject} · ${firmadoEn?.toLocaleString('es-AR') ?? 'N/D'}`
                : [
                    !hashCoincide ? 'El PDF fue modificado (hash no coincide).' : '',
                    !firmaRSA ? 'Firma RSA inválida.' : '',
                    certVigente === false ? 'Certificado expirado.' : '',
                ].filter(Boolean).join(' '),
            pdfHash, hashEnFirma, hashCoincide, firmaRSA,
            certSubject, certSerial, certVigente, firmadoEn,
        };
    }
    catch (err) {
        return {
            valida: false,
            motivo: `Error al parsear la firma: ${err.message}`,
            pdfHash, hashEnFirma, hashCoincide: false,
            firmaRSA, certSubject, certSerial, certVigente, firmadoEn,
        };
    }
}
// ══════════════════════════════════════════════════════════
// CONSULTAS / ADMIN
// ══════════════════════════════════════════════════════════
async function getFirmaCIT(citId) {
    return (0, database_1.queryOne)(`SELECT id, pdf_hash_sha256, firma_hex, firma_der,
            cert_serial, cert_subject, cert_pem, firmado_en, valida_hasta, revocada
     FROM firmas_pdf
     WHERE cit_id=$1 AND revocada=FALSE
     ORDER BY firmado_en DESC LIMIT 1`, [citId]);
}
async function getInfoCertActivo() {
    const { certificate } = await obtenerParLlaves();
    const now = new Date();
    return {
        serial: certificate.serialNumber,
        subject: certificate.subject.attributes.map((a) => `${a.shortName}=${a.value}`).join(', '),
        issuer: certificate.issuer.attributes.map((a) => `${a.shortName}=${a.value}`).join(', '),
        validDesde: certificate.validity.notBefore,
        validHasta: certificate.validity.notAfter,
        vigente: certificate.validity.notBefore <= now && certificate.validity.notAfter >= now,
        algoritmo: 'RSA-2048 SHA-256 (PKCS1v15)',
        pem: node_forge_1.default.pki.certificateToPem(certificate),
    };
}
async function rotarLlaves() {
    invalidarCacheLlaves();
    await (0, database_1.query)(`UPDATE rodaid_clave_firma SET activa=FALSE`, []);
    const par = await _generarParLlaves();
    await _persistirParLlaves(par);
    _cache = par;
    const info = await getInfoCertActivo();
    logger_1.log.firma.info({ serial: info?.serial }, '🔑 Llaves rotadas');
    return info;
}
async function revocarFirma(firmaId, motivo) {
    const row = await (0, database_1.queryOne)(`UPDATE firmas_pdf SET revocada=TRUE, revocada_en=NOW(), revocada_motivo=$2
     WHERE id=$1 AND revocada=FALSE RETURNING id`, [firmaId, motivo]);
    if (row)
        logger_1.log.firma.info({ firmaId, motivo }, '✓ Firma revocada');
    return !!row;
}
/**
 * Carga un archivo PKCS#12 y extrae el par de claves.
 * El .p12 puede estar en base64 o como Buffer.
 */
function cargarP12(p12Data, password) {
    const buf = typeof p12Data === 'string' ? Buffer.from(p12Data, 'base64') : p12Data;
    const thumbprint = crypto_1.default.createHash('sha256').update(buf).digest('hex');
    const p12Asn1 = node_forge_1.default.asn1.fromDer(node_forge_1.default.util.binary.raw.encode(new Uint8Array(buf)));
    const p12 = node_forge_1.default.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    // Extraer clave privada
    const keyBags = p12.getBags({ bagType: node_forge_1.default.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[node_forge_1.default.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    if (!keyBag?.key)
        throw new Error('No se encontró clave privada en el PKCS#12');
    const privateKey = keyBag.key;
    // Extraer certificado(s)
    const certBags = p12.getBags({ bagType: node_forge_1.default.pki.oids.certBag });
    const certs = certBags[node_forge_1.default.pki.oids.certBag]?.map(b => b.cert).filter(Boolean) ?? [];
    if (certs.length === 0)
        throw new Error('No se encontró certificado en el PKCS#12');
    // El primer certificado es el del firmante
    const [certificate, ...cadena] = certs;
    logger_1.log.firma.info({
        thumbprint: thumbprint.slice(0, 16),
        serial: certificate.serialNumber,
        subject: certificate.subject.getField('CN')?.value,
        validHasta: certificate.validity.notAfter.toISOString(),
    }, '🔑 PKCS#12 cargado exitosamente');
    const isCACert = certificate.extensions?.some((e) => e.name === 'basicConstraints' && e.cA === true) ?? false;
    return {
        privateKey, certificate, cadena, thumbprint,
        subject: certificate.subject.getField('CN')?.value ?? certificate.subject.getField('O')?.value ?? '',
        serial: certificate.serialNumber,
        validFrom: certificate.validity.notBefore,
        validTo: certificate.validity.notAfter,
        isCACert,
    };
}
/**
 * Construye el payload canónico del CIT para firmar.
 * El JSON se ordena lexicográficamente para garantizar
 * determinismo en múltiples plataformas.
 */
function construirPayloadCIT(data) {
    return {
        version: '1.0',
        leyReferencia: '9556',
        numeroCIT: data.numeroCIT,
        citId: data.citId,
        serial: data.serial,
        marca: data.marca,
        modelo: data.modelo,
        propietarioDNI: data.propietarioDNI,
        propietarioNombre: data.propietarioNombre,
        inspectorId: data.inspectorId,
        tallerAliadoId: data.tallerAliadoId,
        puntos: data.puntos,
        hashSHA256PDF: data.hashSHA256PDF,
        fechaEmision: data.fechaEmision,
    };
}
/**
 * Serialización canónica: ordenar claves lexicográficamente
 * para garantizar el mismo hash en cualquier runtime.
 */
function canonicalizarPayload(payload) {
    return JSON.stringify(payload, Object.keys(payload).sort());
}
/**
 * Calcular SHA-256 del payload canónico.
 */
function hashPayloadCIT(payload) {
    return crypto_1.default.createHash('sha256')
        .update(canonicalizarPayload(payload))
        .digest('hex');
}
/**
 * Firmar el payload JSON del CIT usando RSA-PSS-SHA256.
 *
 * RSA-PSS es más seguro que PKCS#1 v1.5 — es el algoritmo
 * recomendado para nuevas aplicaciones (RFC 8017).
 *
 * Parámetros PSS:
 *   hashAlgorithm: SHA-256
 *   saltLength:    32 bytes (igual al hash length)
 *   maskGenAlgorithm: MGF1-SHA256
 */
async function firmarPayloadCIT(opts) {
    // 1. Obtener par de llaves (P12 > env > DB > generado)
    let parLlaves;
    let p12Thumbprint;
    if (opts.p12Buffer) {
        const p12Info = cargarP12(opts.p12Buffer, opts.p12Password ?? '');
        parLlaves = { privateKey: p12Info.privateKey, certificate: p12Info.certificate };
        p12Thumbprint = p12Info.thumbprint;
        logger_1.log.firma.info({ thumbprint: p12Thumbprint.slice(0, 16) }, 'Usando P12 provisto para firma');
    }
    else {
        parLlaves = await obtenerParLlaves();
    }
    const { privateKey, certificate } = parLlaves;
    // 2. Canonicalizar y hashear el payload
    const canonical = canonicalizarPayload(opts.payload);
    const payloadHash = crypto_1.default.createHash('sha256').update(canonical).digest('hex');
    // 3. Idempotencia: no refirmar si ya existe firma válida
    const existente = await (0, database_1.queryOne)(`SELECT id, firma_base64url, payload_hash, cert_serial, cert_subject, cert_pem, firmado_en, valida_hasta
     FROM firmas_payload_cit
     WHERE cit_id=$1 AND payload_hash=$2 AND NOT revocada LIMIT 1`, [opts.citId, payloadHash]);
    if (existente) {
        logger_1.log.firma.debug({ citId: opts.citId, firmaId: existente.id }, 'Firma ya existe — retornando existente');
        return {
            firmaBase64url: existente.firma_base64url,
            payloadHash: existente.payload_hash,
            certSerial: existente.cert_serial,
            certSubject: existente.cert_subject,
            certPEM: existente.cert_pem,
            algoritmo: 'RSA-PSS-SHA256',
            firmadoEn: new Date(existente.firmado_en),
            validaHasta: new Date(existente.valida_hasta),
            firmaId: existente.id,
        };
    }
    // 4. Firmar con RSA-PSS-SHA256 (Node.js crypto nativo)
    //    Convertir clave forge a formato compatible con Node crypto
    const privPEM = node_forge_1.default.pki.privateKeyToPem(privateKey);
    const signer = crypto_1.default.createSign('SHA256');
    signer.update(canonical, 'utf8');
    const firmaBuf = signer.sign({
        key: privPEM,
        padding: crypto_1.default.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto_1.default.constants.RSA_PSS_SALTLEN_DIGEST, // 32 bytes
    });
    const firmaBase64url = firmaBuf.toString('base64url');
    // 5. Persistir
    const certPEM = node_forge_1.default.pki.certificateToPem(certificate);
    const validHasta = certificate.validity.notAfter;
    const row = await (0, database_1.queryOne)(`INSERT INTO firmas_payload_cit
       (cit_id, numero_cit, payload_json, payload_hash, firma_base64url,
        cert_serial, cert_subject, cert_pem, algoritmo,
        p12_thumbprint, firmado_en, valida_hasta, inspector_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11,$12)
     RETURNING id`, [
        opts.citId, opts.numeroCIT,
        canonical, // almacenar el JSON canónico exacto (TEXT, no JSONB) para auditoría
        payloadHash, firmaBase64url,
        certificate.serialNumber,
        certificate.subject.getField('CN')?.value ?? 'RODAID',
        certPEM, 'RSA-PSS-SHA256',
        p12Thumbprint ?? null,
        validHasta,
        opts.inspectorId ?? null,
    ]);
    // 6. Actualizar el CIT con referencia a la firma
    await (0, database_1.query)(`UPDATE cits SET firma_payload_id=$2, firma_payload_hash=$3 WHERE id=$1`, [opts.citId, row.id, payloadHash]);
    const certSubject = certificate.subject.getField('CN')?.value ?? 'RODAID';
    logger_1.log.firma.info({
        citId: opts.citId,
        numeroCIT: opts.numeroCIT,
        payloadHash: payloadHash.slice(0, 16),
        certSerial: certificate.serialNumber,
        algoritmo: 'RSA-PSS-SHA256',
        p12: p12Thumbprint ? 'P12' : 'INTERNAL',
    }, '✅ Payload CIT firmado');
    return {
        firmaBase64url,
        payloadHash,
        certSerial: certificate.serialNumber,
        certSubject,
        certPEM,
        p12Thumbprint,
        algoritmo: 'RSA-PSS-SHA256',
        firmadoEn: new Date(),
        validaHasta: validHasta,
        firmaId: row.id,
    };
}
/**
 * Verificar la firma del payload de un CIT.
 * Puede usarse con el citId (busca en DB) o con los datos crudos.
 */
async function verificarFirmaPayload(opts) {
    let payloadJSON = opts.payloadJSON ?? null;
    let firmaBase64url = opts.firmaBase64url ?? null;
    let certPEM = opts.certPEM ?? null;
    let firmadoEn = null;
    let certSerial = null;
    let certSubject = null;
    // Cargar desde DB si se pasa citId (y no se pasa firma explícita)
    if (opts.citId && !opts.firmaBase64url) {
        const fila = await (0, database_1.queryOne)(`SELECT payload_json, firma_base64url, cert_pem,
              cert_serial, cert_subject, firmado_en, valida_hasta, revocada
       FROM firmas_payload_cit WHERE cit_id=$1 ORDER BY firmado_en DESC LIMIT 1`, [opts.citId]);
        if (!fila)
            return {
                valida: false, revocada: false, motivo: 'Sin firma de payload para este CIT',
                payloadHash: '', hashCoincide: false, firmaRSA: false,
                certSerial: null, certSubject: null, certVigente: null, firmadoEn: null, algoritmo: 'N/A',
            };
        // Check revocation
        if (fila.revocada)
            return {
                valida: false, revocada: true, motivo: 'Firma revocada',
                payloadHash: '', hashCoincide: false, firmaRSA: false,
                certSerial: fila.cert_serial, certSubject: fila.cert_subject,
                certVigente: null, firmadoEn: new Date(fila.firmado_en), algoritmo: 'RSA-PSS-SHA256',
            };
        payloadJSON = fila.payload_json;
        firmaBase64url = fila.firma_base64url;
        certPEM = fila.cert_pem;
        certSerial = fila.cert_serial;
        certSubject = fila.cert_subject;
        firmadoEn = new Date(fila.firmado_en);
    }
    if (!payloadJSON || !firmaBase64url || !certPEM) {
        return {
            valida: false, revocada: false, motivo: 'Datos de verificación incompletos',
            payloadHash: '', hashCoincide: false, firmaRSA: false,
            certSerial, certSubject, certVigente: null, firmadoEn, algoritmo: 'RSA-PSS-SHA256',
        };
    }
    // Calcular hash del payload
    const payloadHash = crypto_1.default.createHash('sha256').update(payloadJSON, 'utf8').digest('hex');
    // Verificar firma RSA-PSS
    let firmaRSA = false;
    try {
        const verifier = crypto_1.default.createVerify('SHA256');
        verifier.update(payloadJSON, 'utf8');
        firmaRSA = verifier.verify({
            key: certPEM,
            padding: crypto_1.default.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto_1.default.constants.RSA_PSS_SALTLEN_DIGEST,
        }, Buffer.from(firmaBase64url, 'base64url'));
    }
    catch (err) {
        logger_1.log.firma.warn({ err: err.message }, 'Error verificando firma RSA-PSS');
    }
    // Verificar vigencia del certificado
    let certVigente = null;
    try {
        const cert = node_forge_1.default.pki.certificateFromPem(certPEM);
        const ahora = new Date();
        certVigente = ahora >= cert.validity.notBefore && ahora <= cert.validity.notAfter;
        if (!certSerial)
            certSerial = cert.serialNumber;
        if (!certSubject)
            certSubject = cert.subject.getField('CN')?.value ?? null;
    }
    catch { /* noop */ }
    const hashCoincide = true; // el hash está implícito en el JSON que verificamos
    const valida = firmaRSA && (certVigente !== false);
    const motivo = !firmaRSA ? 'Firma RSA-PSS inválida'
        : certVigente === false ? 'Certificado vencido'
            : '✅ Firma válida';
    let payloadDecoded = null;
    if (valida && payloadJSON) {
        try {
            payloadDecoded = JSON.parse(payloadJSON);
        }
        catch { /* noop */ }
    }
    return {
        valida, revocada: false, motivo, payloadHash, hashCoincide, firmaRSA,
        certSerial, certSubject, certVigente, firmadoEn, algoritmo: 'RSA-PSS-SHA256',
        payloadDecoded,
    };
}
// ══════════════════════════════════════════════════════════
// WEB CRYPTO API — Exportar para el cliente web
// ══════════════════════════════════════════════════════════
/**
 * Devuelve la clave pública en formato SPKI (SubjectPublicKeyInfo)
 * para que el cliente web pueda verificar firmas usando Web Crypto API.
 *
 * El cliente web puede importar con:
 *   const key = await crypto.subtle.importKey('spki', spkiDER, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['verify'])
 *   const ok  = await crypto.subtle.verify({ name: 'RSA-PSS', saltLength: 32 }, key, firma, datos)
 */
async function exportarClavePublicaWebCrypto() {
    const { privateKey, certificate } = await obtenerParLlaves();
    // Exportar clave pública como DER SPKI para Web Crypto API
    const pubKeyNode = crypto_1.default.createPublicKey(node_forge_1.default.pki.publicKeyToPem(certificate.publicKey));
    const spkiDER = pubKeyNode.export({ type: 'spki', format: 'der' });
    const spkiBase64 = spkiDER.toString('base64');
    // Exportar como JWK para alternativa
    const jwk = pubKeyNode.export({ format: 'jwk' });
    const certPEM = node_forge_1.default.pki.certificateToPem(certificate);
    return {
        spkiBase64,
        jwk,
        certPEM,
        certSerial: certificate.serialNumber,
        algorithm: 'RSA-PSS',
        hash: 'SHA-256',
        saltLength: 32,
    };
}
/**
 * Revocar la firma del payload de un CIT (p.ej. tras detección de fraude).
 */
async function revocarFirmaPayload(firmaId, motivo) {
    await (0, database_1.query)(`UPDATE firmas_payload_cit SET revocada=TRUE, revocada_en=NOW(), motivo_revocacion=$2 WHERE id=$1`, [firmaId, motivo]);
    logger_1.log.firma.warn({ firmaId, motivo }, '🔴 Firma de payload revocada');
}
/**
 * Listar firmas de un CIT (auditoría).
 */
async function getHistorialFirmas(citId) {
    return (0, database_1.query)(`SELECT id, numero_cit, payload_hash, cert_serial, cert_subject,
            algoritmo, p12_thumbprint, firmado_en, valida_hasta,
            revocada, revocada_en, motivo_revocacion
     FROM firmas_payload_cit WHERE cit_id=$1 ORDER BY firmado_en DESC`, [citId]);
}
