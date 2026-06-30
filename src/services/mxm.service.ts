/**
 * RODAID — Hito 9: Integracion Institucional MxM (Mendoza por Mi).
 *
 * Implementa el flujo de autenticacion OIDC (Authorization Code + PKCE) contra
 * el IDP de identidad unificada del Gobierno de Mendoza ("Mendoza por Mi") y el
 * mapeo de esa identidad federada a una cuenta de RODAID.
 *
 * Principios:
 *   - El login local (email + contrasena) se mantiene intacto para casos de
 *     excepcion. MxM es una via ADICIONAL de autenticacion.
 *   - Una vez resuelta la identidad, el usuario se materializa en la MISMA tabla
 *     `usuarios` y la sesion se emite con los MISMOS tokens (AccessToken +
 *     RefreshToken) que el login local: para el resto del ecosistema, el origen
 *     de la cuenta es transparente y el JWT tiene la misma estructura.
 *   - NUNCA se persiste el access_token del Gobierno. Solo se guarda el
 *     identificador unico de la persona (`sub` del IDP) en `identidades_federadas`
 *     y los datos oficiales no sensibles para pre-llenar el perfil.
 *
 * Modos (igual que el resto del proyecto):
 *   - LIVE: con `MXM_ISSUER_URL` + `MXM_CLIENT_ID` + `MXM_CLIENT_SECRET`
 *     configurados, opera contra el IDP real (sandbox o produccion segun la URL
 *     del issuer). Valida el ID token contra el JWKS del proveedor.
 *   - SIMULADO: sin esas credenciales (tipico en preview), se ejercita el flujo
 *     completo de punta a punta contra un "sandbox" interno que sintetiza una
 *     persona del padron y firma su ID token con el secreto de la app. Permite
 *     probar la integracion sin tocar los datos reales del Gobierno.
 */

import {
  SignJWT,
  jwtVerify,
  createRemoteJWKSet,
  type JWTPayload,
} from 'jose'
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
} from 'node:crypto'
import { getStore } from '@netlify/blobs'
import {
  ApiError,
  getAuthSecret,
  getPool,
  type DbClient,
} from '@/lib/marketplace'
import {
  USUARIO_PUBLIC_COLUMNS,
  type UsuarioRol,
  type UsuarioRow,
} from '@/lib/auth'

/** Identificador del proveedor de identidad en `identidades_federadas`. */
export const MXM_PROVIDER_ID = 'mxm'

/** Cookie httpOnly que transporta el estado del flujo OIDC (state/nonce/PKCE). */
export const MXM_FLOW_COOKIE = 'mxm_flow'

/** Vida del estado del flujo OIDC (cookie firmada): cubre el ida y vuelta. */
const FLOW_TTL_SECONDS = 10 * 60
/** Vida del ticket de handoff de sesion (Blobs, un solo uso). */
const HANDOFF_TTL_SECONDS = 5 * 60
/** Vida del "authorization code" sintetico en modo SIMULADO. */
const SANDBOX_CODE_TTL_SECONDS = 5 * 60

const HANDOFF_STORE = 'rodaid-mxm-handoff'

// ---------------------------------------------------------------------------
// Configuracion y modo
// ---------------------------------------------------------------------------

export type MxmModo = 'LIVE' | 'SIMULADO'

export interface MxmConfig {
  modo: MxmModo
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUri: string
  clientId: string
  clientSecret: string
  scopes: string
  /** CUILs (o `sub`) que, ademas de ser funcionarios, se elevan a admin. */
  adminCuils: ReadonlySet<string>
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function parseList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  )
}

/**
 * Resuelve la configuracion del proveedor MxM y el modo de operacion. En modo
 * SIMULADO los endpoints apuntan a nuestras propias rutas internas de sandbox.
 */
