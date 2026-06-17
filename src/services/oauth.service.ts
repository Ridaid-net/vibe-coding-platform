import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { getPool } from '@/lib/marketplace'

/**
 * RODAID — Hito 16: OAuth2 / OpenID Connect del ecosistema Open-Connect.
 *
 * Nucleo de seguridad de la apertura a terceros. Implementa el flujo de
 * Authorization Code con PKCE para que una aplicacion externa obtenga acceso
 * ACOTADO al ESTADO PUBLICO de una bicicleta — y SOLO con el consentimiento
 * EXPRESO del dueño.
 *
 * Principios:
 *   - Los access tokens son OPACOS y de vida corta: en la base vive solo su hash
 *     SHA-256 (igual que los RefreshToken del Hito 1). Una sola lectura indexada
 *     valida un token, lo que sostiene el SLA < 2 s incluso con alta concurrencia.
 *   - Cada token esta acotado a un conjunto de scopes y a UNA bicicleta consentida.
 *   - PKCE (S256) protege el flujo de clientes publicos (SPAs, apps moviles).
 *   - NUNCA se expone un dato personal: los scopes solo habilitan estado publico.
 */

// ───────────────────────────────────────────────────────────────────────────
// Catalogo de scopes (permisos). Cada scope habilita SOLO estado publico.
// ───────────────────────────────────────────────────────────────────────────

export interface ScopeDef {
  id: string
  titulo: string
  descripcion: string
}

export const SCOPES: ScopeDef[] = [
  {
    id: 'verificacion:read',
    titulo: 'Estado de verificación pública',
    descripcion:
      'Leer el veredicto público de la bici (segura, robada, en validación) y su huella en la Blockchain Federal Argentina. No incluye datos personales.',
  },
  {
    id: 'cit:estado',
    titulo: 'Identidad de la bici (CIT)',
    descripcion:
      'Leer el estado y el código de la Cédula de Identidad (CIT) de la bici, sin exponer al propietario.',
  },
  {
    id: 'webhooks:eventos',
    titulo: 'Eventos de cambio de estado',
    descripcion:
      'Recibir avisos en tiempo real cuando cambia el estado público de propiedad/identidad de la bici (logística, seguros).',
  },
]

const SCOPE_IDS: ReadonlySet<string> = new Set(SCOPES.map((s) => s.id))

/** Scope por defecto cuando una solicitud no especifica ninguno. */
export const SCOPE_DEFAULT = 'verificacion:read'

export function scopeValido(scope: string): boolean {
  return SCOPE_IDS.has(scope)
}

/**
 * Parsea y normaliza una cadena de scopes (separada por espacios, estilo OAuth2).
 * Descarta los desconocidos y deduplica. Si queda vacia, devuelve el scope por
 * defecto.
 */
