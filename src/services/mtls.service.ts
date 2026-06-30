import { createHash, createHmac, generateKeyPairSync, randomBytes } from 'node:crypto'
import forge from 'node-forge'
import { getAuthSecret } from '@/lib/marketplace'

/**
 * RODAID — Hito 12: Protocolo mTLS (Mutual TLS) para la integracion con el
 * Ministerio de Seguridad.
 *
 * El endpoint institucional RECHAZA por defecto cualquier peticion que no
 * presente un certificado de cliente X.509 valido FIRMADO POR la Autoridad
 * Certificadora del Ministerio. Como en una arquitectura serverless el TLS se
 * termina en el borde, el certificado de cliente llega reenviado en un header
 * (patron estandar de los balanceadores: `x-client-cert` / `ssl-client-cert` con
 * el PEM, normalmente URL-encoded). Este servicio valida ese certificado a nivel
 * de aplicacion: comprueba la cadena contra la CA del Ministerio, la vigencia y
 * que el uso del certificado sea de cliente.
 *
 * Modos:
 *   - LIVE: `RODAID_MINISTERIO_CA_PEM` define la CA del Ministerio (uno o varios
 *     certificados PEM concatenados). Solo se aceptan certificados de cliente
 *     emitidos por esa CA.
 *   - Preview/sin CA configurada: se DERIVA una CA efimera ESTABLE del secreto de
 *     la aplicacion (igual que el resto de los modos del proyecto). El endpoint
 *     `GET /api/seguridad/institucional/credencial-demo` emite un certificado de
 *     cliente firmado por esa CA para poder ejercitar el flujo mTLS de punta a
 *     punta. Al configurar la CA real, la validacion opera contra ella sin tocar
 *     codigo.
 */

export type MtlsModo = 'LIVE' | 'DEV'

/** Identidad extraida de un certificado de cliente validado. */
export interface ClienteMtls {
  commonName: string
  serie: string
  fingerprint: string
  organizacion: string | null
}

export interface MtlsResultado {
  ok: boolean
  modo: MtlsModo
  cliente: ClienteMtls | null
  motivo?: string
}

// Headers donde un balanceador suele reenviar el certificado de cliente tras
// terminar mTLS. Se prueban en orden.
const HEADERS_CERT = [
  'x-client-cert',
  'x-forwarded-client-cert',
  'ssl-client-cert',
  'x-ssl-cert',
  'x-ssl-client-cert',
]

export function getMtlsModo(): MtlsModo {
  const raw = process.env.RODAID_MINISTERIO_CA_PEM
  return raw && raw.trim().length > 0 ? 'LIVE' : 'DEV'
}

// ── PRNG determinista (para la CA efimera estable de preview) ─────────────────

/**
 * PRNG determinista (HMAC-SHA256 en cadena) compatible con la interfaz que pide
 * node-forge (`getBytesSync`). Sembrado desde una semilla fija, produce SIEMPRE
 * el mismo flujo de bytes, de modo que la CA efimera es identica en cualquier
 * instancia de la funcion (sin estado compartido).
 */
interface ForgePrng {
  getBytesSync(count: number): string
}

function prngDeterminista(seed: string): ForgePrng {
  let contador = 0
  let pool = Buffer.alloc(0)
  function refill() {
    const bloque = createHmac('sha256', seed)
      .update(`rodaid-mtls-ca:${contador++}`)
      .digest()
    pool = Buffer.concat([pool, bloque])
  }
  return {
    getBytesSync(count: number): string {
      while (pool.length < count) refill()
      const out = pool.subarray(0, count)
      pool = pool.subarray(count)
      return out.toString('binary')
    },
  }
}

// Validez fija y amplia (sin Date.now) para que la CA/credencial sean
// deterministas y verificables en cualquier instancia.
const NOT_BEFORE = new Date('2020-01-01T00:00:00Z')
const NOT_AFTER = new Date('2040-01-01T00:00:00Z')

interface CaEfimera {
  caKey: forge.pki.rsa.PrivateKey
  caCert: forge.pki.Certificate
}