export function getMxmConfig(): MxmConfig {
  const issuerRaw = process.env.MXM_ISSUER_URL?.trim()
  const clientId = process.env.MXM_CLIENT_ID?.trim()
  const clientSecret = process.env.MXM_CLIENT_SECRET?.trim()
  const adminCuils = parseList(process.env.MXM_ADMIN_CUILS)
  const scopes = process.env.MXM_SCOPES?.trim() || 'openid profile email'

  const esLive = Boolean(issuerRaw && clientId && clientSecret)

  if (esLive) {
    const issuer = trimSlash(issuerRaw as string)
    return {
      modo: 'LIVE',
      issuer,
      authorizationEndpoint:
        process.env.MXM_AUTHORIZATION_ENDPOINT?.trim() ||
        `${issuer}/protocol/openid-connect/auth`,
      tokenEndpoint:
        process.env.MXM_TOKEN_ENDPOINT?.trim() ||
        `${issuer}/protocol/openid-connect/token`,
      jwksUri:
        process.env.MXM_JWKS_URI?.trim() ||
        `${issuer}/protocol/openid-connect/certs`,
      clientId: clientId as string,
      clientSecret: clientSecret as string,
      scopes,
      adminCuils,
    }
  }

  // Modo SIMULADO: sandbox interno. Issuer logico estable para validar el token.
  const issuer = 'https://sandbox.mxm.mendoza.gov.ar'
  return {
    modo: 'SIMULADO',
    issuer,
    authorizationEndpoint: '/api/v1/auth/mxm/sandbox-authorize',
    tokenEndpoint: '/api/v1/auth/mxm/sandbox-token',
    jwksUri: `${issuer}/jwks`,
    clientId: clientId || 'rodaid-sandbox',
    clientSecret: clientSecret || 'sandbox',
    scopes,
    adminCuils,
  }
}

/** URL de callback de RODAID. Configurable; si no, se deriva del request. */
export function getRedirectUri(origin: string): string {
  const configured = process.env.MXM_REDIRECT_URI?.trim()
  if (configured) return configured
  const base = process.env.RODAID_BASE_URL?.trim()
  return `${trimSlash(base || origin)}/api/v1/auth/mxm/callback`
}

// ---------------------------------------------------------------------------
// PKCE / estado del flujo (cookie firmada, sin estado en servidor)
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function secretKey(): Uint8Array {
  const secret = getAuthSecret()
  if (!secret) {
    throw new ApiError(500, 'AUTH_NOT_CONFIGURED', 'Autenticacion no configurada.')
  }
  return new TextEncoder().encode(secret)
}

export interface MxmFlowState {
  state: string
  nonce: string
  codeVerifier: string
  redirectUri: string
  /** A donde volver en el frontend tras completar el login. */
  returnTo: string
}

/** Genera un nuevo estado de flujo (state + nonce + PKCE verifier). */
export function nuevoFlowState(redirectUri: string, returnTo: string): MxmFlowState {
  return {
    state: base64url(randomBytes(24)),
    nonce: base64url(randomBytes(24)),
    codeVerifier: base64url(randomBytes(32)),
    redirectUri,
    returnTo,
  }
}

/** Reto PKCE S256 derivado del verifier. */
export function codeChallengeS256(codeVerifier: string): string {
  return base64url(createHash('sha256').update(codeVerifier).digest())
}

