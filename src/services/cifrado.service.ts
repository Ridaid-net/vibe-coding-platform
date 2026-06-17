import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
} from 'node:crypto'
import { getAuthSecret } from '@/lib/marketplace'

/**
 * RODAID — Hito 12: Cifrado en reposo (AES-256-GCM) para datos sensibles
 * recibidos del Ministerio de Seguridad.
 *
 * Cualquier dato personal o sensible que llegue desde la integracion
 * institucional (p. ej. el DNI del propietario en una consulta cross-reference,
 * o el payload de un aviso de recupero) se persiste SOLO cifrado, nunca en claro.
 *
 * Esquema del token (string portable, apto para una columna TEXT):
 *   v1.gcm.<iv_b64url>.<tag_b64url>.<ciphertext_b64url>
 *
 * Clave de 256 bits:
 *   - LIVE: `RODAID_MINISTERIO_AES_KEY` (32 bytes en base64 o 64 hex chars).
 *   - Preview/sin clave: se DERIVA una clave estable de 32 bytes del secreto de
 *     la aplicacion (scrypt), igual que el resto de los modos del proyecto, para
 *     ejercitar el cifrado de punta a punta sin configurar nada. Al definir la
 *     clave real, el cifrado opera con esa identidad sin tocar codigo.
 *
 * AES-256-GCM aporta confidencialidad + integridad autenticada (el tag detecta
 * cualquier manipulacion del ciphertext). Cada operacion usa un IV aleatorio de
 * 96 bits (nunca se reutiliza con la misma clave).
 */

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32
const VERSION = 'v1'

let cachedKey: Buffer | null = null
let cachedIotKey: Buffer | null = null
let cachedDenunciaKey: Buffer | null = null

/** Indica si hay una clave AES real configurada (vs. derivada en preview). */
export function cifradoConfigurado(): boolean {
  const raw = process.env.RODAID_MINISTERIO_AES_KEY
  return typeof raw === 'string' && raw.trim().length > 0
}

/** Indica si hay una clave AES real para la telemetria IoT (vs. derivada). */
export function iotCifradoConfigurado(): boolean {
  const raw = process.env.RODAID_IOT_AES_KEY
  return typeof raw === 'string' && raw.trim().length > 0
}

/** Indica si hay una clave AES real para los PDF de denuncias (vs. derivada). */
export function denunciaCifradoConfigurado(): boolean {
  const raw = process.env.RODAID_DENUNCIA_AES_KEY
  return typeof raw === 'string' && raw.trim().length > 0
}

/** Parsea la clave configurada (base64 o hex). Debe dar exactamente 32 bytes. */
function parseClaveConfigurada(raw: string): Buffer {
  const trimmed = raw.trim()
  // 64 hex chars => 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex')
  }
  const b64 = Buffer.from(trimmed, 'base64')
  if (b64.length === KEY_BYTES) {
    return b64
  }
  throw new Error(
    'RODAID_MINISTERIO_AES_KEY debe ser de 32 bytes (64 hex chars o 32 bytes en base64).'
  )
}

/** Resuelve (y cachea) la clave AES-256 de 32 bytes. */
function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.RODAID_MINISTERIO_AES_KEY
  if (raw && raw.trim().length > 0) {
    cachedKey = parseClaveConfigurada(raw)
    return cachedKey
  }
  // Preview: derivacion estable desde el secreto de la app (no romper sin config).
  const secret = getAuthSecret() ?? 'rodaid-ministerio-fallback'
  cachedKey = scryptSync(secret, 'rodaid-ministerio-aes-v1', KEY_BYTES)
  return cachedKey
}

/**
 * Resuelve (y cachea) la clave AES-256 de la TELEMETRIA IoT (Hito 17). Es una
 * clave INDEPENDIENTE de la del Ministerio: la posicion precisa de la bici se
 * cifra de extremo a extremo con su propia identidad criptografica. En LIVE se
 * toma de `RODAID_IOT_AES_KEY`; en preview se deriva de forma estable del secreto
 * de la app (igual que el resto de los modos del proyecto).
 */
function getIotKey(): Buffer {
  if (cachedIotKey) return cachedIotKey
  const raw = process.env.RODAID_IOT_AES_KEY
  if (raw && raw.trim().length > 0) {
    cachedIotKey = parseClaveConfigurada(raw)
    return cachedIotKey
  }
  const secret = getAuthSecret() ?? 'rodaid-iot-fallback'
  cachedIotKey = scryptSync(secret, 'rodaid-iot-aes-v1', KEY_BYTES)
  return cachedIotKey
}