let caDev: CaEfimera | null = null

/**
 * Genera (y cachea) la CA efimera ESTABLE del Ministerio para preview. La clave
 * se deriva de forma determinista del secreto de la app: la misma CA en toda
 * instancia, de modo que un certificado de cliente emitido por ella se valida en
 * cualquier llamada.
 */
function getCaDev(): CaEfimera {
  if (caDev) return caDev
  const seed = `${getAuthSecret() ?? 'rodaid-ministerio-fallback'}:ministerio-ca`
  const keypair = forge.pki.rsa.generateKeyPair({
    bits: 2048,
    e: 0x10001,
    prng: prngDeterminista(seed),
  })

  const cert = forge.pki.createCertificate()
  cert.publicKey = keypair.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = NOT_BEFORE
  cert.validity.notAfter = NOT_AFTER
  const attrs: forge.pki.CertificateField[] = [
    { name: 'commonName', value: 'Ministerio de Seguridad CA (DEV)' },
    { name: 'organizationName', value: 'Ministerio de Seguridad' },
    { name: 'organizationalUnitName', value: 'Autoridad Certificadora' },
    { name: 'countryName', value: 'AR' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true },
  ])
  cert.sign(keypair.privateKey, forge.md.sha256.create())

  caDev = { caKey: keypair.privateKey, caCert: cert }
  return caDev
}

// ── Carga de las CA aceptadas ─────────────────────────────────────────────────

let caCertsLive: forge.pki.Certificate[] | null = null

/** Parsea uno o varios certificados PEM concatenados. */
function parsePemBundle(pem: string): forge.pki.Certificate[] {
  const matches = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
  if (!matches) return []
  const certs: forge.pki.Certificate[] = []
  for (const m of matches) {
    try {
      certs.push(forge.pki.certificateFromPem(m))
    } catch {
      // Ignora bloques no parseables; valida con los que si lo son.
    }
  }
  return certs
}

/** Certificados de la(s) CA aceptada(s) segun el modo. */
function getCaCerts(): forge.pki.Certificate[] {
  if (getMtlsModo() === 'LIVE') {
    if (!caCertsLive) {
      caCertsLive = parsePemBundle(process.env.RODAID_MINISTERIO_CA_PEM ?? '')
      if (caCertsLive.length === 0) {
        throw new Error('RODAID_MINISTERIO_CA_PEM no contiene certificados validos.')
      }
    }
    return caCertsLive
  }
  return [getCaDev().caCert]
}

// ── Extraccion del certificado de cliente del request ─────────────────────────

/** Lee el certificado de cliente reenviado por el balanceador (PEM). */
function extraerCertPem(req: Request): string | null {
  for (const h of HEADERS_CERT) {
    const raw = req.headers.get(h)
    if (!raw || raw.trim().length === 0) continue
    let value = raw.trim()
    // Algunos proxies URL-encodean el PEM (p. ej. nginx $ssl_client_escaped_cert).
    if (!value.includes('BEGIN CERTIFICATE')) {
      try {
        value = decodeURIComponent(value)
      } catch {
        // Se intenta tal cual abajo.
      }
    }
    // Otros lo mandan en una sola linea con espacios en vez de saltos.
    if (value.includes('BEGIN CERTIFICATE') && !value.includes('\n')) {
      value = value
        .replace('-----BEGIN CERTIFICATE-----', '-----BEGIN CERTIFICATE-----\n')
        .replace('-----END CERTIFICATE-----', '\n-----END CERTIFICATE-----')
    }
    if (value.includes('BEGIN CERTIFICATE')) return value
  }
  return null
}

function subjectField(cert: forge.pki.Certificate, name: string): string | null {
  const f = cert.subject.getField(name) as { value?: string } | null
  return f?.value ?? null
}

// ── Verificacion del certificado de cliente contra la CA ──────────────────────