/** Firma el estado del flujo como un JWT corto para guardarlo en una cookie. */
export async function firmarFlowState(flow: MxmFlowState): Promise<string> {
  return new SignJWT({ ...flow, kind: 'mxm_flow' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${FLOW_TTL_SECONDS}s`)
    .sign(secretKey())
}

/** Verifica y decodifica el estado del flujo desde la cookie. */
export async function leerFlowState(cookieValue: string): Promise<MxmFlowState> {
  try {
    const { payload } = await jwtVerify(cookieValue, secretKey())
    if (payload.kind !== 'mxm_flow') throw new Error('tipo invalido')
    return {
      state: String(payload.state),
      nonce: String(payload.nonce),
      codeVerifier: String(payload.codeVerifier),
      redirectUri: String(payload.redirectUri),
      returnTo: String(payload.returnTo),
    }
  } catch {
    throw new ApiError(
      400,
      'MXM_FLOW_INVALIDO',
      'El inicio de sesion con Mendoza por Mi expiro o es invalido. Proba de nuevo.'
    )
  }
}

/** Construye la URL de autorizacion del IDP con PKCE. */
export function buildAuthorizationUrl(
  config: MxmConfig,
  flow: MxmFlowState
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: flow.redirectUri,
    scope: config.scopes,
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: codeChallengeS256(flow.codeVerifier),
    code_challenge_method: 'S256',
  })
  const sep = config.authorizationEndpoint.includes('?') ? '&' : '?'
  return `${config.authorizationEndpoint}${sep}${params.toString()}`
}

// ---------------------------------------------------------------------------
// Claims del Gobierno
// ---------------------------------------------------------------------------

/** Datos de la persona extraidos del ID token de MxM. */
export interface MxmClaims {
  /** `sub`: identificador unico e inmutable en el IDP. */
  externalUid: string
  cuil: string | null
  dni: string | null
  nombreCompleto: string | null
  email: string | null
  emailVerificado: boolean
  /** La persona es funcionario publico (verificado por claims del token). */
  esFuncionario: boolean
  reparticion: string | null
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

/**
 * Extrae los campos de interes (cuil, nombre_completo, dni, ...) desde el
 * payload del ID token, contemplando los nombres de claim estandar OIDC y los
 * propios de MxM.
 */
export function extraerClaims(payload: JWTPayload): MxmClaims {
  const p = payload as Record<string, unknown>
  const externalUid = asString(p.sub)
  if (!externalUid) {
    throw new ApiError(
      502,
      'MXM_TOKEN_SIN_SUB',
      'El token del Gobierno no incluye un identificador de usuario.'
    )
  }

  const nombrePartes = [asString(p.given_name), asString(p.family_name)]
    .filter(Boolean)
    .join(' ')
    .trim()
  const nombreCompleto =
    asString(p.nombre_completo) ?? asString(p.name) ?? (nombrePartes || null)

  const reparticion =
    asString(p.reparticion) ?? asString(p.entidad) ?? asString(p.organismo)

  const esFuncionario =
    asBool(p.funcionario_publico) ||
    asBool(p.es_funcionario) ||
    asString(p.tipo_persona)?.toLowerCase() === 'funcionario' ||
    Boolean(reparticion)

  return {
    externalUid,
    cuil: asString(p.cuil) ?? asString(p.cuit),
    dni: asString(p.dni) ?? asString(p.documento),
    nombreCompleto: nombreCompleto || null,
    email: asString(p.email)?.toLowerCase() ?? null,
    emailVerificado: asBool(p.email_verified),
    esFuncionario,
    reparticion: reparticion || null,
  }
}

/**
 * Decide el rol a asignar segun los claims. Un funcionario publico recibe
 * `inspector` (o `admin` si su CUIL esta en la lista de administradores o el
 * token lo indica). El resto de las personas, `ciclista`.
 */
export function rolDesdeClaims(
  claims: MxmClaims,
  config: MxmConfig,
  rolGobierno?: unknown
): UsuarioRol {
  if (!claims.esFuncionario) return 'ciclista'
  const esAdmin =
    asString(rolGobierno)?.toLowerCase() === 'admin' ||
    (claims.cuil ? config.adminCuils.has(claims.cuil) : false) ||
    config.adminCuils.has(claims.externalUid)
  return esAdmin ? 'admin' : 'inspector'
}

// ---------------------------------------------------------------------------
// Intercambio del code por el ID token y su validacion
// ---------------------------------------------------------------------------

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null
let cachedJwksUri: string | null = null

function getJwks(uri: string) {
  if (!cachedJwks || cachedJwksUri !== uri) {
    cachedJwks = createRemoteJWKSet(new URL(uri))
    cachedJwksUri = uri
  }
  return cachedJwks
}

/**
 * Intercambia el `code` por los tokens del IDP y devuelve los claims validados
 * del ID token. En modo SIMULADO el `code` ES un JWT firmado por nuestro sandbox
 * que ya contiene los claims; en LIVE se llama al token endpoint y se valida el
 * id_token contra el JWKS del proveedor (iss, aud, exp, nonce).
 *
 * El access_token del Gobierno NO se devuelve ni se persiste: solo interesa la
 * identidad del ID token.
 */
export async function intercambiarCode(
  config: MxmConfig,
  code: string,
  flow: MxmFlowState
): Promise<{ claims: MxmClaims; rolGobierno: unknown }> {
  if (config.modo === 'SIMULADO') {
    const payload = await verificarSandboxToken(code)
    return { claims: extraerClaims(payload), rolGobierno: payload.rol_gobierno }
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: flow.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: flow.codeVerifier,
  })

  const res = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  })
  if (!res.ok) {
    throw new ApiError(
      502,
      'MXM_TOKEN_ERROR',
      'No se pudo validar la identidad con Mendoza por Mi.'
    )
  }
  const tokens = (await res.json()) as { id_token?: string }
  if (!tokens.id_token) {
    throw new ApiError(
      502,
      'MXM_SIN_ID_TOKEN',
      'El Gobierno no devolvio un token de identidad.'
    )
  }

  const { payload } = await jwtVerify(tokens.id_token, getJwks(config.jwksUri), {
    issuer: config.issuer,
    audience: config.clientId,
  })
  if (payload.nonce && payload.nonce !== flow.nonce) {
    throw new ApiError(401, 'MXM_NONCE_INVALIDO', 'La identidad no pudo validarse.')
  }
  // El access_token se descarta deliberadamente: no se persiste.
  return { claims: extraerClaims(payload), rolGobierno: payload.rol_gobierno }
}

// ---------------------------------------------------------------------------
// Sandbox interno (modo SIMULADO): sintetiza una persona y firma su ID token
// ---------------------------------------------------------------------------

/** Calcula el digito verificador de un CUIL a partir de tipo + DNI. */
function cuilDesdeDni(dni: string, prefijo = 20): string {
  const base = `${prefijo}${dni.padStart(8, '0')}`
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = base
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * mult[i], 0)
  let dv = 11 - (suma % 11)
  if (dv === 11) dv = 0
  if (dv === 10) dv = 9
  return `${base}${dv}`
}

const SANDBOX_NOMBRES = [
  'María Fernanda Quiroga',
  'Juan Cruz Ferreyra',
  'Lucía Belén Ortiz',
  'Santiago Nicolás Funes',
  'Camila Antonella Reta',
  'Matías Ezequiel Páez',
]

/**
 * Sintetiza los claims de una persona del padron para el sandbox. Si se pide
 * `funcionario`, agrega los claims que el IDP usaria para un agente del Estado.
 */
export function sintetizarPersonaSandbox(funcionario: boolean): Record<string, unknown> {
  const dni = String(20_000_000 + randomInt(0, 25_000_000))
  const nombre = SANDBOX_NOMBRES[randomInt(0, SANDBOX_NOMBRES.length)]
  const prefijo = funcionario ? 27 : 20
  const cuil = cuilDesdeDni(dni, prefijo)
  const usuario = nombre.toLowerCase().split(' ')[0]
  const claims: Record<string, unknown> = {
    sub: `mxm-${cuil}`,
    cuil,
    dni,
    nombre_completo: nombre,
    email: `${usuario}.${dni.slice(-4)}@ciudadano.mendoza.gob.ar`,
    email_verified: true,
  }
  if (funcionario) {
    claims.funcionario_publico = true
    claims.reparticion = 'Direccion de Seguridad Ciudadana'
  }
  return claims
}

/**
 * Firma un "authorization code" del sandbox: un JWT corto que transporta los
 * claims sinteticos. El callback lo verifica como si fuera el resultado del
 * intercambio con el token endpoint del Gobierno.
 */
export async function firmarSandboxCode(
  claims: Record<string, unknown>,
  nonce: string
): Promise<string> {
  const config = getMxmConfig()
  return new SignJWT({ ...claims, nonce, kind: 'mxm_sandbox_code' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(config.issuer)
    .setAudience(config.clientId)
    .setSubject(String(claims.sub))
    .setIssuedAt()
    .setExpirationTime(`${SANDBOX_CODE_TTL_SECONDS}s`)
    .sign(secretKey())
}

async function verificarSandboxToken(code: string): Promise<JWTPayload> {
  const config = getMxmConfig()
  try {
    const { payload } = await jwtVerify(code, secretKey(), {
      issuer: config.issuer,
      audience: config.clientId,
    })
    if (payload.kind !== 'mxm_sandbox_code') throw new Error('tipo invalido')
    return payload
  } catch {
    throw new ApiError(
      400,
      'MXM_CODE_INVALIDO',
      'El codigo de autorizacion del sandbox es invalido o expiro.'
    )
  }
}

// ---------------------------------------------------------------------------
// Mapeo de identidad: upsert de usuario + identidad federada (transaccional)
// ---------------------------------------------------------------------------

export type ResultadoVinculacion = 'creado' | 'vinculado' | 'reingreso'

export interface Vinculacion {
  row: UsuarioRow
  resultado: ResultadoVinculacion
}

const RANGO_ROL: Record<UsuarioRol, number> = {
  ciclista: 0,
  aliado: 1,
  inspector: 2,
  admin: 3,
}

/** Eleva el rol solo si el nuevo es mayor; nunca degrada (p. ej. admin queda). */
function elevarRol(actual: UsuarioRol, propuesto: UsuarioRol): UsuarioRol {
  return RANGO_ROL[propuesto] > RANGO_ROL[actual] ? propuesto : actual
}

function emailParaCuenta(claims: MxmClaims): string {
  if (claims.email) return claims.email
  // Sin email del Gobierno: se deriva uno estable y unico por identidad.
  return `mxm-${claims.externalUid}@usuarios.rodaid.local`.toLowerCase()
}

function selectUsuario(client: DbClient, where: string, params: unknown[]) {
  return client.query<UsuarioRow>(
    `SELECT ${USUARIO_PUBLIC_COLUMNS}, password_hash FROM usuarios WHERE ${where} LIMIT 1`,
    params
  )
}

/**
 * Resuelve la cuenta de RODAID para una identidad de MxM, en una transaccion:
 *   1. Si ya existe la identidad federada (reingreso): refresca sus datos.
 *   2. Si no, pero hay una cuenta local con el mismo email: la VINCULA.
 *   3. Si no existe ninguna: CREA la cuenta (proveedor 'mxm').
 *
 * En todos los casos marca el sello gubernamental, eleva el rol si corresponde
 * (funcionario) y pre-llena el perfil con los datos oficiales. Nunca guarda el
 * access_token del Gobierno: solo `external_uid` y los datos oficiales.
 */
export async function vincularIdentidadFederada(
  claims: MxmClaims,
  rol: UsuarioRol
): Promise<Vinculacion> {
  const pool = getPool()
  const client = await pool.connect()
  const datosOficiales = {
    cuil: claims.cuil,
    dni: claims.dni,
    nombreCompleto: claims.nombreCompleto,
    esFuncionario: claims.esFuncionario,
    reparticion: claims.reparticion,
  }
  try {
    await client.query('BEGIN')

    // 1) Identidad federada ya conocida -> reingreso.
    const existente = await client.query<{ user_id: string }>(
      `SELECT user_id FROM identidades_federadas
       WHERE provider_id = $1 AND external_uid = $2
       FOR UPDATE`,
      [MXM_PROVIDER_ID, claims.externalUid]
    )

    let userId: string
    let resultado: ResultadoVinculacion

    if (existente.rows[0]) {
      userId = existente.rows[0].user_id
      resultado = 'reingreso'
      await client.query(
        `UPDATE identidades_federadas
         SET verified_at = NOW(), datos_oficiales = $2::jsonb
         WHERE provider_id = $3 AND external_uid = $4`,
        [
          userId,
          JSON.stringify(datosOficiales),
          MXM_PROVIDER_ID,
          claims.externalUid,
        ]
      )
    } else {
      // 2) Cuenta local con el mismo email -> vincular.
      const email = emailParaCuenta(claims)
      const local = await selectUsuario(client, 'lower(email) = lower($1)', [
        email,
      ])
      if (local.rows[0]) {
        userId = local.rows[0].id
        resultado = 'vinculado'
      } else {
        // 3) Crear la cuenta federada (sin password: se autentica por MxM).
        const perfil = {
          nombre: claims.nombreCompleto ?? undefined,
          cuil: claims.cuil ?? undefined,
          dni: claims.dni ?? undefined,
          origen: 'mxm',
        }
        const creado = await client.query<{ id: string }>(
          `INSERT INTO usuarios
             (email, password_hash, rol, datos_perfil, proveedor, proveedor_uid,
              email_verificado, sello_gubernamental)
           VALUES ($1, NULL, $2::usuario_rol, $3::jsonb, $4, $5, $6, TRUE)
           RETURNING id`,
          [
            email,
            rol,
            JSON.stringify(perfil),
            MXM_PROVIDER_ID,
            claims.externalUid,
            claims.emailVerificado || !claims.email ? true : claims.emailVerificado,
          ]
        )
        userId = creado.rows[0].id
        resultado = 'creado'
      }

      await client.query(
        `INSERT INTO identidades_federadas
           (user_id, provider_id, external_uid, verified_at, datos_oficiales)
         VALUES ($1, $2, $3, NOW(), $4::jsonb)
         ON CONFLICT (provider_id, external_uid) DO UPDATE
           SET verified_at = NOW(), datos_oficiales = EXCLUDED.datos_oficiales`,
        [
          userId,
          MXM_PROVIDER_ID,
          claims.externalUid,
          JSON.stringify(datosOficiales),
        ]
      )
    }

    // Sello gubernamental + elevacion de rol + pre-llenado del perfil. Se aplica
    // siempre (reingreso, vinculo o alta) para mantener la cuenta consistente.
    const actual = await selectUsuario(client, 'id = $1', [userId])
    const row = actual.rows[0]
    if (!row) {
      throw new ApiError(500, 'MXM_USUARIO_NO_RESUELTO', 'No se pudo resolver la cuenta.')
    }
    const nuevoRol = elevarRol(row.rol, rol)
    const perfilActual = row.datos_perfil ?? {}
    const perfilMerged = {
      ...perfilActual,
      // Pre-llenar solo lo que falte: no se pisan datos que el usuario ya cargo.
      nombre: perfilActual.nombre ?? claims.nombreCompleto ?? undefined,
      cuil: perfilActual.cuil ?? claims.cuil ?? undefined,
      dni: perfilActual.dni ?? claims.dni ?? undefined,
    }

    const actualizado = await client.query<UsuarioRow>(
      `UPDATE usuarios
       SET sello_gubernamental = TRUE,
           email_verificado = email_verificado OR $2,
           rol = $3::usuario_rol,
           datos_perfil = $4::jsonb
       WHERE id = $1
       RETURNING ${USUARIO_PUBLIC_COLUMNS}, password_hash`,
      [
        userId,
        claims.emailVerificado,
        nuevoRol,
        JSON.stringify(perfilMerged),
      ]
    )

    await client.query('COMMIT')
    return { row: actualizado.rows[0], resultado }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Handoff de la sesion al cliente (ticket de un solo uso via Blobs)
// ---------------------------------------------------------------------------

export interface SesionHandoff {
  accessToken: string
  refreshToken: string
  userId: string
  nombre: string
  rol: UsuarioRol
  selloGubernamental: boolean
}

/**
 * Guarda la sesion recien emitida bajo un ticket aleatorio y devuelve el ticket.
 * El callback redirige al cliente con este ticket (no con los tokens en la URL);
 * el cliente lo canjea una sola vez por la sesion real.
 */
export async function guardarHandoff(sesion: SesionHandoff): Promise<string> {
  const ticket = randomUUID()
  const store = getStore(HANDOFF_STORE)
  await store.setJSON(ticket, {
    ...sesion,
    expiraEn: Date.now() + HANDOFF_TTL_SECONDS * 1000,
  })
  return ticket
}

/** Canjea (una sola vez) el ticket por la sesion. Lo borra al consumirlo. */
export async function canjearHandoff(ticket: string): Promise<SesionHandoff> {
  const store = getStore(HANDOFF_STORE)
  const data = (await store.get(ticket, { type: 'json' })) as
    | (SesionHandoff & { expiraEn: number })
    | null
  if (!data) {
    throw new ApiError(400, 'MXM_TICKET_INVALIDO', 'El acceso expiro. Proba de nuevo.')
  }
  await store.delete(ticket).catch(() => undefined)
  if (typeof data.expiraEn === 'number' && data.expiraEn < Date.now()) {
    throw new ApiError(400, 'MXM_TICKET_EXPIRADO', 'El acceso expiro. Proba de nuevo.')
  }
  const { expiraEn: _omit, ...sesion } = data
  void _omit
  return sesion
}
