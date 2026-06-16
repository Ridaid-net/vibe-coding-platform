import {
  createHash,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto'
import forge from 'node-forge'
import { Signer } from '@signpdf/utils'

/**
 * RODAID — Firma Digital de la Autoridad Certificadora (Certificado de Propiedad
 * y Verificacion).
 *
 * Produce una firma DETACHED PKCS#7 (CMS SignedData) sobre el binario del PDF.
 * La firma se incrusta en el propio PDF como una firma estandar
 * (`/SubFilter /adbe.pkcs7.detached`), de modo que:
 *
 *   - Si el PDF es alterado un solo byte, el rango firmado (ByteRange) deja de
 *     coincidir con el digest y la firma se ROMPE.
 *   - Es verificable OFFLINE y con herramientas estandar de PDF (Adobe Acrobat,
 *     `pdfsig`, etc.), sin depender de RODAID.
 *
 * La firma incluye el SELLO TEMPORAL del sistema como atributo autenticado
 * `signingTime` (la fecha de emision firmada junto al documento).
 *
 * Origen de la clave de autoridad:
 *   - AUTORIDAD (produccion): se cargan el certificado y la clave privada de la
 *     autoridad de RODAID desde variables de entorno (PEM). Opcionalmente, una
 *     cadena de certificados intermedios.
 *   - DEV (preview/sin credenciales): se genera al vuelo un certificado
 *     autofirmado "RODAID Autoridad Certificadora", cacheado en el proceso, para
 *     ejercitar el flujo de punta a punta igual que el resto de los modos STUB.
 */

export type FirmaModo = 'AUTORIDAD' | 'DEV'

/** Material criptografico de la autoridad firmante (formato node-forge). */
interface AutoridadFirmante {
  modo: FirmaModo
  certificate: forge.pki.Certificate
  privateKey: forge.pki.rsa.PrivateKey
  /** Cadena de certificados intermedios (sin incluir el propio `certificate`). */
  chain: forge.pki.Certificate[]
  /** Common Name del sujeto, para mostrar en el certificado/metadata. */
  commonName: string
}

// ── Configuracion / modo ─────────────────────────────────────────────────────

function envPem(name: string): string | null {
  const raw = process.env[name]
  if (!raw) return null
  // Permite valores con `\n` escapados (frecuente al pegar PEM en un panel).
  const normalized = raw.includes('-----BEGIN')
    ? raw.replace(/\\n/g, '\n').trim()
    : null
  return normalized && normalized.length > 0 ? normalized : null
}

/**
 * Determina el modo de firma. AUTORIDAD solo si estan el certificado y la clave
 * privada de la autoridad; si falta alguno, DEV (autofirmado) para no romper los
 * entornos sin credenciales.
 */
export function getFirmaModo(): FirmaModo {
  return envPem('RODAID_CERT_PEM') && envPem('RODAID_CERT_KEY_PEM')
    ? 'AUTORIDAD'
    : 'DEV'
}

// ── Carga / generacion de la autoridad firmante ──────────────────────────────

// La autoridad DEV se genera una sola vez por proceso (certificado estable entre
// solicitudes de una misma instancia serverless).
let devAutoridad: AutoridadFirmante | null = null
// La autoridad real se parsea una sola vez por proceso (las env no cambian).
let realAutoridad: AutoridadFirmante | null = null

function cargarAutoridadReal(): AutoridadFirmante {
  if (realAutoridad) return realAutoridad

  const certPem = envPem('RODAID_CERT_PEM')
  const keyPem = envPem('RODAID_CERT_KEY_PEM')
  if (!certPem || !keyPem) {
    throw new Error('RODAID_CERT_PEM / RODAID_CERT_KEY_PEM no estan configurados.')
  }

  const certificate = forge.pki.certificateFromPem(certPem)
  const passphrase = process.env.RODAID_CERT_KEY_PASSPHRASE
  const privateKey = passphrase
    ? forge.pki.decryptRsaPrivateKey(keyPem, passphrase)
    : forge.pki.privateKeyFromPem(keyPem)
  if (!privateKey) {
    throw new Error('No se pudo cargar la clave privada de la autoridad de RODAID.')
  }

  // Cadena intermedia opcional: uno o varios certificados concatenados en PEM.
  const chainPem = envPem('RODAID_CERT_CHAIN_PEM')
  const chain = chainPem ? parsePemChain(chainPem) : []

  const commonName =
    subjectCommonName(certificate) ?? 'RODAID Autoridad Certificadora'

  realAutoridad = {
    modo: 'AUTORIDAD',
    certificate,
    privateKey: privateKey as forge.pki.rsa.PrivateKey,
    chain,
    commonName,
  }
  return realAutoridad
}

/** Genera (y cachea) la autoridad autofirmada de desarrollo. */
function cargarAutoridadDev(): AutoridadFirmante {
  if (devAutoridad) return devAutoridad

  // Generamos el par RSA con node:crypto (nativo, rapido) y lo importamos a
  // node-forge para emitir un certificado X.509 autofirmado.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  const keyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string

  const forgeKey = forge.pki.privateKeyFromPem(keyPem)
  const forgePub = forge.pki.publicKeyFromPem(pubPem)

  const cert = forge.pki.createCertificate()
  cert.publicKey = forgePub
  cert.serialNumber = '00' + randomBytes(8).toString('hex')
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  // Vigencia amplia: es una autoridad efimera de preview.
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10)

  const attrs: forge.pki.CertificateField[] = [
    { name: 'commonName', value: 'RODAID Autoridad Certificadora (DEV)' },
    { name: 'organizationName', value: 'RODAID' },
    { name: 'organizationalUnitName', value: 'Certificados CIT' },
    { name: 'countryName', value: 'AR' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyCertSign: true },
    { name: 'extKeyUsage', emailProtection: true },
  ])
  cert.sign(forgeKey, forge.md.sha256.create())

  devAutoridad = {
    modo: 'DEV',
    certificate: cert,
    privateKey: forgeKey,
    chain: [],
    commonName: 'RODAID Autoridad Certificadora (DEV)',
  }
  return devAutoridad
}

