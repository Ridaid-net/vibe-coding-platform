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

import forge          from 'node-forge'
import crypto         from 'crypto'
import { query, queryOne } from '../config/database'
import { log }        from '../middleware/logger'
import { env }        from '../config/env'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface FirmaResult {
  firmaDER:      Buffer
  firmaHex:      string
  firmaBase64:   string
  pdfHashSHA256: string
  certSerial:    string
  certSubject:   string
  firmadoEn:     Date
  validaHasta:   Date
  firmaId:       string
}

export interface VerificacionFirma {
  valida:        boolean
  motivo:        string
  pdfHash:       string
  hashEnFirma:   string | null
  hashCoincide:  boolean
  firmaRSA:      boolean
  certSubject:   string | null
  certSerial:    string | null
  certVigente:   boolean | null
  firmadoEn:     Date | null
}

export interface CertInfo {
  serial:      string
  subject:     string
  issuer:      string
  validDesde:  Date
  validHasta:  Date
  vigente:     boolean
  algoritmo:   string
  pem:         string
}

interface ParLlaves {
  privateKey:  forge.pki.rsa.PrivateKey
  certificate: forge.pki.Certificate
}

// ══════════════════════════════════════════════════════════
// OIDs usados
// ══════════════════════════════════════════════════════════
const OID_MD         = '1.2.840.113549.1.9.4'  // messageDigest
const OID_SIGN_TIME  = '1.2.840.113549.1.9.5'  // signingTime

// ══════════════════════════════════════════════════════════
// GESTIÓN DEL PAR DE LLAVES RODAID
// ══════════════════════════════════════════════════════════

let _cache: ParLlaves | null = null

export async function obtenerParLlaves(): Promise<ParLlaves> {
  if (_cache) return _cache

  // 1. Desde env (producción)
  if (env.RODAID_FIRMA_CERT_PEM && env.RODAID_FIRMA_KEY_PEM) {
    try {
      const cert = forge.pki.certificateFromPem(env.RODAID_FIRMA_CERT_PEM)
      const key  = forge.pki.privateKeyFromPem(env.RODAID_FIRMA_KEY_PEM)
      log.firma.info({ source: 'env', serial: cert.serialNumber }, '🔑 Llaves cargadas desde env')
      _cache = { privateKey: key, certificate: cert }
      return _cache
    } catch (err) {
      log.firma.warn({ err: (err as Error).message }, 'Error cargando llaves env')
    }
  }

  // 2. Desde DB
  const fila = await queryOne<{ cert_pem: string; clave_privada: string | null }>(
    `SELECT cert_pem, clave_privada FROM rodaid_clave_firma WHERE activa=TRUE ORDER BY generada_en DESC LIMIT 1`, []
  )
  if (fila?.cert_pem && fila?.clave_privada) {
    try {
      const cert = forge.pki.certificateFromPem(fila.cert_pem)
      const key  = forge.pki.privateKeyFromPem(fila.clave_privada)
      log.firma.info({ source: 'db', serial: cert.serialNumber }, '🔑 Llaves cargadas desde DB')
      _cache = { privateKey: key, certificate: cert }
      return _cache
    } catch (err) {
      log.firma.warn({ err: (err as Error).message }, 'Error cargando llaves DB')
    }
  }

  // 3. Generar nuevo par
  log.firma.info('🔑 Generando nuevo par RSA-2048...')
  const par = await _generarParLlaves()
  await _persistirParLlaves(par)
  _cache = par
  return par
}

export function invalidarCacheLlaves(): void {
  _cache = null
}

