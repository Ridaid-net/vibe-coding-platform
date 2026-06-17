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

/** Indica si hay una clave AES real configurada (vs. derivada en preview). */
export function cifradoConfigurado(): boolean {
  const raw = process.env.RODAID_MINISTERIO_AES_KEY
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

/** Cifra un texto en claro. Devuelve el token portable. */
export function cifrar(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, getKey(), iv)
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

/** Cifra un valor opcional (null -> null). */
export function cifrarOpcional(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null
  return cifrar(plaintext)
}

/** Descifra un token producido por `cifrar`. Lanza si fue manipulado o es invalido. */
export function descifrar(token: string): string {
  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== VERSION || parts[1] !== 'gcm') {
    throw new Error('Token de cifrado con formato invalido.')
  }
  const iv = Buffer.from(parts[2], 'base64url')
  const tag = Buffer.from(parts[3], 'base64url')
  const ct = Buffer.from(parts[4], 'base64url')
  const decipher = createDecipheriv(ALGO, getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
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