export function parsearScopes(raw: string | null | undefined): string[] {
  const pedidos = (raw ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const validos = [...new Set(pedidos.filter(scopeValido))]
  return validos.length > 0 ? validos : [SCOPE_DEFAULT]
}

/** Devuelve las definiciones (titulo/descripcion) de una lista de scope ids. */
export function describirScopes(scopes: string[]): ScopeDef[] {
  return scopes
    .map((id) => SCOPES.find((s) => s.id === id))
    .filter((s): s is ScopeDef => Boolean(s))
}

// ───────────────────────────────────────────────────────────────────────────
// Parametros
// ───────────────────────────────────────────────────────────────────────────

/** Vida del codigo de autorizacion (corta, un solo uso). */
const CODE_TTL_SEG = 600 // 10 minutos

/** Vida del access token. Configurable por entorno; por defecto 1 hora. */
function tokenTtlSeg(): number {
  const raw = process.env.RODAID_OAUTH_TOKEN_TTL_SEG
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 3600
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers de hashing / generacion
// ───────────────────────────────────────────────────────────────────────────

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

/** Comparacion en tiempo constante de dos strings (evita timing attacks). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// ───────────────────────────────────────────────────────────────────────────
// PKCE (RFC 7636)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Verifica el `code_verifier` contra el `code_challenge` guardado al autorizar.
 * Soporta el metodo S256 (recomendado) y `plain`. Si no hubo desafio (cliente
 * confidencial con secret), `challenge` es null y la verificacion no aplica.
 */
export function verificarPkce(
  verifier: string | null | undefined,
  challenge: string | null,
  method: string | null
): boolean {
  if (!challenge) return true // sin PKCE: la autenticidad la da el client_secret
  if (!verifier) return false
  if (method === 'plain') {
    return safeEqual(verifier, challenge)
  }
  // S256: BASE64URL(SHA256(verifier)) === challenge
  const calculado = base64url(createHash('sha256').update(verifier).digest())
  return safeEqual(calculado, challenge)
}

// ───────────────────────────────────────────────────────────────────────────
// Codigos de autorizacion (un solo uso, PKCE)
// ───────────────────────────────────────────────────────────────────────────

export interface NuevoCodigo {
  appId: string
  usuarioId: string
  bicicletaId: string | null
  scopes: string[]
  redirectUri: string
  codeChallenge?: string | null
  codeChallengeMethod?: string | null
}

/**
 * Emite un codigo de autorizacion tras el consentimiento del usuario. Devuelve el
 * codigo EN CLARO (se entrega una sola vez en la redireccion); en la base solo
 * queda su hash.
 */
export async function crearCodigoAutorizacion(input: NuevoCodigo): Promise<string> {
  const code = base64url(randomBytes(32))
  const expira = new Date(Date.now() + CODE_TTL_SEG * 1000)
  await getPool().query(
    `
      INSERT INTO oauth_codes
        (code_hash, app_id, usuario_id, bicicleta_id, scopes, redirect_uri,
         code_challenge, code_challenge_method, expira_en)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      sha256Hex(code),
      input.appId,
      input.usuarioId,
      input.bicicletaId,
      input.scopes,
      input.redirectUri,
      input.codeChallenge ?? null,
      input.codeChallengeMethod ?? null,
      expira.toISOString(),
    ]
  )
  return code
}

export interface CodigoCanjeado {
  appId: string
  usuarioId: string
  bicicletaId: string | null
  scopes: string[]
}

interface CodigoRow {
  id: string
  app_id: string
  usuario_id: string
  bicicleta_id: string | null
  scopes: string[]
  redirect_uri: string
  code_challenge: string | null
  code_challenge_method: string | null
  expira_en: string
  usado_en: string | null
}

/**
 * Canjea un codigo de autorizacion. Valida: que exista, no este usado ni vencido,
 * que la `redirectUri` coincida y que el PKCE verifique. Marca el codigo como
 * usado de forma ATOMICA (un codigo nunca se canjea dos veces). Devuelve null si
 * cualquier condicion falla.
 */
export async function canjearCodigo(params: {
  code: string
  redirectUri: string
  appId: string
  codeVerifier?: string | null
}): Promise<CodigoCanjeado | null> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query<CodigoRow>(
      `SELECT * FROM oauth_codes WHERE code_hash = $1 FOR UPDATE`,
      [sha256Hex(params.code)]
    )
    const row = res.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return null
    }
    const invalido =
      row.usado_en !== null ||
      new Date(row.expira_en).getTime() <= Date.now() ||
      row.app_id !== params.appId ||
      row.redirect_uri !== params.redirectUri ||
      !verificarPkce(params.codeVerifier, row.code_challenge, row.code_challenge_method)

    if (invalido) {
      // Marcar usado igual si fue replay de un codigo valido ya consumido no
      // aplica aca; simplemente rechazamos sin tocar nada.
      await client.query('ROLLBACK')
      return null
    }

    await client.query(`UPDATE oauth_codes SET usado_en = NOW() WHERE id = $1`, [row.id])
    await client.query('COMMIT')
    return {
      appId: row.app_id,
      usuarioId: row.usuario_id,
      bicicletaId: row.bicicleta_id,
      scopes: row.scopes ?? [],
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Access tokens (opacos, hash en base, revocables)
// ───────────────────────────────────────────────────────────────────────────

export interface TokenEmitido {
  accessToken: string
  expiresIn: number
  scope: string
}

/** Emite un access token opaco acotado a una bici y a un conjunto de scopes. */
export async function emitirAccessToken(input: {
  appId: string
  usuarioId: string
  bicicletaId: string | null
  scopes: string[]
}): Promise<TokenEmitido> {
  const token = base64url(randomBytes(36))
  const ttl = tokenTtlSeg()
  const expira = new Date(Date.now() + ttl * 1000)
  await getPool().query(
    `
      INSERT INTO oauth_tokens
        (token_hash, app_id, usuario_id, bicicleta_id, scopes, expira_en)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      sha256Hex(token),
      input.appId,
      input.usuarioId,
      input.bicicletaId,
      input.scopes,
      expira.toISOString(),
    ]
  )
  return { accessToken: token, expiresIn: ttl, scope: input.scopes.join(' ') }
}

export interface TokenValidado {
  appId: string
  usuarioId: string
  bicicletaId: string | null
  scopes: string[]
  /** Límite de requests por minuto de la app dueña del token (rate limiting). */
  rateLimitRpm: number
}

/**
 * Valida un access token opaco. Lectura indexada por hash + comprobacion de
 * vencimiento/revocacion. Devuelve el contexto del token o null. Best-effort:
 * actualiza `ultimo_uso_en` sin bloquear la respuesta.
 */
export async function validarAccessToken(token: string): Promise<TokenValidado | null> {
  if (!token) return null
  const res = await getPool().query<{
    id: string
    app_id: string
    usuario_id: string
    bicicleta_id: string | null
    scopes: string[]
    expira_en: string
    revocado_en: string | null
    app_estado: string
    rate_limit_rpm: number
  }>(
    `
      SELECT t.id, t.app_id, t.usuario_id, t.bicicleta_id, t.scopes,
             t.expira_en, t.revocado_en, a.estado AS app_estado, a.rate_limit_rpm
      FROM oauth_tokens t
      JOIN developer_apps a ON a.id = t.app_id
      WHERE t.token_hash = $1
      LIMIT 1
    `,
    [sha256Hex(token)]
  )
  const row = res.rows[0]
  if (!row) return null
  if (row.revocado_en) return null
  if (new Date(row.expira_en).getTime() <= Date.now()) return null
  if (row.app_estado !== 'activa') return null

  getPool()
    .query(`UPDATE oauth_tokens SET ultimo_uso_en = NOW() WHERE id = $1`, [row.id])
    .catch(() => undefined)

  return {
    appId: row.app_id,
    usuarioId: row.usuario_id,
    bicicletaId: row.bicicleta_id,
    scopes: row.scopes ?? [],
    rateLimitRpm: row.rate_limit_rpm,
  }
}

/** Revoca todos los tokens vivos de una app (al suspenderla o rotar credenciales). */
export async function revocarTokensDeApp(appId: string): Promise<void> {
  await getPool().query(
    `UPDATE oauth_tokens SET revocado_en = NOW() WHERE app_id = $1 AND revocado_en IS NULL`,
    [appId]
  )
}