async function _generarParLlaves(): Promise<ParLlaves> {
  // Usar Node.js nativo (más rápido que forge.pki.rsa.generateKeyPair)
  const { privateKey: privPEM, publicKey: pubPEM } = crypto.generateKeyPairSync('rsa', {
    modulusLength:      2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  const privateKey = forge.pki.privateKeyFromPem(privPEM as unknown as string)
  const publicKey  = forge.pki.publicKeyFromPem(pubPEM as unknown as string)

  const cert = forge.pki.createCertificate()
  cert.publicKey   = publicKey
  cert.serialNumber = crypto.randomBytes(16).toString('hex').toUpperCase()

  const now    = new Date()
  const expiry = new Date(now); expiry.setFullYear(expiry.getFullYear() + 2)
  cert.validity.notBefore = now
  cert.validity.notAfter  = expiry

  const attrs = [
    { name: 'commonName',             value: 'RODAID PDF Signing Certificate' },
    { name: 'organizationName',       value: 'RODAID' },
    { name: 'organizationalUnitName', value: 'Certificación de Bicicletas' },
    { name: 'countryName',            value: 'AR' },
    { name: 'stateOrProvinceName',    value: 'Mendoza' },
    { name: 'localityName',           value: 'San Martín' },
  ]
  cert.setSubject(attrs); cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(privateKey, forge.md.sha256.create())

  log.firma.info({ serial: cert.serialNumber, validaHasta: expiry.toISOString() },
    '✓ Par RSA-2048 + certificado X.509 generado')

  return { privateKey, certificate: cert }
}

async function _persistirParLlaves({ privateKey, certificate }: ParLlaves): Promise<void> {
  const certPEM    = forge.pki.certificateToPem(certificate)
  const keyPEM     = forge.pki.privateKeyToPem(privateKey)
  await query(`UPDATE rodaid_clave_firma SET activa=FALSE`, [])
  await query(
    `INSERT INTO rodaid_clave_firma (cert_serial,cert_pem,clave_privada,subject,valida_desde,valida_hasta,activa)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE)
     ON CONFLICT (cert_serial) DO UPDATE SET activa=TRUE`,
    [
      certificate.serialNumber,
      certPEM, keyPEM,
      certificate.subject.getField('CN')?.value ?? 'RODAID',
      certificate.validity.notBefore,
      certificate.validity.notAfter,
    ]
  )
}

// ══════════════════════════════════════════════════════════
// FIRMA PKCS#7 DETACHED
// ══════════════════════════════════════════════════════════

export async function firmarPDF(
  pdfBuffer:  Buffer,
  citId:      string,
  numeroCIT:  string
): Promise<FirmaResult> {
  const t0       = Date.now()
  const { privateKey, certificate } = await obtenerParLlaves()
  const pdfHash  = crypto.createHash('sha256').update(pdfBuffer).digest('hex')

  // Idempotencia
  const existente = await queryOne<{
    id: string; firma_hex: string; cert_serial: string; firmado_en: Date; valida_hasta: Date
  }>(
    `SELECT id, firma_hex, cert_serial, firmado_en, valida_hasta
     FROM firmas_pdf WHERE cit_id=$1 AND pdf_hash_sha256=$2 AND revocada=FALSE`,
    [citId, pdfHash]
  )
  if (existente) {
    log.firma.info({ citId, id: existente.id }, '✓ Firma reutilizada (idempotente)')
    const derBuf = Buffer.from(existente.firma_hex, 'hex')
    return {
      firmaDER:      derBuf,
      firmaHex:      existente.firma_hex,
      firmaBase64:   derBuf.toString('base64'),
      pdfHashSHA256: pdfHash,
      certSerial:    existente.cert_serial,
      certSubject:   certificate.subject.getField('CN')?.value ?? 'RODAID',
      firmadoEn:     new Date(existente.firmado_en),
      validaHasta:   new Date(existente.valida_hasta ?? certificate.validity.notAfter),
      firmaId:       existente.id,
    }
  }

  // ── Construir PKCS#7 SignedData CON contenido ─────────────
  // forge calcula SHA-256 del PDF y lo pone en messageDigest
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(pdfBuffer.toString('binary'))
  p7.addCertificate(certificate)
  p7.addSigner({
    key:             forge.pki.privateKeyToPem(privateKey),
    certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.signingTime },    // forge pone timestamp automático
      { type: forge.pki.oids.messageDigest },  // forge pone SHA-256 del content
    ],
  })
  p7.sign()

  // ── Convertir a ASN.1 y remover eContent → detached ───────
  const asn1 = p7.toAsn1()
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
    const signedDataNode    = (asn1 as any).value[1].value[0]       // SignedData SEQUENCE
    const encapContentInfo  = signedDataNode.value[2]               // encapContentInfo SEQUENCE
    if (Array.isArray(encapContentInfo.value) && encapContentInfo.value.length > 1) {
      encapContentInfo.value.splice(1, 1)                           // eliminar [0] EXPLICIT eContent
    }
  } catch (err) {
    log.firma.warn({ err: (err as Error).message }, 'No se pudo hacer detached — eContent permanece')
  }

  // ── Serializar DER ────────────────────────────────────────
  const derBuf   = Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')
  const firmaHex = derBuf.toString('hex')
  const ms       = Date.now() - t0

  const certSerial  = certificate.serialNumber
  const certSubject = certificate.subject.getField('CN')?.value ?? 'RODAID'
  const firmadoEn   = new Date()
  const validaHasta = certificate.validity.notAfter

  // ── Persistir en DB ───────────────────────────────────────
  const row = await queryOne<{ id: string }>(
    `INSERT INTO firmas_pdf
       (cit_id, pdf_hash_sha256, firma_der, firma_hex,
        cert_serial, cert_subject, cert_pem, firmado_en, valida_hasta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (cit_id, pdf_hash_sha256) DO UPDATE
       SET revocada=FALSE, firmado_en=EXCLUDED.firmado_en
     RETURNING id`,
    [citId, pdfHash, derBuf, firmaHex,
     certSerial, certSubject,
     forge.pki.certificateToPem(certificate),
     firmadoEn, validaHasta]
  )

  log.firma.info({
    citId, numeroCIT, firmaId: row?.id,
    hash:  pdfHash.slice(0, 16) + '...',
    bytes: derBuf.length, ms,
  }, `✓ PDF firmado PKCS#7 detached (${derBuf.length}B · ${ms}ms)`)

  return {
    firmaDER:      derBuf,
    firmaHex,
    firmaBase64:   derBuf.toString('base64'),
    pdfHashSHA256: pdfHash,
    certSerial,
    certSubject,
    firmadoEn,
    validaHasta,
    firmaId:       row?.id ?? '',
  }
}

