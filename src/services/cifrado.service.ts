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
let cachedInspeccionKey: Buffer | null = null
let cachedStravaKey: Buffer | null = null
let cachedSpotifyKey: Buffer | null = null
let cachedAutorizadosKey: Buffer | null = null
let cachedDisputaKey: Buffer | null = null
let cachedReclamoKey: Buffer | null = null
let cachedImpugnacionKey: Buffer | null = null

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

/** Indica si hay una clave AES real para las fotos de componentes de inspeccion (vs. derivada). */
export function inspeccionCifradoConfigurado(): boolean {
  const raw = process.env.RODAID_INSPECCION_AES_KEY
  return typeof raw === 'string' && raw.trim().length > 0
}

/** Indica si hay una clave AES real para los tokens OAuth de Strava (vs. derivada). */
export function stravaCifradoConfigurado(): boolean {
  const raw = process.env.RODAID_STRAVA_AES_KEY
  return typeof raw === 'string' && raw.trim().length > 0
}

/** Indica si hay una clave AES real para los tokens OAuth de Spotify (vs. derivada). */
export function spotifyCifradoConfigurado(): boolean {
  const raw = process.env.RODAID_SPOTIFY_AES_KEY
  return typeof raw === 'string' && raw.trim().length > 0
}

/** Indica si hay una clave AES real para el DNI/direccion de "Uso autorizado" (vs. derivada). */
export function autorizadosCifradoConfigurado(): boolean {
  const raw = process.env.RODAID_AUTORIZADOS_AES_KEY
  return typeof raw === 'string' && raw.trim().length > 0
}

/** Indica si hay una clave AES real para la evidencia de disputas de CIT Completo (vs. derivada). */
export function disputaCifradoConfigurado(): boolean {
  const raw = process.env.RODAID_DISPUTA_AES_KEY
  return typeof raw === 'string' && raw.trim().length > 0
}

/** Indica si hay una clave AES real para la evidencia de reclamos de titularidad (Esquema 3, vs. derivada). */
export function reclamoCifradoConfigurado(): boolean {
  const raw = process.env.RODAID_RECLAMO_AES_KEY
  return typeof raw === 'string' && raw.trim().length > 0
}

