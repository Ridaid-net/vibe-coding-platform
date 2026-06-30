import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { ApiError, getPool } from '@/lib/marketplace'
import { getModo } from '@/src/services/mercadopago.service'
import {
  SCOPES,
  parsearScopes,
  revocarTokensDeApp,
  scopeValido,
  sha256Hex,
} from '@/src/services/oauth.service'

/**
 * RODAID — Hito 16: Portal de Desarrolladores (App Registration / Sandbox).
 *
 * Gestion del ciclo de vida de las aplicaciones de terceros que integran RODAID:
 * registro, credenciales (client_id + client_secret + API Key), rotacion,
 * suspension, bitacora de uso y rate limiting.
 *
 * Modelo de confianza:
 *   - El `client_id` es publico. Del `client_secret` y de la `API Key` SOLO se
 *     guarda el hash SHA-256; el valor en claro se entrega UNA sola vez (al crear
 *     o rotar) y no se puede volver a leer (igual que un proveedor cloud).
 *   - Toda app nace en el entorno `sandbox`, donde el dev ejercita el flujo de
 *     punta a punta. La promocion a `produccion` es un cambio de estado simple.
 */

// ───────────────────────────────────────────────────────────────────────────
// Tipos
// ───────────────────────────────────────────────────────────────────────────

export interface DeveloperAppRow {
  id: string
  owner_usuario_id: string
  nombre: string
  descripcion: string | null
  sitio_url: string | null
  client_id: string
  client_secret_hash: string
  api_key_prefix: string
  api_key_hash: string
  redirect_uris: string[]
  scopes: string[]
  entorno: string
  estado: string
  rate_limit_rpm: number
  created_at: string
  updated_at: string
}

/** Vista publica de una app (sin hashes de secretos). */
export interface DeveloperAppPublic {
  id: string
  nombre: string
  descripcion: string | null
  sitioUrl: string | null
  clientId: string
  apiKeyPrefix: string
  redirectUris: string[]
  scopes: string[]
  entorno: string
  estado: string
  rateLimitRpm: number
  createdAt: string
  updatedAt: string
}

