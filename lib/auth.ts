/**
 * RODAID — Hito 1: Autenticacion Definitiva.
 *
 * Nucleo de seguridad: hashing de contrasenas, emision/validacion de tokens
 * (AccessToken corto + RefreshToken largo persistido en `sesiones`) y los
 * middlewares de proteccion `requireAuth` / `requireRole`.
 *
 * Diseno:
 *   - El sistema es INDEPENDIENTE pero EXTENSIBLE a proveedores externos (MxM,
 *     etc.): los usuarios tienen una columna `proveedor` y los tokens no asumen
 *     nada del origen de la cuenta. Sumar un proveedor federado es crear el
 *     usuario con `proveedor <> 'local'` y emitir los mismos tokens.
 *   - La contrasena se hashea con scrypt (KDF memory-hard incluido en Node, sin
 *     dependencias nativas) en formato PHC. NUNCA se devuelve en una respuesta.
 *   - El AccessToken es un JWT firmado (HS256) de vida corta; no se persiste.
 *   - El RefreshToken es un secreto opaco de alta entropia: en la base solo vive
 *     su hash SHA-256. Al refrescar se ROTA (se revoca el viejo y se emite uno
 *     nuevo). Si es invalido o expiro, el usuario debe loguearse de nuevo.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto'
import { ApiError, getAuthSecret, getPool } from '@/lib/marketplace'

/** Promesa sobre `crypto.scrypt` con opciones (la firma promisificada por
 * defecto no incluye el parametro `options`). */
function scrypt(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

// ---------------------------------------------------------------------------
// Parametros
// ---------------------------------------------------------------------------

/** Vida del AccessToken (corta). */
export const ACCESS_TOKEN_TTL = '15m'
/** Vida del RefreshToken (larga), en dias. */
export const REFRESH_TOKEN_TTL_DAYS = 30

// scrypt: N=2^14 mantiene la latencia razonable en serverless sin exceder el
// `maxmem` por defecto de Node (128 * N * r ≈ 16 MB).
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64

export type UsuarioRol = 'ciclista' | 'inspector' | 'admin' | 'aliado'
const ROLES_VALIDOS: ReadonlySet<string> = new Set([
  'ciclista',
  'inspector',
  'admin',
  'aliado',
])

/** Usuario autenticado, derivado del AccessToken validado. */
export interface AuthUser {
  id: string
  rol: UsuarioRol
  email: string | null
}

// ---------------------------------------------------------------------------
// Hashing de contrasenas (scrypt, formato PHC: scrypt$N$r$p$salt$hash)
// ---------------------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = (await scrypt(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })) as Buffer
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

/** Verifica una contrasena contra su hash almacenado en tiempo constante. */
export async function verifyPassword(
  plain: string,
  stored: string | null
): Promise<boolean> {
  if (!stored) {
    return false
  }
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false
  }
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts
  const N = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false
  }
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  const derived = (await scrypt(plain, salt, expected.length, {
    N,
    r,
    p,
  })) as Buffer
  // Longitudes iguales por construccion, pero protegemos timingSafeEqual.
  if (derived.length !== expected.length) {
    return false
  }
  return timingSafeEqual(derived, expected)
}

// ---------------------------------------------------------------------------
// AccessToken (JWT firmado, vida corta)
// ---------------------------------------------------------------------------

function secretKey(): Uint8Array {
  const secret = getAuthSecret()
  if (!secret) {
    throw new ApiError(
      500,
      'AUTH_NOT_CONFIGURED',
      'Autenticacion no configurada.'
    )
  }
  return new TextEncoder().encode(secret)
}