// ══════════════════════════════════════════════════════════
// VERIFICACIÓN — 2 checks independientes
// ══════════════════════════════════════════════════════════

export async function verificarFirmaPDF(
  pdfBuffer: Buffer,
  firmaDER:  Buffer
): Promise<VerificacionFirma> {
  const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex')

  let hashEnFirma:  string | null = null
  let firmaRSA       = false
  let certSubject:  string | null = null
  let certSerial:   string | null = null
  let certVigente:  boolean | null = null
  let firmadoEn:    Date | null = null

  try {
    // Parsear DER → ASN.1 → PKCS#7
    const asn1 = forge.asn1.fromDer(firmaDER.toString('binary'))
    const p7   = forge.pkcs7.messageFromAsn1(asn1) as any
    const rc   = p7.rawCapture as any

    // ── A. Integridad: extraer messageDigest de atributos firmados ──
    const attrs: any[] = rc.authenticatedAttributes ?? []
    let authAttrsDER: Buffer | null = null

    for (const attr of attrs) {
      const oid = forge.asn1.derToOid(attr.value[0].value)
      if (oid === OID_MD) {
        hashEnFirma = Buffer.from((attr as any).value[1].value[0].value, 'binary').toString('hex')
      }
      if (oid === OID_SIGN_TIME) {
        try {
          const stRaw = (attr as any).value[1]?.value[0]?.value
          if (stRaw && typeof stRaw === 'string') firmadoEn = new Date(stRaw)
        } catch { /* ignore */ }
      }
    }

    // DER del SET de atributos firmados (lo que firma RSA)
    const authAttrsAsn1 = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs
    )
    authAttrsDER = Buffer.from(forge.asn1.toDer(authAttrsAsn1).getBytes(), 'binary')

    // ── B. Autenticidad: verificar RSA con Node.js crypto ──────────
    const cert = p7.certificates?.[0]
    if (cert && authAttrsDER) {
      certSubject = cert.subject.getField('CN')?.value ?? null
      certSerial  = cert.serialNumber
      const now   = new Date()
      certVigente = cert.validity.notBefore <= now && cert.validity.notAfter >= now

      const sigBytes  = Buffer.from(rc.signature, 'binary')
      const certPEM   = forge.pki.certificateToPem(cert)

      try {
        const verifier = crypto.createVerify('RSA-SHA256')
        verifier.update(authAttrsDER)
        firmaRSA = verifier.verify(certPEM, sigBytes)
      } catch {
        firmaRSA = false
      }
    }

    const hashCoincide = hashEnFirma === pdfHash
    const valida       = hashCoincide && firmaRSA && certVigente !== false

    return {
      valida,
      motivo: valida
        ? `Firma válida. PDF íntegro. Firmado por ${certSubject} · ${firmadoEn?.toLocaleString('es-AR') ?? 'N/D'}`
        : [
            !hashCoincide         ? 'El PDF fue modificado (hash no coincide).' : '',
            !firmaRSA             ? 'Firma RSA inválida.'                        : '',
            certVigente === false ? 'Certificado expirado.'                      : '',
          ].filter(Boolean).join(' '),
      pdfHash, hashEnFirma, hashCoincide, firmaRSA,
      certSubject, certSerial, certVigente, firmadoEn,
    }
  } catch (err) {
    return {
      valida: false,
      motivo: `Error al parsear la firma: ${(err as Error).message}`,
      pdfHash, hashEnFirma, hashCoincide: false,
      firmaRSA, certSubject, certSerial, certVigente, firmadoEn,
    }
  }
}

