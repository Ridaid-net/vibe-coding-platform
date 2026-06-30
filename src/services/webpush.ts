/**
 * RODAID — Hito 10: Web Push API (VAPID) sin librerias externas pesadas.
 *
 * Implementa el protocolo de Web Push de extremo a extremo apoyandose solo en
 * `node:crypto` y en `jose` (que el proyecto ya usa para los JWT de sesion):
 *
 *   1. VAPID (RFC 8292): identifica al servidor de aplicacion ante el push
 *      service con un JWT firmado en ES256 (curva P-256). El navegador autoriza
 *      la suscripcion contra la clave publica VAPID (applicationServerKey).
 *   2. Cifrado del payload (RFC 8291, content-encoding `aes128gcm`, RFC 8188):
 *      ECDH P-256 con la clave publica de la suscripcion + HKDF + AES-128-GCM,
 *      de modo que SOLO ese navegador pueda descifrar el mensaje.
 *
 * Claves VAPID:
 *   - Produccion: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (base64url, P-256) y
 *     `VAPID_SUBJECT` (mailto: o https://). Generables con `web-push generate-vapid-keys`
 *     o con `crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })`.
 *   - Preview/DEV: si no estan configuradas se derivan de forma determinista del
 *     secreto de autenticacion, para ejercitar el flujo de punta a punta sin
 *     credenciales (igual que el resto de los modos simulados del proyecto). La
 *     clave publica y la privada SIEMPRE provienen del mismo par, asi el
 *     `applicationServerKey` con el que el navegador se suscribe coincide con la
 *     firma del backend.
 */

import {
  createECDH,
  createHash,
  createCipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import { SignJWT, importJWK } from 'jose'
import { getAuthSecret } from '@/lib/marketplace'

const CURVE = 'prime256v1'

// ---------------------------------------------------------------------------
// Codificacion base64url <-> Buffer
// ---------------------------------------------------------------------------

function b64urlToBuffer(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

function bufferToB64url(buf: Buffer): string {
  return buf.toString('base64url')
}

// ---------------------------------------------------------------------------
// Claves VAPID (P-256)
// ---------------------------------------------------------------------------

export interface VapidKeys {
  /** Clave publica sin comprimir (65 bytes: 0x04 || X || Y) en base64url. */
  publicKey: string
  /** Escalar privado (32 bytes) en base64url. */
  privateKey: string
  /** `sub` del JWT VAPID (mailto:/https). */
  subject: string
  /** `true` si las claves provienen de variables de entorno (no DEV). */
  configured: boolean
}

let cachedKeys: VapidKeys | null = null

/**
 * Deriva un par de claves P-256 determinista a partir de una semilla. Se usa
 * solo en preview/DEV: el escalar privado es `SHA-256(semilla)` (en [1, n-1] con
 * probabilidad practicamente 1), y la publica se computa con ECDH.
 */
function derivarParDeterminista(seed: string): { publicKey: Buffer; privateKey: Buffer } {
  const priv = createHash('sha256').update(`rodaid:vapid:${seed}`).digest()
  const ecdh = createECDH(CURVE)
  ecdh.setPrivateKey(priv)
  return { publicKey: ecdh.getPublicKey(), privateKey: priv }
}

/** Resuelve las claves VAPID (de entorno o derivadas en DEV) una sola vez. */
export function getVapidKeys(): VapidKeys {
  if (cachedKeys) {
    return cachedKeys
  }

  const subject =
    process.env.VAPID_SUBJECT?.trim() || 'mailto:soporte@rodaid.app'
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim()
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim()

  if (envPublic && envPrivate) {
    cachedKeys = {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject,
      configured: true,
    }
    return cachedKeys
  }

  // DEV/preview: par determinista a partir del secreto de autenticacion. Si ni
  // siquiera hay secreto (LIVE sin VAPID), usamos una semilla fija de marca: el
  // flujo igual queda operativo en preview.
  const seed = getAuthSecret() ?? 'rodaid-preview'
  const { publicKey, privateKey } = derivarParDeterminista(seed)
  cachedKeys = {
    publicKey: bufferToB64url(publicKey),
    privateKey: bufferToB64url(privateKey),
    subject,
    configured: false,
  }
  return cachedKeys
}

/** Clave publica VAPID (applicationServerKey) en base64url para el cliente. */
export function getVapidPublicKey(): string {
  return getVapidKeys().publicKey
}

// ---------------------------------------------------------------------------
// Cabecera de Authorization VAPID (RFC 8292)
// ---------------------------------------------------------------------------

/**
 * Construye el JWT VAPID y la cabecera `Authorization: vapid t=<jwt>, k=<pub>`
 * para un `audience` (el origen del endpoint, p. ej. https://fcm.googleapis.com).
 */
async function buildVapidAuthHeader(audience: string): Promise<string> {
  const keys = getVapidKeys()
  const pub = b64urlToBuffer(keys.publicKey)
  const priv = b64urlToBuffer(keys.privateKey)
  // La publica sin comprimir es 0x04 || X(32) || Y(32).
  const x = bufferToB64url(pub.subarray(1, 33))
  const y = bufferToB64url(pub.subarray(33, 65))
  const d = bufferToB64url(priv)

  const key = await importJWK({ kty: 'EC', crv: 'P-256', x, y, d }, 'ES256')
  const jwt = await new SignJWT({})
    .setProtectedHeader({ typ: 'JWT', alg: 'ES256' })
    .setAudience(audience)
    .setSubject(keys.subject)
    // VAPID exige exp <= 24h; usamos 12h.
    .setExpirationTime('12h')
    .sign(key)

  return `vapid t=${jwt}, k=${keys.publicKey}`
}

// ---------------------------------------------------------------------------
// Cifrado del payload (RFC 8291 / aes128gcm RFC 8188)
// ---------------------------------------------------------------------------

const RECORD_SIZE = 4096

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length))
}