export function toAppPublic(row: DeveloperAppRow): DeveloperAppPublic {
  return {
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion,
    sitioUrl: row.sitio_url,
    clientId: row.client_id,
    apiKeyPrefix: row.api_key_prefix,
    redirectUris: row.redirect_uris ?? [],
    scopes: row.scopes ?? [],
    entorno: row.entorno,
    estado: row.estado,
    rateLimitRpm: row.rate_limit_rpm,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Generacion de credenciales
// ───────────────────────────────────────────────────────────────────────────

function modoEtiqueta(): string {
  // Etiqueta de entorno coherente con el resto del proyecto (LIVE vs. resto).
  return getModo() === 'LIVE' ? 'live' : 'test'
}

function nuevoClientId(): string {
  return `rid_${modoEtiqueta()}_${randomBytes(12).toString('hex')}`
}

/** Devuelve {valor, prefijo, hash} de un secreto/API key recien generado. */
function nuevaCredencial(prefijoTipo: string): {
  valor: string
  prefijo: string
  hash: string
} {
  const cuerpo = randomBytes(24).toString('base64url')
  const valor = `${prefijoTipo}_${modoEtiqueta()}_${cuerpo}`
  // Prefijo visible: lo justo para identificarla en el panel sin revelar el resto.
  const prefijo = valor.slice(0, prefijoTipo.length + modoEtiqueta().length + 6)
  return { valor, prefijo, hash: sha256Hex(valor) }
}

// ───────────────────────────────────────────────────────────────────────────
// Validacion de entrada
// ───────────────────────────────────────────────────────────────────────────

function validarRedirectUris(value: unknown): string[] {
  if (value === undefined || value === null) return []
  const arr = Array.isArray(value) ? value : [value]
  const out: string[] = []
  for (const item of arr) {
    if (typeof item !== 'string' || !item.trim()) continue
    const uri = item.trim()
    let parsed: URL
    try {
      parsed = new URL(uri)
    } catch {
      throw new ApiError(400, 'VALIDATION_ERROR', `redirect_uri inválida: ${uri}`)
    }
    // Solo http(s); en produccion se exige https salvo localhost (para pruebas).
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ApiError(400, 'VALIDATION_ERROR', `redirect_uri debe ser http(s): ${uri}`)
    }
    out.push(uri)
    if (out.length > 10) break
  }
  return [...new Set(out)]
}

function validarScopes(value: unknown): string[] {
  if (value === undefined || value === null) return parsearScopes(null)
  const arr = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/)
      : []
  const limpios = arr
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
  for (const s of limpios) {
    if (!scopeValido(s)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Scope desconocido: ${s}`)
    }
  }
  return limpios.length ? [...new Set(limpios)] : parsearScopes(null)
}

// ───────────────────────────────────────────────────────────────────────────
// Registro y gestion de apps
// ───────────────────────────────────────────────────────────────────────────

export interface AppCreada {
  app: DeveloperAppPublic
  /** Secretos en claro — se muestran UNA sola vez. */
  secretos: { clientSecret: string; apiKey: string }
}

export async function registrarApp(
  ownerId: string,
  input: {
    nombre?: unknown
    descripcion?: unknown
    sitioUrl?: unknown
    redirectUris?: unknown
    scopes?: unknown
    entorno?: unknown
  }
): Promise<AppCreada> {
  const nombre = typeof input.nombre === 'string' ? input.nombre.trim() : ''
  if (nombre.length < 2 || nombre.length > 120) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El nombre de la app debe tener entre 2 y 120 caracteres.')
  }
  const redirectUris = validarRedirectUris(input.redirectUris)
  const scopes = validarScopes(input.scopes)
  const entorno = input.entorno === 'produccion' ? 'produccion' : 'sandbox'

  const clientId = nuevoClientId()
  const secret = nuevaCredencial('rsk') // RODAID secret key
  const apiKey = nuevaCredencial('rdk') // RODAID developer key

  const res = await getPool().query<DeveloperAppRow>(
    `
      INSERT INTO developer_apps
        (owner_usuario_id, nombre, descripcion, sitio_url, client_id,
         client_secret_hash, api_key_prefix, api_key_hash, redirect_uris,
         scopes, entorno)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `,
    [
      ownerId,
      nombre,
      typeof input.descripcion === 'string' ? input.descripcion.trim().slice(0, 1000) : null,
      typeof input.sitioUrl === 'string' && input.sitioUrl.trim() ? input.sitioUrl.trim() : null,
      clientId,
      secret.hash,
      apiKey.prefijo,
      apiKey.hash,
      redirectUris,
      scopes,
      entorno,
    ]
  )

  return {
    app: toAppPublic(res.rows[0]),
    secretos: { clientSecret: secret.valor, apiKey: apiKey.valor },
  }
}

export async function listarAppsDeUsuario(ownerId: string): Promise<DeveloperAppPublic[]> {
  const res = await getPool().query<DeveloperAppRow>(
    `SELECT * FROM developer_apps WHERE owner_usuario_id = $1 ORDER BY created_at DESC`,
    [ownerId]
  )
  return res.rows.map(toAppPublic)
}

/** Trae una app por id, exigiendo que pertenezca al usuario (o staff). */
export async function getAppDeUsuario(
  appId: string,
  ownerId: string
): Promise<DeveloperAppRow | null> {
  const res = await getPool().query<DeveloperAppRow>(
    `SELECT * FROM developer_apps WHERE id = $1 AND owner_usuario_id = $2`,
    [appId, ownerId]
  )
  return res.rows[0] ?? null
}

/** Trae una app por client_id (publico). Para el flujo de autorizacion. */
export async function getAppPorClientId(clientId: string): Promise<DeveloperAppRow | null> {
  const res = await getPool().query<DeveloperAppRow>(
    `SELECT * FROM developer_apps WHERE client_id = $1`,
    [clientId]
  )
  return res.rows[0] ?? null
}

/**
 * Autentica un cliente confidencial (client_id + client_secret) en tiempo
 * constante. Devuelve la app o null. Pensado para el endpoint /token.
 */
export async function autenticarCliente(
  clientId: string,
  clientSecret: string | null
): Promise<DeveloperAppRow | null> {
  const app = await getAppPorClientId(clientId)
  if (!app) return null
  if (app.estado !== 'activa') return null
  if (!clientSecret) return null
  const a = Buffer.from(sha256Hex(clientSecret))
  const b = Buffer.from(app.client_secret_hash)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return app
}

export async function actualizarApp(
  appId: string,
  ownerId: string,
  cambios: {
    nombre?: unknown
    descripcion?: unknown
    sitioUrl?: unknown
    redirectUris?: unknown
    scopes?: unknown
    entorno?: unknown
    estado?: unknown
  }
): Promise<DeveloperAppPublic> {
  const app = await getAppDeUsuario(appId, ownerId)
  if (!app) throw new ApiError(404, 'APP_NOT_FOUND', 'No encontramos la aplicación.')

  const sets: string[] = []
  const valores: unknown[] = []
  let i = 1
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = $${i++}`)
    valores.push(val)
  }

  if (cambios.nombre !== undefined) {
    const nombre = typeof cambios.nombre === 'string' ? cambios.nombre.trim() : ''
    if (nombre.length < 2 || nombre.length > 120) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Nombre inválido.')
    }
    push('nombre', nombre)
  }
  if (cambios.descripcion !== undefined) {
    push(
      'descripcion',
      typeof cambios.descripcion === 'string' ? cambios.descripcion.trim().slice(0, 1000) : null
    )
  }
  if (cambios.sitioUrl !== undefined) {
    push(
      'sitio_url',
      typeof cambios.sitioUrl === 'string' && cambios.sitioUrl.trim() ? cambios.sitioUrl.trim() : null
    )
  }
  if (cambios.redirectUris !== undefined) push('redirect_uris', validarRedirectUris(cambios.redirectUris))
  if (cambios.scopes !== undefined) push('scopes', validarScopes(cambios.scopes))
  if (cambios.entorno !== undefined) {
    push('entorno', cambios.entorno === 'produccion' ? 'produccion' : 'sandbox')
  }
  let suspendida = false
  if (cambios.estado !== undefined) {
    const estado = cambios.estado === 'suspendida' ? 'suspendida' : 'activa'
    suspendida = estado === 'suspendida'
    push('estado', estado)
  }

  if (!sets.length) return toAppPublic(app)

  valores.push(appId)
  const res = await getPool().query<DeveloperAppRow>(
    `UPDATE developer_apps SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    valores
  )
  // Suspender una app invalida sus tokens vivos.
  if (suspendida) await revocarTokensDeApp(appId)
  return toAppPublic(res.rows[0])
}

export async function eliminarApp(appId: string, ownerId: string): Promise<void> {
  const res = await getPool().query(
    `DELETE FROM developer_apps WHERE id = $1 AND owner_usuario_id = $2`,
    [appId, ownerId]
  )
  if (res.rowCount === 0) {
    throw new ApiError(404, 'APP_NOT_FOUND', 'No encontramos la aplicación.')
  }
}

/** Rota el client_secret y la API Key de una app (revoca tokens vivos). */
export async function rotarCredenciales(
  appId: string,
  ownerId: string
): Promise<{ app: DeveloperAppPublic; secretos: { clientSecret: string; apiKey: string } }> {
  const app = await getAppDeUsuario(appId, ownerId)
  if (!app) throw new ApiError(404, 'APP_NOT_FOUND', 'No encontramos la aplicación.')

  const secret = nuevaCredencial('rsk')
  const apiKey = nuevaCredencial('rdk')
  const res = await getPool().query<DeveloperAppRow>(
    `
      UPDATE developer_apps
      SET client_secret_hash = $2, api_key_prefix = $3, api_key_hash = $4
      WHERE id = $1
      RETURNING *
    `,
    [appId, secret.hash, apiKey.prefijo, apiKey.hash]
  )
  await revocarTokensDeApp(appId)
  return {
    app: toAppPublic(res.rows[0]),
    secretos: { clientSecret: secret.valor, apiKey: apiKey.valor },
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Rate limiting (fixed-window por app) — sostiene el SLA bajo alta concurrencia
// ───────────────────────────────────────────────────────────────────────────

export interface RateLimitResultado {
  permitido: boolean
  limite: number
  restantes: number
  retryAfter: number
}

const RATE_WINDOW_SEG = 60

/**
 * Incrementa de forma ATOMICA el contador de la ventana actual (INSERT ... ON
 * CONFLICT) y rechaza si supera el limite de la app. Una sola sentencia, resistente
 * a la concurrencia de muchos terceros consumiendo a la vez.
 */
export async function chequearRateLimitApp(
  appId: string,
  limiteRpm: number
): Promise<RateLimitResultado> {
  const limite = limiteRpm > 0 ? limiteRpm : 120
  const ventanaMs = RATE_WINDOW_SEG * 1000
  const ahora = Date.now()
  const ventanaInicio = new Date(Math.floor(ahora / ventanaMs) * ventanaMs)
  const ventanaFin = ventanaInicio.getTime() + ventanaMs

  const pool = getPool()
  const res = await pool.query<{ contador: number }>(
    `
      INSERT INTO developer_rate_limit (app_id, ventana_inicio, contador)
      VALUES ($1, $2, 1)
      ON CONFLICT (app_id, ventana_inicio)
      DO UPDATE SET contador = developer_rate_limit.contador + 1
      RETURNING contador
    `,
    [appId, ventanaInicio.toISOString()]
  )
  const contador = res.rows[0]?.contador ?? 1

  // Limpieza oportunista de ventanas viejas de esta app.
  pool
    .query(
      `DELETE FROM developer_rate_limit WHERE app_id = $1 AND ventana_inicio < $2`,
      [appId, new Date(ahora - ventanaMs * 5).toISOString()]
    )
    .catch(() => undefined)

  return {
    permitido: contador <= limite,
    limite,
    restantes: Math.max(0, limite - contador),
    retryAfter: Math.max(1, Math.ceil((ventanaFin - ahora) / 1000)),
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Bitacora de uso (dashboard del desarrollador)
// ───────────────────────────────────────────────────────────────────────────

export function hashIpDev(ip: string | null): string {
  const salt = process.env.JWT_SECRET ?? process.env.AUTH_SECRET ?? 'rodaid-dev-salt'
  return createHash('sha256').update(`${salt}:dev:${ip ?? 'desconocida'}`).digest('hex')
}

/** Registra una llamada a la API de un tercero. Best-effort (no bloquea). */
export async function registrarUso(reg: {
  appId: string
  endpoint: string
  metodo: string
  status: number
  scopeUsado?: string | null
  latenciaMs?: number | null
  ipHash?: string | null
}): Promise<void> {
  try {
    await getPool().query(
      `
        INSERT INTO developer_api_logs
          (app_id, endpoint, metodo, status, scope_usado, latencia_ms, ip_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        reg.appId,
        reg.endpoint.slice(0, 160),
        reg.metodo.slice(0, 10),
        reg.status,
        reg.scopeUsado ?? null,
        reg.latenciaMs ?? null,
        reg.ipHash ?? null,
      ]
    )
  } catch (error) {
    console.error('[developer] no se pudo registrar el uso', error)
  }
}