// ══════════════════════════════════════════════════════════
// CONSULTAS / ADMIN
// ══════════════════════════════════════════════════════════

export async function getFirmaCIT(citId: string) {
  return queryOne<{
    id: string; pdf_hash_sha256: string; firma_hex: string; firma_der: Buffer
    cert_serial: string; cert_subject: string; cert_pem: string
    firmado_en: Date; valida_hasta: Date; revocada: boolean
  }>(
    `SELECT id, pdf_hash_sha256, firma_hex, firma_der,
            cert_serial, cert_subject, cert_pem, firmado_en, valida_hasta, revocada
     FROM firmas_pdf
     WHERE cit_id=$1 AND revocada=FALSE
     ORDER BY firmado_en DESC LIMIT 1`,
    [citId]
  )
}

export async function getInfoCertActivo(): Promise<CertInfo | null> {
  const { certificate } = await obtenerParLlaves()
  const now = new Date()
  return {
    serial:     certificate.serialNumber,
    subject:    certificate.subject.attributes.map((a: any) => `${a.shortName}=${a.value}`).join(', '),
    issuer:     certificate.issuer.attributes.map((a: any) => `${a.shortName}=${a.value}`).join(', '),
    validDesde: certificate.validity.notBefore,
    validHasta: certificate.validity.notAfter,
    vigente:    certificate.validity.notBefore <= now && certificate.validity.notAfter >= now,
    algoritmo:  'RSA-2048 SHA-256 (PKCS1v15)',
    pem:        forge.pki.certificateToPem(certificate),
  }
}

export async function rotarLlaves(): Promise<CertInfo> {
  invalidarCacheLlaves()
  await query(`UPDATE rodaid_clave_firma SET activa=FALSE`, [])
  const par = await _generarParLlaves()
  await _persistirParLlaves(par)
  _cache = par
  const info = await getInfoCertActivo()
  log.firma.info({ serial: info?.serial }, '🔑 Llaves rotadas')
  return info!
}