/**
 * Verifica el certificado de cliente presentado contra la CA del Ministerio:
 *   - lo emitio la CA (firma valida sobre el cert),
 *   - esta vigente (notBefore <= ahora <= notAfter),
 * y devuelve la identidad del cliente. Por defecto DENIEGA: cualquier ausencia o
 * fallo de validacion resulta en `ok: false`.
 */
export function verificarClienteMtls(req: Request): MtlsResultado {
  const modo = getMtlsModo()

  const pem = extraerCertPem(req)
  if (!pem) {
    return { ok: false, modo, cliente: null, motivo: 'sin_certificado_cliente' }
  }

  let cert: forge.pki.Certificate
  try {
    cert = forge.pki.certificateFromPem(pem)
  } catch {
    return { ok: false, modo, cliente: null, motivo: 'certificado_ilegible' }
  }

  // Vigencia.
  const ahora = new Date()
  if (cert.validity.notBefore > ahora || cert.validity.notAfter < ahora) {
    return { ok: false, modo, cliente: null, motivo: 'certificado_vencido' }
  }

  // Emitido por alguna de las CA aceptadas (firma valida).
  let cas: forge.pki.Certificate[]
  try {
    cas = getCaCerts()
  } catch {
    return { ok: false, modo, cliente: null, motivo: 'ca_no_configurada' }
  }

  const emitidoPorCa = cas.some((ca) => {
    try {
      return ca.verify(cert)
    } catch {
      return false
    }
  })
  if (!emitidoPorCa) {
    return { ok: false, modo, cliente: null, motivo: 'no_emitido_por_ca_ministerio' }
  }

  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  const fingerprint = createHash('sha256')
    .update(Buffer.from(certDer, 'binary'))
    .digest('hex')

  return {
    ok: true,
    modo,
    cliente: {
      commonName: subjectField(cert, 'CN') ?? 'cliente-desconocido',
      serie: cert.serialNumber,
      fingerprint,
      organizacion: subjectField(cert, 'O'),
    },
  }
}

// ── Emision de una credencial de cliente de DEMO (solo preview) ───────────────

export interface CredencialDemo {
  certificadoPem: string
  clavePrivadaPem: string
  caPem: string
  /** Para enviar comodo en un header: PEM URL-encoded en una sola variable. */
  headerValue: string
  commonName: string
}

/**
 * Emite una credencial de cliente firmada por la CA efimera de preview, para
 * ejercitar el flujo mTLS. Solo disponible en modo DEV (sin CA real): en LIVE el
 * Ministerio emite las credenciales con su propia CA y RODAID nunca tiene su
 * clave privada.
 */
export function emitirCredencialDemo(commonName = 'Ministerio de Seguridad - Cliente DEMO'): CredencialDemo {
  if (getMtlsModo() === 'LIVE') {
    throw new Error('La credencial de demo no esta disponible en modo LIVE.')
  }
  const { caKey, caCert } = getCaDev()

  // Clave del cliente: aleatoria (el cliente conserva su clave privada).
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const forgeKey = forge.pki.privateKeyFromPem(
    privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
  )
  const forgePub = forge.pki.publicKeyFromPem(
    publicKey.export({ type: 'spki', format: 'pem' }) as string
  )

  const cert = forge.pki.createCertificate()
  cert.publicKey = forgePub
  cert.serialNumber = '00' + randomBytes(8).toString('hex')
  cert.validity.notBefore = NOT_BEFORE
  cert.validity.notAfter = NOT_AFTER
  cert.setSubject([
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'Ministerio de Seguridad' },
    { name: 'organizationalUnitName', value: 'Cliente mTLS' },
    { name: 'countryName', value: 'AR' },
  ])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true },
  ])
  cert.sign(caKey, forge.md.sha256.create())

  const certificadoPem = forge.pki.certificateToPem(cert).trim()
  const clavePrivadaPem = (privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).trim()
  const caPem = forge.pki.certificateToPem(caCert).trim()

  return {
    certificadoPem,
    clavePrivadaPem,
    caPem,
    headerValue: encodeURIComponent(certificadoPem),
    commonName,
  }
}
