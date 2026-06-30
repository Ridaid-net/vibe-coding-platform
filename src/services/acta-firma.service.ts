import { webcrypto, createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import forge from 'node-forge'

/**
 * RODAID — Hito 11: Firma digital de actas de inspeccion (Web Crypto API / PKCS#12).
 *
 * Convierte cada inspeccion fisica en un DOCUMENTO TECNICO CON VALIDEZ LEGAL: el
 * payload canonico del acta se firma con la clave privada de un certificado X.509
 * que se carga desde un bundle PKCS#12 (.p12/.pfx). La firma se computa con la
 * **Web Crypto API** (`crypto.subtle`, RSASSA-PKCS1-v1_5 sobre SHA-256) y queda
 * acompanada por el certificado del firmante, de modo que cualquiera pueda
 * verificarla OFFLINE recomputando el digest y validando la firma contra la clave
 * publica del certificado — sin depender de RODAID.
 *
 * Origen de la credencial PKCS#12:
 *   - PKCS12 (produccion): se carga el bundle desde la variable de entorno
 *     `RODAID_INSPECTOR_P12_BASE64` (DER en base64) con su passphrase
 *     `RODAID_INSPECTOR_P12_PASSPHRASE`. Contiene la clave privada + el
 *     certificado de la Autoridad de Inspeccion de RODAID.
 *   - DEV (preview/sin credenciales): se genera al vuelo un bundle PKCS#12
 *     autofirmado, cacheado en el proceso, para ejercitar el flujo de punta a
 *     punta igual que el resto de los modos del proyecto. Al configurar la
 *     credencial real, la firma se emite con esa identidad sin tocar codigo.
 *
 * Se eligio Web Crypto (subtle) para la operacion criptografica — como pide el
 * Hito 11 — y node-forge solo para parsear/empaquetar el contenedor PKCS#12 y el
 * X.509 (formatos que la Web Crypto API no maneja por si sola).
 */

export type ActaFirmaModo = 'PKCS12' | 'DEV'

/** Algoritmo de la firma. RSASSA-PKCS1-v1_5 sobre SHA-256 (RSA 2048). */
export const ACTA_FIRMA_ALGORITMO = 'RSASSA-PKCS1-v1_5-SHA256'
const WEBCRYPTO_ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const

/** Credencial de firma resuelta (clave privada lista para subtle + certificado). */
interface CredencialFirma {
  modo: ActaFirmaModo
  /** Clave privada importada a Web Crypto, lista para firmar. */
  signingKey: webcrypto.CryptoKey
  /** Certificado del firmante (node-forge). */
  certificate: forge.pki.Certificate
  /** Certificado del firmante en PEM (se embebe en el acta). */
  certificadoPem: string
  /** Numero de serie del certificado (hex). */
  certSerie: string
  /** Huella SHA-256 (hex) del certificado (DER). */
  certFingerprint: string
  /** Common Name del firmante (para mostrar). */
  commonName: string
}

/** Resultado de firmar un acta. */
export interface ActaFirmada {
  modo: ActaFirmaModo
  algoritmo: string
  /** Firma digital (base64) sobre los bytes del payload canonico. */
  valor: string
  /** Payload canonico exacto que se firmo (JSON estable). */
  canonico: string
  certificadoPem: string
  certSerie: string
  certFingerprint: string
  commonName: string
}

// ── Configuracion / modo ─────────────────────────────────────────────────────

function getP12Base64(): string | null {
  const raw = process.env.RODAID_INSPECTOR_P12_BASE64
  const trimmed = raw?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

/**
 * Modo de firma. PKCS12 solo si esta configurado el bundle real; si no, DEV
 * (autofirmado efimero) para no romper los entornos sin credenciales.
 */
export function getActaFirmaModo(): ActaFirmaModo {
  return getP12Base64() ? 'PKCS12' : 'DEV'
}

// ── Carga / generacion de la credencial ──────────────────────────────────────

let credencialReal: CredencialFirma | null = null
let credencialDev: CredencialFirma | null = null

/**
 * Parsea un bundle PKCS#12 (DER) y extrae la clave privada RSA + el certificado.
 * Soporta tanto la key shrouded (cifrada con la passphrase) como la key bag plana.
 */
function extraerDePkcs12(
  der: string,
  passphrase: string
): { privateKey: forge.pki.rsa.PrivateKey; certificate: forge.pki.Certificate } {
  const asn1 = forge.asn1.fromDer(der)
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase)

  // Clave privada: probamos primero la bolsa cifrada (lo habitual en un .p12).
  let keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ]?.[0]
  if (!keyBag) {
    keyBag = p12.getBags({ bagType: forge.pki.oids.keyBag })[
      forge.pki.oids.keyBag
    ]?.[0]
  }
  const privateKey = keyBag?.key as forge.pki.rsa.PrivateKey | undefined
  if (!privateKey) {
    throw new Error('El bundle PKCS#12 no contiene una clave privada.')
  }

  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[
    forge.pki.oids.certBag
  ]?.[0]
  const certificate = certBag?.cert as forge.pki.Certificate | undefined
  if (!certificate) {
    throw new Error('El bundle PKCS#12 no contiene un certificado.')
  }

  return { privateKey, certificate }
}