export async function revocarFirma(firmaId: string, motivo: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE firmas_pdf SET revocada=TRUE, revocada_en=NOW(), revocada_motivo=$2
     WHERE id=$1 AND revocada=FALSE RETURNING id`,
    [firmaId, motivo]
  )
  if (row) log.firma.info({ firmaId, motivo }, '✓ Firma revocada')
  return !!row
}

// ══════════════════════════════════════════════════════════
// CARGA DE PKCS#12 (.p12 / .pfx)
// ══════════════════════════════════════════════════════════

export interface P12Info {
  privateKey:   forge.pki.rsa.PrivateKey
  certificate:  forge.pki.Certificate
  cadena:       forge.pki.Certificate[]
  thumbprint:   string   // SHA-256 del .p12
  // Campos pre-extraídos del certificado
  subject:      string
  serial:       string
  validFrom:    Date
  validTo:      Date
  isCACert:     boolean
}

/**
 * Carga un archivo PKCS#12 y extrae el par de claves.
 * El .p12 puede estar en base64 o como Buffer.
 */
export function cargarP12(p12Data: Buffer | string, password: string): P12Info {
  const buf = typeof p12Data === 'string' ? Buffer.from(p12Data, 'base64') : p12Data
  const thumbprint = crypto.createHash('sha256').update(buf).digest('hex')

  const p12Asn1  = forge.asn1.fromDer(forge.util.binary.raw.encode(new Uint8Array(buf)))
  const p12      = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password)

  // Extraer clave privada
  const keyBags  = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const keyBag   = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
  if (!keyBag?.key) throw new Error('No se encontró clave privada en el PKCS#12')
  const privateKey = keyBag.key as forge.pki.rsa.PrivateKey

  // Extraer certificado(s)
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certs    = certBags[forge.pki.oids.certBag]?.map(b => b.cert!).filter(Boolean) ?? []
  if (certs.length === 0) throw new Error('No se encontró certificado en el PKCS#12')

  // El primer certificado es el del firmante
  const [certificate, ...cadena] = certs

  log.firma.info({
    thumbprint: thumbprint.slice(0, 16),
    serial:     certificate.serialNumber,
    subject:    certificate.subject.getField('CN')?.value,
    validHasta: certificate.validity.notAfter.toISOString(),
  }, '🔑 PKCS#12 cargado exitosamente')

  const isCACert = certificate.extensions?.some((e: any) =>
    e.name === 'basicConstraints' && e.cA === true
  ) ?? false

  return {
    privateKey, certificate, cadena, thumbprint,
    subject:   certificate.subject.getField('CN')?.value ?? certificate.subject.getField('O')?.value ?? '',
    serial:    certificate.serialNumber,
    validFrom: certificate.validity.notBefore,
    validTo:   certificate.validity.notAfter,
    isCACert,
  }
}

// ══════════════════════════════════════════════════════════
// CONSTRUIR PAYLOAD CANÓNICO DEL CIT
// ══════════════════════════════════════════════════════════

export interface PayloadCIT {
  version:         '1.0'
  numeroCIT:       string
  citId:           string
  serial:          string             // número de serie de la bici
  marca:           string
  modelo:          string
  propietarioDNI:  string
  propietarioNombre: string
  inspectorId:     string
  tallerAliadoId:  string
  puntos:          Record<string, boolean>
  hashSHA256PDF?:  string             // hash del PDF si ya fue generado
  fechaEmision:    string             // ISO 8601
  leyReferencia:   '9556'
}

/**
 * Construye el payload canónico del CIT para firmar.
 * El JSON se ordena lexicográficamente para garantizar
 * determinismo en múltiples plataformas.
 */
export function construirPayloadCIT(data: Omit<PayloadCIT, 'version' | 'leyReferencia'>): PayloadCIT {
  return {
    version:          '1.0',
    leyReferencia:    '9556',
    numeroCIT:        data.numeroCIT,
    citId:            data.citId,
    serial:           data.serial,
    marca:            data.marca,
    modelo:           data.modelo,
    propietarioDNI:   data.propietarioDNI,
    propietarioNombre:data.propietarioNombre,
    inspectorId:      data.inspectorId,
    tallerAliadoId:   data.tallerAliadoId,
    puntos:           data.puntos,
    hashSHA256PDF:    data.hashSHA256PDF,
    fechaEmision:     data.fechaEmision,
  }
}

/**
 * Serialización canónica: ordenar claves lexicográficamente
 * para garantizar el mismo hash en cualquier runtime.
 */
export function canonicalizarPayload(payload: object): string {
  return JSON.stringify(payload, Object.keys(payload).sort())
}

/**
 * Calcular SHA-256 del payload canónico.
 */
export function hashPayloadCIT(payload: object): string {
  return crypto.createHash('sha256')
    .update(canonicalizarPayload(payload))
    .digest('hex')
}

// ══════════════════════════════════════════════════════════
// FIRMA RSA-PSS DEL PAYLOAD CIT
// ══════════════════════════════════════════════════════════

export interface FirmaPayloadResult {
  firmaBase64url:  string
  payloadHash:     string
  certSerial:      string
  certSubject:     string
  certPEM:         string
  p12Thumbprint?:  string
  algoritmo:       'RSA-PSS-SHA256'
  firmadoEn:       Date
  validaHasta:     Date
  firmaId:         string
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
export async function firmarPayloadCIT(opts: {
  payload:     PayloadCIT
  citId:       string
  numeroCIT:   string
  inspectorId?: string
  // Fuente de claves (en orden de prioridad):
  p12Buffer?:  Buffer    // PKCS#12 del inspector o RODAID
  p12Password?: string
}): Promise<FirmaPayloadResult> {

  // 1. Obtener par de llaves (P12 > env > DB > generado)
  let parLlaves: ParLlaves
  let p12Thumbprint: string | undefined

  if (opts.p12Buffer) {
    const p12Info    = cargarP12(opts.p12Buffer, opts.p12Password ?? '')
    parLlaves        = { privateKey: p12Info.privateKey, certificate: p12Info.certificate }
    p12Thumbprint    = p12Info.thumbprint
    log.firma.info({ thumbprint: p12Thumbprint.slice(0, 16) }, 'Usando P12 provisto para firma')
  } else {
    parLlaves = await obtenerParLlaves()
  }

  const { privateKey, certificate } = parLlaves

  // 2. Canonicalizar y hashear el payload
  const canonical    = canonicalizarPayload(opts.payload)
  const payloadHash  = crypto.createHash('sha256').update(canonical).digest('hex')

  // 3. Idempotencia: no refirmar si ya existe firma válida
  const existente = await queryOne<{
    id: string; firma_base64url: string; payload_hash: string
    cert_serial: string; cert_subject: string; cert_pem: string; firmado_en: Date; valida_hasta: Date
  }>(
    `SELECT id, firma_base64url, payload_hash, cert_serial, cert_subject, cert_pem, firmado_en, valida_hasta
     FROM firmas_payload_cit
     WHERE cit_id=$1 AND payload_hash=$2 AND NOT revocada LIMIT 1`,
    [opts.citId, payloadHash]
  )

  if (existente) {
    log.firma.debug({ citId: opts.citId, firmaId: existente.id }, 'Firma ya existe — retornando existente')
    return {
      firmaBase64url: existente.firma_base64url,
      payloadHash:    existente.payload_hash,
      certSerial:     existente.cert_serial,
      certSubject:    existente.cert_subject,
      certPEM:        existente.cert_pem,
      algoritmo:      'RSA-PSS-SHA256',
      firmadoEn:      new Date(existente.firmado_en),
      validaHasta:    new Date(existente.valida_hasta),
      firmaId:        existente.id,
    }
  }

  // 4. Firmar con RSA-PSS-SHA256 (Node.js crypto nativo)
  //    Convertir clave forge a formato compatible con Node crypto
  const privPEM  = forge.pki.privateKeyToPem(privateKey)
  const signer   = crypto.createSign('SHA256')
  signer.update(canonical, 'utf8')
  const firmaBuf = signer.sign({
    key:        privPEM,
    padding:    crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,  // 32 bytes
  })

  const firmaBase64url = firmaBuf.toString('base64url')

  // 5. Persistir
  const certPEM    = forge.pki.certificateToPem(certificate)
  const validHasta = certificate.validity.notAfter

  const row = await queryOne<{ id: string }>(
    `INSERT INTO firmas_payload_cit
       (cit_id, numero_cit, payload_json, payload_hash, firma_base64url,
        cert_serial, cert_subject, cert_pem, algoritmo,
        p12_thumbprint, firmado_en, valida_hasta, inspector_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11,$12)
     RETURNING id`,
    [
      opts.citId, opts.numeroCIT,
      canonical,  // almacenar el JSON canónico exacto (TEXT, no JSONB) para auditoría
      payloadHash, firmaBase64url,
      certificate.serialNumber,
      certificate.subject.getField('CN')?.value ?? 'RODAID',
      certPEM, 'RSA-PSS-SHA256',
      p12Thumbprint ?? null,
      validHasta,
      opts.inspectorId ?? null,
    ]
  )

  // 6. Actualizar el CIT con referencia a la firma
  await query(
    `UPDATE cits SET firma_payload_id=$2, firma_payload_hash=$3 WHERE id=$1`,
    [opts.citId, row!.id, payloadHash]
  )

  const certSubject = certificate.subject.getField('CN')?.value ?? 'RODAID'
  log.firma.info({
    citId:      opts.citId,
    numeroCIT:  opts.numeroCIT,
    payloadHash: payloadHash.slice(0, 16),
    certSerial: certificate.serialNumber,
    algoritmo:  'RSA-PSS-SHA256',
    p12:        p12Thumbprint ? 'P12' : 'INTERNAL',
  }, '✅ Payload CIT firmado')

  return {
    firmaBase64url,
    payloadHash,
    certSerial:  certificate.serialNumber,
    certSubject,
    certPEM,
    p12Thumbprint,
    algoritmo:   'RSA-PSS-SHA256',
    firmadoEn:   new Date(),
    validaHasta: validHasta,
    firmaId:     row!.id,
  }
}

// ══════════════════════════════════════════════════════════
// VERIFICACIÓN RSA-PSS
// ══════════════════════════════════════════════════════════

export interface VerificacionPayload {
  valida:          boolean
  revocada:        boolean
  motivo:          string
  payloadHash:     string
  hashCoincide:    boolean
  firmaRSA:        boolean
  certSerial:      string | null
  certSubject:     string | null
  certVigente:     boolean | null
  firmadoEn:       Date | null
  validaHasta?:    Date | null
  algoritmo:       string
  payloadDecoded?: Record<string, unknown> | null
}

/**
 * Verificar la firma del payload de un CIT.
 * Puede usarse con el citId (busca en DB) o con los datos crudos.
 */
export async function verificarFirmaPayload(opts: {
  citId?:          string   // busca en DB
  payloadJSON?:    string   // JSON canónico
  firmaBase64url?: string   // firma a verificar
  certPEM?:        string   // certificado del firmante
}): Promise<VerificacionPayload> {

  let payloadJSON:    string | null = opts.payloadJSON ?? null
  let firmaBase64url: string | null = opts.firmaBase64url ?? null
  let certPEM:        string | null = opts.certPEM ?? null
  let firmadoEn:      Date | null   = null
  let certSerial:     string | null = null
  let certSubject:    string | null = null

  // Cargar desde DB si se pasa citId (y no se pasa firma explícita)
  if (opts.citId && !opts.firmaBase64url) {
    const fila = await queryOne<{
      payload_json: string; firma_base64url: string; cert_pem: string
      cert_serial: string; cert_subject: string; firmado_en: Date; valida_hasta: Date
    }>(
      `SELECT payload_json, firma_base64url, cert_pem,
              cert_serial, cert_subject, firmado_en, valida_hasta, revocada
       FROM firmas_payload_cit WHERE cit_id=$1 ORDER BY firmado_en DESC LIMIT 1`,
      [opts.citId]
    )
    if (!fila) return {
      valida: false, revocada: false, motivo: 'Sin firma de payload para este CIT',
      payloadHash: '', hashCoincide: false, firmaRSA: false,
      certSerial: null, certSubject: null, certVigente: null, firmadoEn: null, algoritmo: 'N/A',
    }
    // Check revocation
    if ((fila as any).revocada) return {
      valida: false, revocada: true, motivo: 'Firma revocada',
      payloadHash: '', hashCoincide: false, firmaRSA: false,
      certSerial: fila.cert_serial, certSubject: fila.cert_subject,
      certVigente: null, firmadoEn: new Date(fila.firmado_en), algoritmo: 'RSA-PSS-SHA256',
    }
    payloadJSON    = fila.payload_json
    firmaBase64url = fila.firma_base64url
    certPEM        = fila.cert_pem
    certSerial     = fila.cert_serial
    certSubject    = fila.cert_subject
    firmadoEn      = new Date(fila.firmado_en)
  }

  if (!payloadJSON || !firmaBase64url || !certPEM) {
    return {
      valida: false, revocada: false, motivo: 'Datos de verificación incompletos',
      payloadHash: '', hashCoincide: false, firmaRSA: false,
      certSerial, certSubject, certVigente: null, firmadoEn, algoritmo: 'RSA-PSS-SHA256',
    }
  }

  // Calcular hash del payload
  const payloadHash = crypto.createHash('sha256').update(payloadJSON, 'utf8').digest('hex')

  // Verificar firma RSA-PSS
  let firmaRSA = false
  try {
    const verifier = crypto.createVerify('SHA256')
    verifier.update(payloadJSON, 'utf8')
    firmaRSA = verifier.verify(
      {
        key:        certPEM,
        padding:    crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      Buffer.from(firmaBase64url, 'base64url')
    )
  } catch (err) {
    log.firma.warn({ err: (err as Error).message }, 'Error verificando firma RSA-PSS')
  }

  // Verificar vigencia del certificado
  let certVigente: boolean | null = null
  try {
    const cert = forge.pki.certificateFromPem(certPEM)
    const ahora = new Date()
    certVigente = ahora >= cert.validity.notBefore && ahora <= cert.validity.notAfter
    if (!certSerial) certSerial = cert.serialNumber
    if (!certSubject) certSubject = cert.subject.getField('CN')?.value ?? null
  } catch { /* noop */ }

  const hashCoincide = true  // el hash está implícito en el JSON que verificamos

  const valida   = firmaRSA && (certVigente !== false)
  const motivo   = !firmaRSA     ? 'Firma RSA-PSS inválida'
    : certVigente === false       ? 'Certificado vencido'
    : '✅ Firma válida'

  let payloadDecoded: Record<string, unknown> | null = null
  if (valida && payloadJSON) {
    try { payloadDecoded = JSON.parse(payloadJSON) } catch { /* noop */ }
  }

  return {
    valida, revocada: false, motivo, payloadHash, hashCoincide, firmaRSA,
    certSerial, certSubject, certVigente, firmadoEn, algoritmo: 'RSA-PSS-SHA256',
    payloadDecoded,
  }
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
export async function exportarClavePublicaWebCrypto(): Promise<{
  spkiBase64:  string    // Base64 del DER SPKI — para importKey('spki', ...)
  jwk:         object    // JSON Web Key — para importKey('jwk', ...)
  certPEM:     string    // Para verificación con OpenSSL
  certSerial:  string
  algorithm:   'RSA-PSS'
  hash:        'SHA-256'
  saltLength:  32
}> {
  const { privateKey, certificate } = await obtenerParLlaves()

  // Exportar clave pública como DER SPKI para Web Crypto API
  const pubKeyNode = crypto.createPublicKey(
    forge.pki.publicKeyToPem(certificate.publicKey as forge.pki.rsa.PublicKey)
  )
  const spkiDER    = pubKeyNode.export({ type: 'spki', format: 'der' })
  const spkiBase64 = spkiDER.toString('base64')

  // Exportar como JWK para alternativa
  const jwk = pubKeyNode.export({ format: 'jwk' }) as object

  const certPEM = forge.pki.certificateToPem(certificate)

  return {
    spkiBase64,
    jwk,
    certPEM,
    certSerial:  certificate.serialNumber,
    algorithm:   'RSA-PSS',
    hash:        'SHA-256',
    saltLength:  32,
  }
}

/**
 * Revocar la firma del payload de un CIT (p.ej. tras detección de fraude).
 */
export async function revocarFirmaPayload(firmaId: string, motivo: string): Promise<void> {
  await query(
    `UPDATE firmas_payload_cit SET revocada=TRUE, revocada_en=NOW(), motivo_revocacion=$2 WHERE id=$1`,
    [firmaId, motivo]
  )
  log.firma.warn({ firmaId, motivo }, '🔴 Firma de payload revocada')
}

/**
 * Listar firmas de un CIT (auditoría).
 */
export async function getHistorialFirmas(citId: string) {
  return query(
    `SELECT id, numero_cit, payload_hash, cert_serial, cert_subject,
            algoritmo, p12_thumbprint, firmado_en, valida_hasta,
            revocada, revocada_en, motivo_revocacion
     FROM firmas_payload_cit WHERE cit_id=$1 ORDER BY firmado_en DESC`,
    [citId]
  )
}