export async function issueAccessToken(user: {
  id: string
  rol: UsuarioRol
  email: string | null
}): Promise<string> {
  return new SignJWT({ rol: user.rol, email: user.email, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secretKey())
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization')
  return authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
}

function normalizeRol(value: unknown): UsuarioRol {
  return typeof value === 'string' && ROLES_VALIDOS.has(value)
    ? (value as UsuarioRol)
    : 'ciclista'
}

async function verifyAccess(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secretKey())
  // Un RefreshToken nunca es un JWT, asi que `type` solo puede ser 'access' o
  // venir ausente (tokens legacy). Rechazamos cualquier otro `type`.
  if (payload.type && payload.type !== 'access') {
    throw new ApiError(401, 'INVALID_TOKEN', 'Token de usuario invalido.')
  }
  return payload
}

/**
 * Middleware de proteccion de endpoints privados. Exige un AccessToken valido y
 * devuelve el usuario autenticado (id, rol, email) leido del token.
 */
export async function requireAuth(req: Request): Promise<AuthUser> {
  const token = getBearerToken(req)
  if (!token) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Token de usuario requerido.')
  }
  try {
    const payload = await verifyAccess(token)
    const id = payload.sub
    if (typeof id !== 'string' || id.length === 0) {
      throw new ApiError(401, 'INVALID_TOKEN', 'Token de usuario invalido.')
    }
    return {
      id,
      rol: normalizeRol(payload.rol),
      email: typeof payload.email === 'string' ? payload.email : null,
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    // Token expirado, firma invalida, etc.
    throw new ApiError(401, 'INVALID_TOKEN', 'Token de usuario invalido o expirado.')
  }
}

/**
 * Middleware de autorizacion por rol. Restringe el endpoint a uno o mas roles
 * (p. ej. `requireRole('admin')` o `requireRole('admin', 'inspector')`).
 * Devuelve una funcion que valida el request y retorna el usuario autenticado.
 */
export function requireRole(...roles: UsuarioRol[]) {
  return async (req: Request): Promise<AuthUser> => {
    const user = await requireAuth(req)
    if (!roles.includes(user.rol)) {
      throw new ApiError(
        403,
        'FORBIDDEN_ROLE',
        'No tenes permisos para acceder a este recurso.'
      )
    }
    return user
  }
}

// ---------------------------------------------------------------------------
// RefreshToken (secreto opaco, persistido como hash en `sesiones`)
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

interface SessionMeta {
  userAgent?: string | null
  ip?: string | null
}

