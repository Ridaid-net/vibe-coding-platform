import {
  createPrivateKey,
  createPublicKey,
  scryptSync,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto'
import { SignJWT, exportJWK, type JWK } from 'jose'
import { getAuthSecret } from '@/lib/marketplace'

/**
 * RODAID — Hito 16: Estandarización W3C — Verifiable Credentials (VCs).
 *
 * Expone el Certificado de Propiedad y Verificación (Hito 6) como una Credencial
 * Verificable del estándar W3C (VC Data Model 1.1), de modo que pueda guardarse y
 * verificarse en billeteras digitales universales (Apple Wallet, Google Wallet,
 * billeteras estatales, etc.).
 *
 * La credencial se entrega de dos formas:
 *   - El documento VC en JSON-LD (legible, auditable).
 *   - Su codificación VC-JWT (JWS compacto) firmada con EdDSA (Ed25519): el
 *     formato que consumen las billeteras. La clave pública se publica en un JWKS
 *     y en un documento DID (`did:web`) para que cualquier verificador externo
 *     valide la firma SIN credenciales de RODAID.
 *
 * Clave de firma:
 *   - LIVE: `RODAID_VC_SIGNING_JWK` (JWK privada OKP/Ed25519 en JSON).
 *   - Preview/sin clave: se DERIVA una clave Ed25519 ESTABLE del secreto de la
 *     app (igual que el resto de los modos del proyecto), para ejercitar el flujo
 *     de punta a punta. Al definir la JWK real, firma con esa identidad sin tocar
 *     código.
 */

// Prefijo PKCS#8 fijo de una clave privada Ed25519 (16 bytes) + 32 bytes de semilla.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

const KID = 'rodaid-vc-ed25519-1'

let cached: { privateKey: KeyObject; publicJwk: JWK } | null = null
let cachedConfigured: Promise<{ privateKey: KeyObject; publicJwk: JWK }> | null = null

/** ¿Hay una JWK de firma real configurada (vs. derivada en preview)? */
export function vcFirmaConfigurada(): boolean {
  const raw = process.env.RODAID_VC_SIGNING_JWK
  return typeof raw === 'string' && raw.trim().length > 0
}

async function resolverClave(): Promise<{ privateKey: KeyObject; publicJwk: JWK }> {
  const raw = process.env.RODAID_VC_SIGNING_JWK
  if (raw && raw.trim()) {
    if (cachedConfigured) return cachedConfigured
    cachedConfigured = (async () => {
      const jwk = JSON.parse(raw) as JWK
      const privateKey = createPrivateKey({
        key: jwk as unknown as JsonWebKey,
        format: 'jwk',
      })
      const publicJwk = await exportJWK(createPublicKey(privateKey))
      publicJwk.kid = jwk.kid ?? KID
      publicJwk.alg = 'EdDSA'
      publicJwk.use = 'sig'
      return { privateKey, publicJwk }
    })()
    return cachedConfigured
  }

  if (cached) return cached
  // Derivación estable desde el secreto de la app (preview).
  const secret = getAuthSecret() ?? 'rodaid-vc-fallback'
  const seed = scryptSync(secret, 'rodaid-vc-ed25519-v1', 32)
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed])
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  const publicJwk = await exportJWK(createPublicKey(privateKey))
  publicJwk.kid = KID
  publicJwk.alg = 'EdDSA'
  publicJwk.use = 'sig'
  cached = { privateKey, publicJwk }
  return cached
}

// ───────────────────────────────────────────────────────────────────────────
// Construccion de la credencial
// ───────────────────────────────────────────────────────────────────────────

export interface DatosCredencial {
  citId: string
  codigoCit: string
  estado: string
  hashSha256: string | null
  fechaVencimiento: string | null
  bici: {
    marca: string
    modelo: string
    tipo: string
    numeroSerie: string
    anio: number | null
    color: string | null
  }
  bfa: {
    estado: string | null
    /** 'ONCHAIN' (anclaje real) | 'STUB' (registro interno, no blockchain) | null. */
    modo: string | null
    txHash: string | null
    tokenId: string | null
    ancladoEn: string | null
  }
  /** Nombre del titular (credencial del propietario, para SU billetera). Opcional. */
  titular?: string | null
  /** Origen absoluto del emisor (para issuer/did/verifier). */
  origin: string
}

export interface CredencialVerificable {
  /** Documento W3C VC en JSON-LD. */
  vc: Record<string, unknown>
  /** Codificación VC-JWT (JWS compacto) para billeteras. */
  jwt: string
  issuer: string
  expira: string | null
}

function issuerDid(origin: string): string {
  // did:web a partir del host del emisor (estándar para publicar la clave pública).
  try {
    const host = new URL(origin).host
    return `did:web:${host}`
  } catch {
    return 'did:web:rodaid'
  }
}