/**
 * Construye una `CredencialFirma` a partir de una clave privada forge y su
 * certificado: importa la clave a Web Crypto (PKCS#8) y deriva los metadatos del
 * certificado (PEM, serie, fingerprint).
 */
async function construirCredencial(
  modo: ActaFirmaModo,
  privateKey: forge.pki.rsa.PrivateKey,
  certificate: forge.pki.Certificate
): Promise<CredencialFirma> {
  // forge RSAPrivateKey -> PrivateKeyInfo (PKCS#8) -> DER -> Web Crypto.
  const pkcs8Der = forge.asn1
    .toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(privateKey)))
    .getBytes()
  const signingKey = await webcrypto.subtle.importKey(
    'pkcs8',
    binaryToUint8(pkcs8Der),
    WEBCRYPTO_ALG,
    false,
    ['sign']
  )

  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes()
  const certFingerprint = createHash('sha256')
    .update(Buffer.from(certDer, 'binary'))
    .digest('hex')

  return {
    modo,
    signingKey,
    certificate,
    certificadoPem: forge.pki.certificateToPem(certificate).trim(),
    certSerie: certificate.serialNumber,
    certFingerprint,
    commonName: subjectCommonName(certificate) ?? 'RODAID Autoridad de Inspeccion',
  }
}

async function cargarCredencialReal(): Promise<CredencialFirma> {
  if (credencialReal) return credencialReal
  const base64 = getP12Base64()
  if (!base64) {
    throw new Error('RODAID_INSPECTOR_P12_BASE64 no esta configurado.')
  }
  const passphrase = process.env.RODAID_INSPECTOR_P12_PASSPHRASE ?? ''
  const der = Buffer.from(base64, 'base64').toString('binary')
  const { privateKey, certificate } = extraerDePkcs12(der, passphrase)
  credencialReal = await construirCredencial('PKCS12', privateKey, certificate)
  return credencialReal
}

/**
 * Genera (y cachea) una credencial PKCS#12 autofirmada de desarrollo. Se empaqueta
 * de verdad como un .p12 y se vuelve a parsear por el mismo camino que la real, de
 * modo que el flujo PKCS#12 + Web Crypto se ejercita end-to-end en preview.
 */
async function cargarCredencialDev(): Promise<CredencialFirma> {
  if (credencialDev) return credencialDev

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const keyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string

  const forgeKey = forge.pki.privateKeyFromPem(keyPem)
  const forgePub = forge.pki.publicKeyFromPem(pubPem)

  const cert = forge.pki.createCertificate()
  cert.publicKey = forgePub
  cert.serialNumber = '00' + randomBytes(8).toString('hex')
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10)
  const attrs: forge.pki.CertificateField[] = [
    { name: 'commonName', value: 'RODAID Autoridad de Inspeccion (DEV)' },
    { name: 'organizationName', value: 'RODAID' },
    { name: 'organizationalUnitName', value: 'Portal de Inspectores y Aliados' },
    { name: 'countryName', value: 'AR' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', emailProtection: true, clientAuth: true },
  ])
  cert.sign(forgeKey, forge.md.sha256.create())

  // Empaquetar como PKCS#12 real y volver a parsearlo por el mismo camino.
  const passphrase = 'rodaid-dev'
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(forgeKey, cert, passphrase, {
    algorithm: '3des',
  })
  const der = forge.asn1.toDer(p12Asn1).getBytes()
  const { privateKey: parsedKey, certificate } = extraerDePkcs12(der, passphrase)

  credencialDev = await construirCredencial('DEV', parsedKey, certificate)
  return credencialDev
}

async function getCredencial(): Promise<CredencialFirma> {
  return getActaFirmaModo() === 'PKCS12'
    ? cargarCredencialReal()
    : cargarCredencialDev()
}

// ── Payload canonico del acta ────────────────────────────────────────────────