function infoBuffer(label: string): Buffer {
  // "Content-Encoding: <label>\0" (RFC 8188).
  return Buffer.concat([
    Buffer.from(`Content-Encoding: ${label}`, 'utf8'),
    Buffer.from([0]),
  ])
}

/**
 * Cifra `payload` para una suscripcion (claves p256dh/auth en base64url) con el
 * content-encoding `aes128gcm`. Devuelve el cuerpo binario listo para el POST.
 */
function encryptPayload(
  payload: Buffer,
  p256dhB64: string,
  authB64: string
): Buffer {
  const userPublic = b64urlToBuffer(p256dhB64) // 65 bytes (0x04||X||Y)
  const authSecret = b64urlToBuffer(authB64) // 16 bytes

  // Par efimero del servidor de aplicacion (as_) para este mensaje.
  const localEcdh = createECDH(CURVE)
  const asPublic = localEcdh.generateKeys() // 65 bytes
  const ecdhSecret = localEcdh.computeSecret(userPublic) // 32 bytes

  // RFC 8291: IKM = HKDF(salt=auth_secret, ikm=ecdh_secret, info=key_info, 32).
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info', 'utf8'),
    Buffer.from([0]),
    userPublic,
    asPublic,
  ])
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32)

  // RFC 8188 (aes128gcm): CEK y NONCE a partir de un salt de 16 bytes.
  const salt = randomBytes(16)
  const cek = hkdf(salt, ikm, infoBuffer('aes128gcm'), 16)
  const nonce = hkdf(salt, ikm, infoBuffer('nonce'), 12)

  // Un unico record: plaintext || 0x02 (delimitador de ultimo record).
  const plaintext = Buffer.concat([payload, Buffer.from([0x02])])
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  // Cabecera del content-encoding: salt(16) || rs(4 BE) || idlen(1) || keyid.
  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(RECORD_SIZE, 0)
  const idlen = Buffer.from([asPublic.length])
  const header = Buffer.concat([salt, rs, idlen, asPublic])

  return Buffer.concat([header, encrypted, tag])
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export interface PushSubscriptionData {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushResult {
  ok: boolean
  statusCode: number
  /** `true` si el push service indica que la suscripcion ya no es valida. */
  gone: boolean
  error?: string
}

/**
 * Envia una notificacion push a una suscripcion. `payload` es el objeto JSON que
 * el service worker recibira en el evento `push`. Best-effort: no lanza; informa
 * el resultado (incl. `gone` para 404/410, que el llamador usa para purgar la
 * suscripcion muerta).
 */
export async function sendPushNotification(
  subscription: PushSubscriptionData,
  payload: unknown,
  options: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {}
): Promise<PushResult> {
  try {
    const url = new URL(subscription.endpoint)
    const audience = `${url.protocol}//${url.host}`
    const body = encryptPayload(
      Buffer.from(JSON.stringify(payload), 'utf8'),
      subscription.p256dh,
      subscription.auth
    )
    const authorization = await buildVapidAuthHeader(audience)

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.ttl ?? 60 * 60 * 24),
        Urgency: options.urgency ?? 'normal',
      },
      body: body as unknown as BodyInit,
    })

    const gone = res.status === 404 || res.status === 410
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return {
        ok: false,
        statusCode: res.status,
        gone,
        error: detail.slice(0, 300) || `HTTP ${res.status}`,
      }
    }
    return { ok: true, statusCode: res.status, gone: false }
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      gone: false,
      error: (error as Error).message,
    }
  }
}