/** Crea una nueva sesion (RefreshToken) para un usuario y la persiste. */
export async function createSession(
  usuarioId: string,
  meta: SessionMeta = {}
): Promise<{ refreshToken: string; expiraEn: Date }> {
  const refreshToken = generateRefreshToken()
  const expiraEn = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  )
  await getPool().query(
    `
      INSERT INTO sesiones (usuario_id, refresh_token_hash, expira_en, user_agent, ip)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      usuarioId,
      sha256Hex(refreshToken),
      expiraEn.toISOString(),
      meta.userAgent ?? null,
      meta.ip ?? null,
    ]
  )
  return { refreshToken, expiraEn }
}

interface SesionRow {
  id: string
  usuario_id: string
  expira_en: string
  revocado_en: string | null
  rol: UsuarioRol
  email: string
}

/**
 * Rota un RefreshToken: valida que sea vigente, emite un AccessToken nuevo y un
 * RefreshToken nuevo, y revoca el anterior (rotacion). Si el token es invalido,
 * expiro o ya fue revocado, lanza 401 para forzar un nuevo login.
 *
 * Deteccion de reuso: si llega un RefreshToken que YA estaba revocado (posible
 * robo + replay), se revocan TODAS las sesiones del usuario por seguridad.
 */
export async function rotateRefreshSession(
  refreshToken: string,
  meta: SessionMeta = {}
): Promise<{ accessToken: string; refreshToken: string; usuarioId: string }> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const tokenHash = sha256Hex(refreshToken)
    const found = await client.query<SesionRow>(
      `
        SELECT s.id, s.usuario_id, s.expira_en, s.revocado_en,
               u.rol, u.email
        FROM sesiones s
        JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.refresh_token_hash = $1
        FOR UPDATE OF s
      `,
      [tokenHash]
    )

    const sesion = found.rows[0]
    if (!sesion) {
      throw new ApiError(
        401,
        'REFRESH_INVALID',
        'La sesion expiro. Inicia sesion nuevamente.'
      )
    }

    // Reuso de un token ya revocado: invalidar toda la cadena del usuario.
    if (sesion.revocado_en) {
      await client.query(
        `UPDATE sesiones SET revocado_en = NOW()
         WHERE usuario_id = $1 AND revocado_en IS NULL`,
        [sesion.usuario_id]
      )
      await client.query('COMMIT')
      throw new ApiError(
        401,
        'REFRESH_REUSED',
        'La sesion expiro. Inicia sesion nuevamente.'
      )
    }

    if (new Date(sesion.expira_en).getTime() <= Date.now()) {
      await client.query(
        `UPDATE sesiones SET revocado_en = NOW() WHERE id = $1`,
        [sesion.id]
      )
      await client.query('COMMIT')
      throw new ApiError(
        401,
        'REFRESH_EXPIRED',
        'La sesion expiro. Inicia sesion nuevamente.'
      )
    }

    // Emitir la nueva sesion y encadenar la rotacion.
    const nuevoToken = generateRefreshToken()
    const expiraEn = new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
    )
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO sesiones (usuario_id, refresh_token_hash, expira_en, user_agent, ip)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [
        sesion.usuario_id,
        sha256Hex(nuevoToken),
        expiraEn.toISOString(),
        meta.userAgent ?? null,
        meta.ip ?? null,
      ]
    )

    await client.query(
      `UPDATE sesiones SET revocado_en = NOW(), reemplazada_por = $2 WHERE id = $1`,
      [sesion.id, inserted.rows[0].id]
    )

    await client.query('COMMIT')

    const accessToken = await issueAccessToken({
      id: sesion.usuario_id,
      rol: sesion.rol,
      email: sesion.email,
    })

    return {
      accessToken,
      refreshToken: nuevoToken,
      usuarioId: sesion.usuario_id,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/** Revoca un RefreshToken (logout). No falla si el token ya no existe. */
export async function revokeSession(refreshToken: string): Promise<void> {
  await getPool().query(
    `UPDATE sesiones SET revocado_en = NOW()
     WHERE refresh_token_hash = $1 AND revocado_en IS NULL`,
    [sha256Hex(refreshToken)]
  )
}

// ---------------------------------------------------------------------------
// Helpers de usuario
// ---------------------------------------------------------------------------

export interface UsuarioRow {
  id: string
  email: string
  password_hash: string | null
  rol: UsuarioRol
  datos_perfil: Record<string, unknown>
  proveedor: string
  proveedor_uid: string | null
  email_verificado: boolean
  wallet_address: string | null
  created_at: string
  updated_at: string
}

/** Usuario publico: la version segura para devolver en JSON (sin password). */
export interface UsuarioPublico {
  id: string
  email: string
  rol: UsuarioRol
  datosPerfil: Record<string, unknown>
  proveedor: string
  emailVerificado: boolean
  /** Identidad digital del inspector (Hito 11). NULL si no la configuro. */
  walletAddress: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Proyecta una fila de `usuarios` a su forma publica. Excluye SIEMPRE
 * `password_hash`: la contrasena nunca se devuelve en ninguna respuesta.
 */
export function toUsuarioPublico(row: UsuarioRow): UsuarioPublico {
  return {
    id: row.id,
    email: row.email,
    rol: row.rol,
    datosPerfil: row.datos_perfil ?? {},
    proveedor: row.proveedor,
    emailVerificado: row.email_verificado,
    walletAddress: row.wallet_address ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Columnas seguras de `usuarios` (sin `password_hash`) para los SELECT. */
export const USUARIO_PUBLIC_COLUMNS = `
  id, email, rol, datos_perfil, proveedor, proveedor_uid,
  email_verificado, wallet_address, created_at, updated_at
`