/** Indica si hay una clave AES real para la evidencia de impugnaciones de denuncia (Esquema 4, vs. derivada). */
export function impugnacionCifradoConfigurado(): boolean {
  const raw = process.env.RODAID_IMPUGNACION_AES_KEY
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

/**
 * Resuelve (y cachea) la clave AES-256 del BUCKET CIFRADO de fotos de
 * componentes tokenizados (Checklist de 20 puntos, "CIT Completo Plus"). Es
 * una clave INDEPENDIENTE de la de denuncias -- NO reusa getDenunciaKey(),
 * a proposito, mismo criterio que separa la clave de telemetria IoT de la
 * del Ministerio: cada bucket cifrado tiene su propia identidad
 * criptografica. En LIVE se toma de `RODAID_INSPECCION_AES_KEY`; en preview
 * se deriva de forma estable del secreto de la app (igual que el resto de
 * los modos del proyecto).
 */
function getInspeccionKey(): Buffer {
  if (cachedInspeccionKey) return cachedInspeccionKey
  const raw = process.env.RODAID_INSPECCION_AES_KEY
  if (raw && raw.trim().length > 0) {
    cachedInspeccionKey = parseClaveConfigurada(raw)
    return cachedInspeccionKey
  }
  const secret = getAuthSecret() ?? 'rodaid-inspeccion-fallback'
  cachedInspeccionKey = scryptSync(secret, 'rodaid-inspeccion-aes-v1', KEY_BYTES)
  return cachedInspeccionKey
}

/**
 * Resuelve (y cachea) la clave AES-256 de los tokens OAuth de Strava (Hito 17
 * BYOD). Es una clave INDEPENDIENTE -- el access_token/refresh_token de un
 * usuario da acceso activo en su nombre a la API de Strava (no solo datos
 * SOBRE el usuario, como el resto de los buckets cifrados), asi que merece
 * su propia identidad criptografica igual que las demas. En LIVE se toma de
 * `RODAID_STRAVA_AES_KEY`; en preview se deriva de forma estable del secreto
 * de la app (igual que el resto de los modos del proyecto).
 */
function getStravaKey(): Buffer {
  if (cachedStravaKey) return cachedStravaKey
  const raw = process.env.RODAID_STRAVA_AES_KEY
  if (raw && raw.trim().length > 0) {
    cachedStravaKey = parseClaveConfigurada(raw)
    return cachedStravaKey
  }
  const secret = getAuthSecret() ?? 'rodaid-strava-fallback'
  cachedStravaKey = scryptSync(secret, 'rodaid-strava-aes-v1', KEY_BYTES)
  return cachedStravaKey
}

/** Cifra un token OAuth de Strava (access_token o refresh_token). */
export function cifrarStrava(plaintext: string): string {
  return cifrarCon(getStravaKey(), plaintext)
}

/** Descifra un token producido por `cifrarStrava`. Lanza si el formato es invalido. */
export function descifrarStrava(token: string): string {
  return descifrarCon(getStravaKey(), token)
}

/**
 * Descifra un token de Strava tolerando filas legadas en texto plano (creadas
 * antes de que este cifrado existiera). Si `descifrarStrava` falla por
 * formato invalido, asume que el valor es el token crudo de Strava y lo
 * devuelve tal cual con `eraLegado: true` -- el caller debe re-guardarlo
 * cifrado en ese mismo paso para que la fila se auto-migre. NO usar esto
 * para nada que no sea "texto plano legado conocido" -- cualquier otro
 * fallo de formato (dato corrupto/manipulado) queda enmascarado igual que
 * un legado real.
 */
export function descifrarStravaSeguro(valor: string): { texto: string; eraLegado: boolean } {
  try {
    return { texto: descifrarStrava(valor), eraLegado: false }
  } catch {
    return { texto: valor, eraLegado: true }
  }
}

/**
 * Resuelve (y cachea) la clave AES-256 de los tokens OAuth de Spotify. Es una
 * clave INDEPENDIENTE de la de Strava -- mismo criterio de "una identidad
 * criptografica por dominio" ya establecido para el resto de los buckets
 * cifrados de este archivo. Cifrada desde el dia uno: a diferencia de Strava,
 * esta conexion nunca tuvo filas en texto plano, asi que no hace falta un
 * equivalente a `descifrarStravaSeguro` (sin legado que tolerar). En LIVE se
 * toma de `RODAID_SPOTIFY_AES_KEY`; en preview se deriva de forma estable del
 * secreto de la app (igual que el resto de los modos del proyecto).
 */
function getSpotifyKey(): Buffer {
  if (cachedSpotifyKey) return cachedSpotifyKey
  const raw = process.env.RODAID_SPOTIFY_AES_KEY
  if (raw && raw.trim().length > 0) {
    cachedSpotifyKey = parseClaveConfigurada(raw)
    return cachedSpotifyKey
  }
  const secret = getAuthSecret() ?? 'rodaid-spotify-fallback'
  cachedSpotifyKey = scryptSync(secret, 'rodaid-spotify-aes-v1', KEY_BYTES)
  return cachedSpotifyKey
}

/** Cifra un token OAuth de Spotify (access_token o refresh_token). */
export function cifrarSpotify(plaintext: string): string {
  return cifrarCon(getSpotifyKey(), plaintext)
}

/** Descifra un token producido por `cifrarSpotify`. Lanza si el formato es invalido. */
export function descifrarSpotify(token: string): string {
  return descifrarCon(getSpotifyKey(), token)
}

/**
 * Resuelve (y cachea) la clave AES-256 del DNI/direccion de personas con
 * "Uso autorizado" de una bici (Garaje Digital). Es una clave INDEPENDIENTE
 * -- mismo criterio de "una identidad criptografica por dominio" que el
 * resto de este archivo. Solo se descifra en dos contextos: el propio dueño
 * viendo su Garaje, o el canal gov/verificar cuando tenantSlug ==
 * 'ministerio_seguridad' -- nunca en el verificador publico. En LIVE se
 * toma de `RODAID_AUTORIZADOS_AES_KEY`; en preview se deriva de forma
 * estable del secreto de la app (igual que el resto de los modos).
 */
function getAutorizadosKey(): Buffer {
  if (cachedAutorizadosKey) return cachedAutorizadosKey
  const raw = process.env.RODAID_AUTORIZADOS_AES_KEY
  if (raw && raw.trim().length > 0) {
    cachedAutorizadosKey = parseClaveConfigurada(raw)
    return cachedAutorizadosKey
  }
  const secret = getAuthSecret() ?? 'rodaid-autorizados-fallback'
  cachedAutorizadosKey = scryptSync(secret, 'rodaid-autorizados-aes-v1', KEY_BYTES)
  return cachedAutorizadosKey
}

/** Cifra un dato (DNI o direccion) de una persona con Uso autorizado. */
export function cifrarAutorizado(plaintext: string): string {
  return cifrarCon(getAutorizadosKey(), plaintext)
}

/** Descifra un valor producido por `cifrarAutorizado`. Lanza si fue manipulado. */
export function descifrarAutorizado(token: string): string {
  return descifrarCon(getAutorizadosKey(), token)
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

// ── Bucket cifrado de fotos de componentes (Checklist 20 puntos) ──────────────

/**
 * Cifra un buffer (foto de un componente tokenizado) para guardarlo en su
 * bucket CIFRADO. Mismo formato de contenedor binario que
 * `cifrarBytesDenuncia` (version + IV + tag + ciphertext), pero con la clave
 * INDEPENDIENTE de este bucket -- no reusar `cifrarBytesDenuncia` tal cual,
 * usaria la clave equivocada.
 */
export function cifrarBytesInspeccion(plain: Buffer | Uint8Array): Buffer {
  const key = getInspeccionKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([BIN_VERSION]), iv, tag, ct])
}