/**
 * Resuelve (y cachea) la clave AES-256 del BUCKET CIFRADO de denuncias del MPF
 * (Hito 18). Es una clave INDEPENDIENTE: el PDF oficial de la denuncia se guarda
 * cifrado en reposo con su propia identidad criptografica. En LIVE se toma de
 * `RODAID_DENUNCIA_AES_KEY`; en preview se deriva de forma estable del secreto de
 * la app (igual que el resto de los modos del proyecto).
 */
function getDenunciaKey(): Buffer {
  if (cachedDenunciaKey) return cachedDenunciaKey
  const raw = process.env.RODAID_DENUNCIA_AES_KEY
  if (raw && raw.trim().length > 0) {
    cachedDenunciaKey = parseClaveConfigurada(raw)
    return cachedDenunciaKey
  }
  const secret = getAuthSecret() ?? 'rodaid-denuncia-fallback'
  cachedDenunciaKey = scryptSync(secret, 'rodaid-denuncia-aes-v1', KEY_BYTES)
  return cachedDenunciaKey
}

/** Cifra un texto en claro con una clave dada. Devuelve el token portable. */
function cifrarCon(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    'gcm',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join('.')
}

/** Descifra un token producido por `cifrarCon`. Lanza si fue manipulado. */
function descifrarCon(key: Buffer, token: string): string {
  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== VERSION || parts[1] !== 'gcm') {
    throw new Error('Token de cifrado con formato invalido.')
  }
  const iv = Buffer.from(parts[2], 'base64url')
  const tag = Buffer.from(parts[3], 'base64url')
  const ct = Buffer.from(parts[4], 'base64url')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** Cifra un texto en claro. Devuelve el token portable. */
export function cifrar(plaintext: string): string {
  return cifrarCon(getKey(), plaintext)
}

/** Cifra un valor opcional (null -> null). */
export function cifrarOpcional(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null
  return cifrar(plaintext)
}

/** Descifra un token producido por `cifrar`. Lanza si fue manipulado o es invalido. */
export function descifrar(token: string): string {
  return descifrarCon(getKey(), token)
}

// ── Telemetria IoT (Hito 17): cifrado E2E de la posicion precisa ──────────────

/** Cifra un texto con la clave de telemetria IoT (posicion precisa, E2E). */
export function cifrarIot(plaintext: string): string {
  return cifrarCon(getIotKey(), plaintext)
}

/** Cifra un valor opcional con la clave IoT (null -> null). */
export function cifrarIotOpcional(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null
  return cifrarIot(plaintext)
}

/** Descifra un token de telemetria IoT. Lanza si fue manipulado o es invalido. */
export function descifrarIot(token: string): string {
  return descifrarCon(getIotKey(), token)
}

// ── Bucket cifrado de denuncias del MPF (Hito 18): cifrado binario en reposo ──

/**
 * Formato del contenedor binario cifrado de un PDF en el bucket:
 *   [1 byte version=1][12 bytes IV][16 bytes tag GCM][ciphertext...]
 * AES-256-GCM aporta confidencialidad + integridad: si el blob fue manipulado,
 * el descifrado falla. Cada operacion usa un IV aleatorio de 96 bits.
 */
const BIN_VERSION = 1
const TAG_BYTES = 16

/**
 * Cifra un buffer (p. ej. el PDF de la denuncia) para guardarlo en el bucket
 * CIFRADO. Devuelve el contenedor binario portable (version + IV + tag + ct).
 */
export function cifrarBytesDenuncia(plain: Buffer | Uint8Array): Buffer {
  const key = getDenunciaKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([BIN_VERSION]), iv, tag, ct])
}

/**
 * Descifra un contenedor binario producido por `cifrarBytesDenuncia`. Lanza si
 * el formato es invalido o el contenido fue manipulado.
 */
export function descifrarBytesDenuncia(blob: Buffer | Uint8Array): Buffer {
  const buf = Buffer.from(blob)
  if (buf.length < 1 + IV_BYTES + TAG_BYTES || buf[0] !== BIN_VERSION) {
    throw new Error('Contenedor cifrado de denuncia con formato invalido.')
  }
  const iv = buf.subarray(1, 1 + IV_BYTES)
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const ct = buf.subarray(1 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGO, getDenunciaKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

/**
 * Hash NO reversible de un dato sensible (HMAC-SHA256 con clave del servidor),
 * para correlacionar consultas sin almacenar el dato en claro. A diferencia del
 * cifrado, no permite recuperar el valor original.
 */
export function hashSensible(value: string): string {
  const secret = getAuthSecret() ?? 'rodaid-ministerio-fallback'
  return createHmac('sha256', `${secret}:ministerio`).update(value).digest('hex')
}

/** Huella corta (sha256 hex) de un buffer/cadena — uso en metadatos no sensibles. */
export function huellaCorta(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