/**
 * Construye la Credencial Verificable (W3C) y su VC-JWT firmado con EdDSA.
 * `credentialSubject` solo lleva el ESTADO PÚBLICO del bien; el titular se incluye
 * únicamente porque la credencial se emite para SU propia billetera.
 */
export async function emitirCredencial(datos: DatosCredencial): Promise<CredencialVerificable> {
  const { privateKey, publicJwk } = await resolverClave()
  const issuer = issuerDid(datos.origin)
  const ahora = new Date()
  const issuanceDate = ahora.toISOString()
  const expirationDate = datos.fechaVencimiento
    ? new Date(datos.fechaVencimiento).toISOString()
    : null
  const subjectId = `urn:rodaid:bike:${encodeURIComponent(datos.bici.numeroSerie)}`
  const credentialId = `urn:rodaid:cit:${datos.citId}`
  const verifierUrl = `${datos.origin.replace(/\/+$/, '')}/verificar/${encodeURIComponent(
    datos.bici.numeroSerie
  )}`

  const credentialSubject: Record<string, unknown> = {
    id: subjectId,
    type: 'Bicycle',
    serialNumber: datos.bici.numeroSerie,
    brand: datos.bici.marca,
    model: datos.bici.modelo,
    category: datos.bici.tipo,
    year: datos.bici.anio,
    color: datos.bici.color,
    verificationStatus: datos.estado === 'activo' ? 'VERIFIED' : datos.estado.toUpperCase(),
    cit: (() => {
      // Honestidad de estado (auditoria 2026-07-11): sin BFA_RPC_URL/
      // BFA_PRIVATE_KEY/BFA_CIT_CONTRACT configuradas, ningun anclaje es
      // ONCHAIN real todavia -- esta credencial es firmada y portable a
      // billeteras de terceros, asi que no puede afirmar "Blockchain Federal
      // Argentina" sin distinguir el modo.
      const onchain = datos.bfa.estado === 'ACUNADO' && datos.bfa.modo === 'ONCHAIN'
      return {
        code: datos.codigoCit,
        anchorHash: datos.hashSha256,
        blockchain: onchain
          ? 'Blockchain Federal Argentina (BFA)'
          : 'Blockchain Federal Argentina (BFA) — anclaje en proceso de habilitación institucional',
        anchorMode: datos.bfa.modo ?? 'STUB',
        anchorStatus: datos.bfa.estado,
        transactionHash: onchain ? datos.bfa.txHash : null,
        tokenId: datos.bfa.tokenId,
        anchoredAt: datos.bfa.ancladoEn,
      }
    })(),
  }
  if (datos.titular) {
    credentialSubject.holder = datos.titular
  }

  const vc: Record<string, unknown> = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      `${datos.origin.replace(/\/+$/, '')}/contexts/rodaid/v1`,
    ],
    id: credentialId,
    type: ['VerifiableCredential', 'BicycleOwnershipCredential'],
    issuer,
    name: 'RODAID — Certificado de Propiedad y Verificación',
    issuanceDate,
    ...(expirationDate ? { expirationDate } : {}),
    credentialSubject,
    credentialStatus: {
      id: verifierUrl,
      type: 'RodaidPublicVerifier2025',
    },
  }

  // VC-JWT (W3C VC Data Model 1.1, codificación JWT).
  const builder = new SignJWT({ vc })
    .setProtectedHeader({ alg: 'EdDSA', kid: publicJwk.kid as string, typ: 'JWT' })
    .setIssuer(issuer)
    .setSubject(subjectId)
    .setIssuedAt(Math.floor(ahora.getTime() / 1000))
    .setJti(credentialId)
  if (expirationDate) {
    builder.setExpirationTime(Math.floor(new Date(expirationDate).getTime() / 1000))
  }
  const jwt = await builder.sign(privateKey)

  return { vc, jwt, issuer, expira: expirationDate }
}

// ───────────────────────────────────────────────────────────────────────────
// Publicacion de la clave publica (JWKS + DID document)
// ───────────────────────────────────────────────────────────────────────────

/** JWKS público para que cualquier verificador valide los VC-JWT de RODAID. */
export async function jwksPublico(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await resolverClave()
  return { keys: [publicJwk] }
}

/** Documento DID (`did:web`) con el método de verificación Ed25519. */
export async function didDocument(origin: string): Promise<Record<string, unknown>> {
  const { publicJwk } = await resolverClave()
  const did = issuerDid(origin)
  const vmId = `${did}#${publicJwk.kid}`
  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/jws-2020/v1',
    ],
    id: did,
    verificationMethod: [
      {
        id: vmId,
        type: 'JsonWebKey2020',
        controller: did,
        publicKeyJwk: publicJwk,
      },
    ],
    assertionMethod: [vmId],
    authentication: [vmId],
  }
}