/**
 * Descifra un contenedor binario producido por `cifrarBytesInspeccion`.
 * Lanza si el formato es invalido o el contenido fue manipulado.
 */
export function descifrarBytesInspeccion(blob: Buffer | Uint8Array): Buffer {
  const buf = Buffer.from(blob)
  if (buf.length < 1 + IV_BYTES + TAG_BYTES || buf[0] !== BIN_VERSION) {
    throw new Error('Contenedor cifrado de inspeccion con formato invalido.')
  }
  const iv = buf.subarray(1, 1 + IV_BYTES)
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const ct = buf.subarray(1 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGO, getInspeccionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

// ── Bucket cifrado de evidencia de disputas de CIT Completo (Esquema 1 Caso B) ─

/**
 * Resuelve (y cachea) la clave AES-256 de la evidencia de disputas
 * (capturas, chats, comprobantes de pago que suben comprador/vendedor). Clave
 * INDEPENDIENTE, mismo criterio que el resto del archivo -- esta evidencia
 * puede contener datos personales de terceros ademas de las propias partes.
 * En LIVE se toma de `RODAID_DISPUTA_AES_KEY`; en preview se deriva de forma
 * estable del secreto de la app.
 */
function getDisputaKey(): Buffer {
  if (cachedDisputaKey) return cachedDisputaKey
  const raw = process.env.RODAID_DISPUTA_AES_KEY
  if (raw && raw.trim().length > 0) {
    cachedDisputaKey = parseClaveConfigurada(raw)
    return cachedDisputaKey
  }
  const secret = getAuthSecret() ?? 'rodaid-disputa-fallback'
  cachedDisputaKey = scryptSync(secret, 'rodaid-disputa-aes-v1', KEY_BYTES)
  return cachedDisputaKey
}

/**
 * Cifra un buffer (una foto/captura/PDF de evidencia) para guardarlo en su
 * bucket CIFRADO. Mismo formato de contenedor binario que las demas
 * funciones `cifrarBytes*` de este archivo.
 */
export function cifrarBytesDisputa(plain: Buffer | Uint8Array): Buffer {
  const key = getDisputaKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([BIN_VERSION]), iv, tag, ct])
}

/**
 * Descifra un contenedor binario producido por `cifrarBytesDisputa`. Lanza si
 * el formato es invalido o el contenido fue manipulado.
 */
