import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * RODAID — Hito 19: MFA por TOTP (RFC 6238) para el Dashboard de Administracion.
 *
 * El acceso al panel exige un segundo factor obligatorio. Se implementa TOTP
 * estandar (HMAC-SHA1, paso de 30 s, 6 digitos) sin dependencias externas, de
 * modo que el administrador enrola el secreto en cualquier app de autenticacion
 * (Google Authenticator, Authy, 1Password, etc.) escaneando el `otpauth://` URI.
 *
 * El secreto NUNCA se guarda en claro: el panel lo persiste cifrado
 * (AES-256-GCM, ver cifrado.service). Esta capa solo genera/verifica codigos.
 */

const STEP_SECONDS = 30
const DIGITS = 6
// Tolerancia de +/- 1 paso para absorber desfasajes de reloj.
const WINDOW = 1

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Genera un secreto TOTP aleatorio en base32 (20 bytes -> 32 chars). */
export function generarSecretoTotp(): string {
  return base32Encode(randomBytes(20))
}

/** Codifica bytes en base32 (RFC 4648, sin padding). */
function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return out
}

/** Decodifica un string base32 (tolera espacios, minusculas y padding '='). */
function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Calcula el codigo TOTP de 6 digitos para un contador dado. */
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8)
  // Counter de 64 bits big-endian. JS no maneja >2^53 con bitops, asi que se
  // escribe en dos mitades de 32 bits.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = createHmac('sha1', secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0')
}

/** Codigo TOTP vigente para el secreto (instante actual). Util para el demo. */
export function codigoTotpActual(secretBase32: string): string {
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS)
  return hotp(base32Decode(secretBase32), counter)
}

/**
 * Verifica un codigo TOTP de 6 digitos contra el secreto, con tolerancia de
 * +/-1 paso. Comparacion en tiempo constante.
 */
export function verificarTotp(secretBase32: string, code: string): boolean {
  const normalizado = (code ?? '').replace(/\D+/g, '')
  if (normalizado.length !== DIGITS) return false
  const secret = base32Decode(secretBase32)
  if (secret.length === 0) return false
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS)
  for (let w = -WINDOW; w <= WINDOW; w++) {
    const esperado = hotp(secret, counter + w)
    const a = Buffer.from(esperado)
    const b = Buffer.from(normalizado)
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }
  return false
}

/**
 * Construye el `otpauth://` URI para que el admin lo escanee en su app de
 * autenticacion (o lo cargue manualmente con el secreto).
 */
export function otpauthUri(opts: {
  secretBase32: string
  cuenta: string
  emisor?: string
}): string {
  const emisor = opts.emisor ?? 'RODAID Admin'
  const label = encodeURIComponent(`${emisor}:${opts.cuenta}`)
  const params = new URLSearchParams({
    secret: opts.secretBase32,
    issuer: emisor,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