export interface ActaPayload {
  citId: string
  codigoCit: string
  numeroSerie: string
  hashIdentidad: string | null
  resultado: 'APROBADA' | 'DISCREPANCIA'
  inspectorId: string
  walletAddress: string
  tallerId: string | null
  emitidoEn: string
}

/**
 * Serializacion canonica y estable del acta (claves ordenadas). Es exactamente el
 * texto que se firma y sobre el que se verifica; cualquier cambio rompe la firma.
 */
export function canonicalizarActa(p: ActaPayload): string {
  return JSON.stringify({
    citId: p.citId,
    codigoCit: p.codigoCit,
    emitidoEn: p.emitidoEn,
    hashIdentidad: p.hashIdentidad,
    inspectorId: p.inspectorId,
    numeroSerie: p.numeroSerie,
    resultado: p.resultado,
    tallerId: p.tallerId,
    walletAddress: p.walletAddress,
  })
}

/** Huella SHA-256 (hex) del payload canonico — sello de integridad del acta. */
export function firmaHashActa(p: ActaPayload): string {
  return createHash('sha256').update(canonicalizarActa(p)).digest('hex')
}

// ── Firma / verificacion ─────────────────────────────────────────────────────

/**
 * Firma el acta con la Web Crypto API usando la clave del bundle PKCS#12. Devuelve
 * la firma en base64, el certificado del firmante (para verificacion offline) y
 * sus metadatos (serie, fingerprint, CN).
 */
export async function firmarActa(p: ActaPayload): Promise<ActaFirmada> {
  const cred = await getCredencial()
  const canonico = canonicalizarActa(p)
  const firma = await webcrypto.subtle.sign(
    WEBCRYPTO_ALG.name,
    cred.signingKey,
    new TextEncoder().encode(canonico)
  )
  return {
    modo: cred.modo,
    algoritmo: ACTA_FIRMA_ALGORITMO,
    valor: Buffer.from(firma).toString('base64'),
    canonico,
    certificadoPem: cred.certificadoPem,
    certSerie: cred.certSerie,
    certFingerprint: cred.certFingerprint,
    commonName: cred.commonName,
  }
}

/**
 * Verifica una firma de acta OFFLINE: importa la clave publica del certificado
 * embebido a Web Crypto y valida la firma contra el payload canonico recomputado.
 * No depende de la credencial activa del servidor: se verifica con el certificado
 * que viajo en el propio acta (validez legal autocontenida).
 */
export async function verificarActa(opts: {
  payload: ActaPayload
  firmaBase64: string
  certificadoPem: string
}): Promise<{ valido: boolean; commonName: string | null; certSerie: string | null }> {
  return verificarFirmaCanonica({
    canonico: canonicalizarActa(opts.payload),
    firmaBase64: opts.firmaBase64,
    certificadoPem: opts.certificadoPem,
  })
}

/**
 * Verifica una firma directamente contra el texto canonico EXACTO que se firmo
 * (tal como quedo guardado en el acta). Importa la clave publica del certificado
 * embebido a Web Crypto y valida la firma. Verificacion offline autocontenida.
 */
export async function verificarFirmaCanonica(opts: {
  canonico: string
  firmaBase64: string
  certificadoPem: string
}): Promise<{ valido: boolean; commonName: string | null; certSerie: string | null }> {
  let cert: forge.pki.Certificate
  try {
    cert = forge.pki.certificateFromPem(opts.certificadoPem)
  } catch {
    return { valido: false, commonName: null, certSerie: null }
  }

  const spkiDer = forge.asn1
    .toDer(forge.pki.publicKeyToAsn1(cert.publicKey))
    .getBytes()
  const verifyKey = await webcrypto.subtle.importKey(
    'spki',
    binaryToUint8(spkiDer),
    WEBCRYPTO_ALG,
    false,
    ['verify']
  )

  let valido = false
  try {
    valido = await webcrypto.subtle.verify(
      WEBCRYPTO_ALG.name,
      verifyKey,
      Buffer.from(opts.firmaBase64, 'base64'),
      new TextEncoder().encode(opts.canonico)
    )
  } catch {
    valido = false
  }

  return {
    valido,
    commonName: subjectCommonName(cert),
    certSerie: cert.serialNumber,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convierte la "binary string" de node-forge a un Uint8Array para Web Crypto. */
function binaryToUint8(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i) & 0xff
  }
  return out
}

function subjectCommonName(cert: forge.pki.Certificate): string | null {
  const field = cert.subject.getField('CN') as { value?: string } | null
  return field?.value ?? null
}