export function descifrarBytesDisputa(blob: Buffer | Uint8Array): Buffer {
  const buf = Buffer.from(blob)
  if (buf.length < 1 + IV_BYTES + TAG_BYTES || buf[0] !== BIN_VERSION) {
    throw new Error('Contenedor cifrado de disputa con formato invalido.')
  }
  const iv = buf.subarray(1, 1 + IV_BYTES)
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const ct = buf.subarray(1 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGO, getDisputaKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

// ── Bucket cifrado de evidencia de reclamos de titularidad (Esquema 3) ────────

/**
 * Resuelve (y cachea) la clave AES-256 de la evidencia de reclamos de
 * titularidad (comprobantes de pago, capturas de chat con el vendedor, mail
 * -- que sube el reclamante o el dueño actual). Clave INDEPENDIENTE, mismo
 * criterio que el resto del archivo. En LIVE se toma de
 * `RODAID_RECLAMO_AES_KEY`; en preview se deriva de forma estable del
 * secreto de la app.
 */
function getReclamoKey(): Buffer {
  if (cachedReclamoKey) return cachedReclamoKey
  const raw = process.env.RODAID_RECLAMO_AES_KEY
  if (raw && raw.trim().length > 0) {
    cachedReclamoKey = parseClaveConfigurada(raw)
    return cachedReclamoKey
  }
  const secret = getAuthSecret() ?? 'rodaid-reclamo-fallback'
  cachedReclamoKey = scryptSync(secret, 'rodaid-reclamo-aes-v1', KEY_BYTES)
  return cachedReclamoKey
}

/** Cifra un buffer de evidencia de reclamo de titularidad. Mismo contenedor binario que el resto del archivo. */
export function cifrarBytesReclamo(plain: Buffer | Uint8Array): Buffer {
  const key = getReclamoKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([BIN_VERSION]), iv, tag, ct])
}

/** Descifra un contenedor binario producido por `cifrarBytesReclamo`. Lanza si el formato es invalido o el contenido fue manipulado. */
export function descifrarBytesReclamo(blob: Buffer | Uint8Array): Buffer {
  const buf = Buffer.from(blob)
  if (buf.length < 1 + IV_BYTES + TAG_BYTES || buf[0] !== BIN_VERSION) {
    throw new Error('Contenedor cifrado de reclamo con formato invalido.')
  }
  const iv = buf.subarray(1, 1 + IV_BYTES)
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const ct = buf.subarray(1 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGO, getReclamoKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

// ── Bucket cifrado de evidencia de impugnaciones de denuncia (Esquema 4) ──────

/**
 * Resuelve (y cachea) la clave AES-256 de la evidencia de impugnaciones de
 * denuncia (comprobante de pago, chat con el vendedor, transferencia
 * bancaria -- que sube quien impugna una denuncia que bloqueó su bici). Clave
 * INDEPENDIENTE, mismo criterio que el resto del archivo. En LIVE se toma de
 * `RODAID_IMPUGNACION_AES_KEY`; en preview se deriva de forma estable del
 * secreto de la app.
 */
function getImpugnacionKey(): Buffer {
  if (cachedImpugnacionKey) return cachedImpugnacionKey
  const raw = process.env.RODAID_IMPUGNACION_AES_KEY
  if (raw && raw.trim().length > 0) {
    cachedImpugnacionKey = parseClaveConfigurada(raw)
    return cachedImpugnacionKey
  }
  const secret = getAuthSecret() ?? 'rodaid-impugnacion-fallback'
  cachedImpugnacionKey = scryptSync(secret, 'rodaid-impugnacion-aes-v1', KEY_BYTES)
  return cachedImpugnacionKey
}

/** Cifra un buffer de evidencia de impugnación de denuncia. Mismo contenedor binario que el resto del archivo. */
export function cifrarBytesImpugnacion(plain: Buffer | Uint8Array): Buffer {
  const key = getImpugnacionKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([BIN_VERSION]), iv, tag, ct])
}

/** Descifra un contenedor binario producido por `cifrarBytesImpugnacion`. Lanza si el formato es invalido o el contenido fue manipulado. */
export function descifrarBytesImpugnacion(blob: Buffer | Uint8Array): Buffer {
  const buf = Buffer.from(blob)
  if (buf.length < 1 + IV_BYTES + TAG_BYTES || buf[0] !== BIN_VERSION) {
    throw new Error('Contenedor cifrado de impugnación con formato invalido.')
  }
  const iv = buf.subarray(1, 1 + IV_BYTES)
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const ct = buf.subarray(1 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGO, getImpugnacionKey(), iv)
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