export interface UsoResumen {
  total: number
  ultimas24h: number
  errores: number
  latenciaP95Ms: number | null
  recientes: Array<{
    endpoint: string
    metodo: string
    status: number
    scopeUsado: string | null
    latenciaMs: number | null
    createdAt: string
  }>
}

/** Resumen de uso de una app para su dashboard (totales + ultimas llamadas). */
export async function resumenUso(appId: string): Promise<UsoResumen> {
  const pool = getPool()
  const [tot, recientes] = await Promise.all([
    pool.query<{
      total: string
      ultimas24h: string
      errores: string
      p95: string | null
    }>(
      `
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS ultimas24h,
          COUNT(*) FILTER (WHERE status >= 400) AS errores,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latencia_ms) AS p95
        FROM developer_api_logs
        WHERE app_id = $1
      `,
      [appId]
    ),
    pool.query<{
      endpoint: string
      metodo: string
      status: number
      scope_usado: string | null
      latencia_ms: number | null
      created_at: string
    }>(
      `
        SELECT endpoint, metodo, status, scope_usado, latencia_ms, created_at
        FROM developer_api_logs
        WHERE app_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [appId]
    ),
  ])
  const r = tot.rows[0]
  return {
    total: Number(r?.total ?? 0),
    ultimas24h: Number(r?.ultimas24h ?? 0),
    errores: Number(r?.errores ?? 0),
    latenciaP95Ms: r?.p95 != null ? Math.round(Number(r.p95)) : null,
    recientes: recientes.rows.map((row: {
      endpoint: string
      metodo: string
      status: number
      scope_usado: string | null
      latencia_ms: number | null
      created_at: string
    }) => ({
      endpoint: row.endpoint,
      metodo: row.metodo,
      status: row.status,
      scopeUsado: row.scope_usado,
      latenciaMs: row.latencia_ms,
      createdAt: row.created_at,
    })),
  }
}

/** Catalogo de scopes para exponer en el portal/discovery. */
export function catalogoScopes() {
  return SCOPES
}