function getAutoridad(): AutoridadFirmante {
  return getFirmaModo() === 'AUTORIDAD'
    ? cargarAutoridadReal()
    : cargarAutoridadDev()
}

// ── Signer compatible con @signpdf ───────────────────────────────────────────

/**
 * Implementacion de `Signer` (@signpdf) que produce un CMS/PKCS#7 detached con
 * node-forge usando la autoridad de RODAID. `@signpdf/signpdf` le entrega el
 * contenido a firmar (el PDF con el hueco de `/Contents` removido, es decir el
 * ByteRange exacto) y espera de vuelta el DER de la firma.
 */
class RodaidAuthoritySigner extends Signer {
  constructor(private readonly autoridad: AutoridadFirmante) {
    super()
  }

  async sign(pdfBuffer: Buffer, signingTime: Date = new Date()): Promise<Buffer> {
    const p7 = forge.pkcs7.createSignedData()
    p7.content = forge.util.createBuffer(pdfBuffer.toString('binary'))

    // El certificado del firmante + la cadena, para verificacion offline.
    p7.addCertificate(this.autoridad.certificate)
    for (const c of this.autoridad.chain) {
      p7.addCertificate(c)
    }

    p7.addSigner({
      key: this.autoridad.privateKey,
      certificate: this.autoridad.certificate,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        // El digest del contenido (lo completa node-forge al firmar).
        { type: forge.pki.oids.messageDigest },
        // SELLO TEMPORAL del sistema: la fecha de emision queda firmada.
        // (forge acepta un Date aqui; el tipo de @types/node-forge no lo refleja.)
        {
          type: forge.pki.oids.signingTime,
          value: signingTime as unknown as string,
        },
      ],
    })

    // detached: el contenido NO viaja dentro del PKCS#7; se firma el binario del
    // PDF "por fuera" (lo exige una firma de PDF con ByteRange).
    p7.sign({ detached: true })

    const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
    return Buffer.from(der, 'binary')
  }
}

/** Crea el Signer de la autoridad de RODAID para firmar un PDF. */
export function crearSignerRodaid(): {
  signer: Signer
  modo: FirmaModo
  autoridad: { commonName: string }
} {
  const autoridad = getAutoridad()
  return {
    signer: new RodaidAuthoritySigner(autoridad),
    modo: autoridad.modo,
    autoridad: { commonName: autoridad.commonName },
  }
}

/**
 * Calcula la huella SHA-256 (hex) de un buffer. Util para registrar la huella
 * del PDF firmado emitido (sello de integridad del documento).
 */
export function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

// ── Helpers internos ─────────────────────────────────────────────────────────

function subjectCommonName(cert: forge.pki.Certificate): string | null {
  const field = cert.subject.getField('CN') as { value?: string } | null
  return field?.value ?? null
}

/** Parsea uno o varios certificados PEM concatenados en una cadena. */
function parsePemChain(pem: string): forge.pki.Certificate[] {
  const matches = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g
  )
  if (!matches) return []
  return matches.map((m) => forge.pki.certificateFromPem(m))
}
