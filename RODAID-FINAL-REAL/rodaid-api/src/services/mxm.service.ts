// ─── RODAID · Servicio MxM (Mi Mendoza) ──────────────────
// OAuth 2.0 + PKCE con el proveedor de identidad del
// Gobierno de Mendoza (Ley Provincial N° 9556 — Art. 18)
//
// Niveles de identidad MxM:
//   Nivel 1 — email/teléfono verificado (básico)
//   Nivel 2 — DNI validado por RENAPER (identidad completa)
//
// RODAID exige Nivel 2 para emitir CITs.

import crypto from 'crypto'
import { env, isDev } from '../config/env'
import { query, queryOne, transaction } from '../config/database'
import { log } from '../middleware/logger'
import { AppError } from '../middleware/errorHandler'
import { MxMTokenResponse, MxMIdentidad, MxMPagoRequest } from '../types'

// ══════════════════════════════════════════════════════════
// CONSTANTES Y ENDPOINTS
// ══════════════════════════════════════════════════════════

// Endpoints oficiales de MxM (Gobierno de Mendoza)
const MXM_BASE    = env.MXM_AUTH_URL    ?? 'https://auth.mendoza.gob.ar'
const MXM_TOKEN   = env.MXM_TOKEN_URL   ?? `${MXM_BASE}/oauth/token`
const MXM_USERINFO= `${MXM_BASE}/oauth/userinfo`
const MXM_PAGOS   = env.MXM_PAGOS_URL   ?? `${MXM_BASE}/api/pagos`
const MXM_TRAMITES= env.MXM_TRAMITES_URL ?? `${MXM_BASE}/api/tramites`
const MXM_NOTIF   = env.MXM_NOTIF_URL   ?? `${MXM_BASE}/api/notificaciones`

const SCOPES = ['openid', 'profile', 'identidad', 'nivel2', 'cuil', 'tramites', 'pagos'].join(' ')

// Tiempo de vida del state PKCE en minutos
const STATE_TTL_MINUTES = 10

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface MxMInitResult {
  authUrl:       string
  state:         string
  codeChallenge: string
}

export interface MxMCallbackResult {
  usuario: {
    id:    string; email: string; nombre: string; apellido: string
    rol:   string; emailVerificado: boolean; mxmNivel: number
  }
  accessToken:   string
  refreshToken:  string
  expiresIn:     number
  tokenType:     'Bearer'
  isNewUser:     boolean
  mxmNivel:      number
}

interface MxMUserInfoRaw {
  sub:          string
  email?:       string
  name?:        string
  given_name?:  string
  family_name?: string
  cuil?:        string
  cuil_valido?: boolean
  dni?:         string
  nivel?:       number
  nivel_identidad?: number
  email_verified?: boolean
}

// ══════════════════════════════════════════════════════════
// PKCE — Proof Key for Code Exchange (RFC 7636)
// ══════════════════════════════════════════════════════════

function generateCodeVerifier(): string {
  // 32 bytes → 43 caracteres base64url — dentro de los límites RFC 7636
  return crypto.randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

function generateState(): string {
  return crypto.randomBytes(24).toString('base64url')
}

// ══════════════════════════════════════════════════════════
// DB HELPERS
// ══════════════════════════════════════════════════════════

async function storeOAuthState(state: string, codeVerifier: string, ctx: {
  redirectTo?: string; ipAddress?: string; userAgent?: string
}): Promise<void> {
  await query(
    `INSERT INTO mxm_oauth_state (state, code_verifier, redirect_to, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4::inet, $5, NOW() + INTERVAL '${STATE_TTL_MINUTES} minutes')`,
    [state, codeVerifier, ctx.redirectTo ?? null, ctx.ipAddress ?? null, ctx.userAgent ?? null]
  )
}

async function consumeOAuthState(state: string): Promise<{ codeVerifier: string; redirectTo: string | null }> {
  const row = await queryOne<{ code_verifier: string; redirect_to: string | null; usado: boolean }>(
    `UPDATE mxm_oauth_state
     SET usado = TRUE
     WHERE state = $1 AND expires_at > NOW() AND NOT usado
     RETURNING code_verifier, redirect_to, usado`,
    [state]
  )
  if (!row) throw new AppError('State OAuth inválido o expirado. Iniciá el proceso nuevamente.', 400, 'INVALID_OAUTH_STATE')
  return { codeVerifier: row.code_verifier, redirectTo: row.redirect_to }
}

async function saveMxMTokens(
  userId: string, tokens: MxMTokenResponse, cuil: string, nivel: number
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  await query(
    `INSERT INTO mxm_tokens (usuario_id, access_token, refresh_token, token_type, expires_at, scope, cuil, nivel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (usuario_id)
     DO UPDATE SET
       access_token   = EXCLUDED.access_token,
       refresh_token  = EXCLUDED.refresh_token,
       expires_at     = EXCLUDED.expires_at,
       nivel          = EXCLUDED.nivel,
       actualizado_en = NOW()`,
    [userId, tokens.access_token, tokens.refresh_token ?? null, tokens.token_type, expiresAt, SCOPES, cuil, nivel]
  )
}

async function auditLog(evento: string, data: {
  usuarioId?: string; cuil?: string; nivel?: number
  ipAddress?: string; error?: string; metadata?: Record<string, unknown>
}): Promise<void> {
  await query(
    `INSERT INTO mxm_audit_log (usuario_id, evento, cuil, nivel, ip_address, error, metadata)
     VALUES ($1, $2, $3, $4, $5::inet, $6, $7)`,
    [data.usuarioId ?? null, evento, data.cuil ?? null, data.nivel ?? null,
     data.ipAddress ?? null, data.error ?? null,
     data.metadata ? JSON.stringify(data.metadata) : null]
  ).catch(e => log.mxm.warn({ e }, 'Audit log error (non-critical)'))
}

// ══════════════════════════════════════════════════════════
// MxM SERVICE — implementación real con PKCE
// ══════════════════════════════════════════════════════════

class MxMServiceReal {

  // ── Paso 1: Generar URL de autorización con PKCE ────────
  async initOAuth(ctx: {
    redirectTo?: string; ipAddress?: string; userAgent?: string
  } = {}): Promise<MxMInitResult> {
    const state         = generateState()
    const codeVerifier  = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    await storeOAuthState(state, codeVerifier, ctx)

    const params = new URLSearchParams({
      response_type:          'code',
      client_id:              env.MXM_CLIENT_ID!,
      redirect_uri:           env.MXM_REDIRECT_URI!,
      scope:                  SCOPES,
      state,
      code_challenge:         codeChallenge,
      code_challenge_method:  'S256',
    })

    const authUrl = `${MXM_BASE}/oauth/authorize?${params}`
    log.mxm.info({ state: state.slice(0, 8) + '...', ip: ctx.ipAddress }, 'MxM OAuth iniciado')

    return { authUrl, state, codeChallenge }
  }

  // ── Paso 2: Intercambiar código por tokens ──────────────
  async exchangeCode(code: string, state: string, ctx: { ipAddress?: string } = {}): Promise<{
    tokens: MxMTokenResponse; identidad: MxMIdentidad; stateData: { redirectTo: string | null }
  }> {
    // Verificar y consumir el state (CSRF protection + PKCE)
    const stateData = await consumeOAuthState(state)

    const body = new URLSearchParams({
      grant_type:     'authorization_code',
      code,
      redirect_uri:   env.MXM_REDIRECT_URI!,
      client_id:      env.MXM_CLIENT_ID!,
      client_secret:  env.MXM_CLIENT_SECRET!,
      code_verifier:  stateData.codeVerifier,
    })

    const res = await fetch(MXM_TOKEN, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (!res.ok) {
      const errBody = await res.text()
      log.mxm.error({ status: res.status, body: errBody }, 'MxM token exchange falló')
      await auditLog('token_exchange_fail', { ipAddress: ctx.ipAddress, error: errBody })
      throw new AppError('Error al obtener tokens de MxM', 502, 'MXM_TOKEN_ERROR')
    }

    const tokens = await res.json() as MxMTokenResponse
    const identidad = await this.getIdentidad(tokens.access_token)

    log.mxm.info({ cuil: identidad.cuil, nivel: identidad.nivel }, 'MxM token exchange exitoso')
    return { tokens, identidad, stateData }
  }

  // ── Obtener identidad del usuario ───────────────────────
  async getIdentidad(accessToken: string): Promise<MxMIdentidad> {
    const res = await fetch(MXM_USERINFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new AppError('Error al obtener identidad MxM', 502, 'MXM_IDENTIDAD_ERROR')

    const raw = await res.json() as MxMUserInfoRaw

    // Normalizar respuesta — MxM puede devolver campos con nombres distintos
    const cuil  = raw.cuil ?? ''
    const dni   = raw.dni  ?? cuil.replace(/-/g, '').slice(2, -1)
    const nivel = raw.nivel ?? raw.nivel_identidad ?? 1

    return {
      sub:      raw.sub,
      cuil,
      dni,
      nombre:   raw.given_name ?? raw.name?.split(' ')[0] ?? 'Usuario',
      apellido: raw.family_name ?? raw.name?.split(' ').slice(1).join(' ') ?? 'MxM',
      email:    raw.email,
      nivel:    nivel as 1 | 2,
    }
  }

  // ── Refrescar access token MxM ──────────────────────────
  async refreshToken(userId: string): Promise<MxMTokenResponse | null> {
    const stored = await queryOne<{ refresh_token: string | null; expires_at: Date }>(
      `SELECT refresh_token, expires_at FROM mxm_tokens WHERE usuario_id = $1`, [userId]
    )

    if (!stored?.refresh_token) return null

    // Si todavía no expiró, devolver null (no es necesario refrescar)
    if (new Date(stored.expires_at) > new Date(Date.now() + 60_000)) return null

    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: stored.refresh_token,
      client_id:     env.MXM_CLIENT_ID!,
      client_secret: env.MXM_CLIENT_SECRET!,
    })

    try {
      const res = await fetch(MXM_TOKEN, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const tokens = await res.json() as MxMTokenResponse
      const identidad = await this.getIdentidad(tokens.access_token)
      await saveMxMTokens(userId, tokens, identidad.cuil, identidad.nivel)
      log.mxm.info({ userId }, 'MxM access token refrescado')
      return tokens
    } catch (err) {
      log.mxm.warn({ err, userId }, 'MxM refresh token falló')
      return null
    }
  }

  // ── Pago de tasa CIT via gateway oficial ────────────────
  async iniciarPago(accessToken: string, payload: MxMPagoRequest): Promise<string> {
    const res = await fetch(MXM_PAGOS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new AppError('Error al iniciar pago MxM', 502, 'MXM_PAGO_ERROR')
    return ((await res.json()) as { pagoId: string }).pagoId
  }

  // ── Expediente en sistema provincial ───────────────────
  async crearExpediente(accessToken: string, citId: string): Promise<string> {
    const res = await fetch(MXM_TRAMITES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ tipo: 'CIT_BICICLETA', citId, ley: '9556' }),
    })
    if (!res.ok) throw new AppError('Error al crear expediente', 502, 'MXM_TRAMITE_ERROR')
    return ((await res.json()) as { expedienteId: string }).expedienteId
  }

  // ── Notificación oficial — endpoint gubernamental ────────
  async enviarNotificacion(
    accessToken:  string,
    titulo:       string,
    cuerpo:       string,
    opciones?: {
      tipoMxM?:     string   // INFORMATIVA | ACCION_REQUERIDA | URGENTE | LEGAL
      canalMxM?:    string   // push_email | push | email | sms
      validezLegal?: boolean
      cuil?:         string
      datosExtra?:   Record<string, unknown>
      idempotencyKey?: string  // para reintentos seguros
    }
  ): Promise<{ mxmNotifId?: string; entregada: boolean; httpStatus: number }> {
    const payload = {
      titulo,
      cuerpo,
      tipo:         opciones?.tipoMxM    ?? 'INFORMATIVA',
      canal:        opciones?.canalMxM   ?? 'push_email',
      validezLegal: opciones?.validezLegal ?? false,
      ...(opciones?.cuil        ? { cuil:       opciones.cuil }       : {}),
      ...(opciones?.datosExtra  ? { datos:      opciones.datosExtra }  : {}),
      source: 'RODAID',
      version: 'v1',
    }

    const headers: Record<string, string> = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'Accept':        'application/json',
    }
    if (opciones?.idempotencyKey) {
      headers['Idempotency-Key'] = opciones.idempotencyKey
    }

    const res = await fetch(MXM_NOTIF, {
      method:  'POST',
      headers,
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(8_000),
    })

    const httpStatus = res.status
    let mxmNotifId: string | undefined

    if (res.ok) {
      try {
        const body = await res.json() as { notificacionId?: string; id?: string }
        mxmNotifId = body.notificacionId ?? body.id
      } catch { /* ignorar si no hay body JSON */ }
      return { mxmNotifId, entregada: true, httpStatus }
    }

    // Errores esperados
    const errBody = await res.text().catch(() => '')
    const errMsg = `MxM HTTP ${httpStatus}: ${errBody.slice(0, 200)}`

    if (httpStatus === 429) {
      log.mxm.warn({ titulo, httpStatus }, 'MxM rate limit — reintentar más tarde')
    } else if (httpStatus >= 500) {
      log.mxm.error({ titulo, httpStatus, errBody: errBody.slice(0, 100) }, 'MxM error 5xx')
    } else {
      log.mxm.warn({ titulo, httpStatus }, `MxM notificación rechazada`)
    }

    throw Object.assign(new Error(errMsg), { code: 'MXM_NOTIF_ERROR', httpStatus })
  }
}

// ══════════════════════════════════════════════════════════
// MxM STUB — para desarrollo sin credenciales
// ══════════════════════════════════════════════════════════

class MxMServiceStub {
  private readonly STUB_USERS: Record<string, MxMIdentidad & { sub: string; email: string }> = {
    'dev_code_nivel2': {
      sub: 'mxm-sub-' + '30123456',
      cuil: '20-30123456-7', dni: '30123456',
      nombre: 'Federico', apellido: 'De Gea',
      email: 'federico@rodaid.com.ar', nivel: 2,
    },
    'dev_code_nivel1': {
      sub: 'mxm-sub-nuevo',
      cuil: '20-99999999-9', dni: '99999999',
      nombre: 'Usuario', apellido: 'Nuevo MxM',
      email: 'nuevo.mxm@test.com', nivel: 1,
    },
    'dev_code': {
      sub: 'mxm-sub-demo',
      cuil: '20-30123456-7', dni: '30123456',
      nombre: 'Demo', apellido: 'MxM',
      email: 'demo@rodaid.com.ar', nivel: 2,
    },
  }

  async initOAuth(ctx: { redirectTo?: string; ipAddress?: string } = {}): Promise<MxMInitResult> {
    const state = generateState()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    // Persistir state igual que en producción (para que el callback funcione)
    await storeOAuthState(state, codeVerifier, ctx)

    const devCallbackBase = process.env.FRONTEND_URL ?? 'http://localhost:5173'
    const authUrl = `${devCallbackBase}/dev/mxm-callback?state=${state}&code=dev_code`

    log.mxm.warn({ authUrl }, '⚠️  MxM STUB — redirigir a URL simulada')
    return { authUrl, state, codeChallenge }
  }

  async exchangeCode(code: string, state: string, _ctx: { ipAddress?: string } = {}): Promise<{
    tokens: MxMTokenResponse; identidad: MxMIdentidad & { sub: string; email?: string }; stateData: { redirectTo: string | null }
  }> {
    const stateData = await consumeOAuthState(state)
    const stubUser  = this.STUB_USERS[code] ?? this.STUB_USERS['dev_code']

    log.mxm.warn({ code, nivel: stubUser.nivel }, '⚠️  MxM STUB — identidad simulada')

    return {
      tokens: {
        access_token:  `stub_mxm_access_${Date.now()}`,
        refresh_token: `stub_mxm_refresh_${Date.now()}`,
        expires_in:    3600,
        token_type:    'Bearer',
      },
      identidad: stubUser,
      stateData,
    }
  }

  async getIdentidad(_token: string): Promise<MxMIdentidad> {
    return { sub: 'stub-sub', cuil: '20-30123456-7', dni: '30123456', nombre: 'Demo', apellido: 'MxM', nivel: 2 } as any
  }

  async refreshToken(_userId: string): Promise<null> { return null }

  async iniciarPago(_token: string, _p: MxMPagoRequest): Promise<string> {
    log.mxm.warn('MxM STUB: pago simulado')
    return 'pago_stub_' + Date.now()
  }

  async crearExpediente(_token: string, _citId: string): Promise<string> {
    return 'EXP-STUB-' + Date.now()
  }

  async enviarNotificacion(
    _token:    string,
    titulo:    string,
    _cuerpo:   string,
    opciones?: Record<string, unknown>
  ): Promise<{ mxmNotifId?: string; entregada: boolean; httpStatus: number }> {
    log.mxm.debug({ titulo, tipo: opciones?.tipoMxM ?? 'INFORMATIVA' }, '⚠ MxM STUB: notificación simulada')
    return { mxmNotifId: 'stub_notif_' + Date.now(), entregada: true, httpStatus: 200 }
  }
}

// ══════════════════════════════════════════════════════════
// LÓGICA DE NEGOCIO — vincular MxM con RODAID
// ══════════════════════════════════════════════════════════

export async function processMxMCallback(
  code: string,
  state: string,
  ctx: { ipAddress?: string; userAgent?: string } = {}
): Promise<MxMCallbackResult> {
  const { tokens, identidad, stateData } = await mxmService.exchangeCode(code, state, ctx)

  const id = (identidad as any)

  // Verificar que el usuario tiene el nivel requerido
  // Nivel 1 puede registrarse; solo nivel 2 puede emitir CITs
  if (identidad.nivel < 1) {
    await auditLog('login_nivel_insuficiente', {
      cuil: identidad.cuil, nivel: identidad.nivel, ipAddress: ctx.ipAddress,
    })
    throw new AppError('Identidad MxM insuficiente. Se requiere nivel 1 o superior.', 403, 'MXM_NIVEL_INSUFICIENTE')
  }

  let isNewUser = false
  let usuarioId: string

  // Buscar usuario existente por: sub MxM > DNI > email MxM
  const existente = await queryOne<{ id: string; email: string; nombre: string; apellido: string; rol: string; mxm_nivel: number; email_verificado: boolean }>(
    `SELECT u.id, u.email, u.nombre, u.apellido, u.rol, u.mxm_nivel, u.email_verificado
     FROM usuarios u
     WHERE u.mxm_sub = $1
        OR u.dni = $2
        OR (u.email = $3 AND u.email_verificado = TRUE)
     LIMIT 1`,
    [id.sub ?? null, identidad.dni, id.email ?? null]
  )

  if (existente) {
    usuarioId = existente.id

    // Actualizar datos MxM del usuario existente
    await query(
      `UPDATE usuarios SET
         mxm_sub              = $2,
         mxm_verificado       = TRUE,
         mxm_nivel            = $3,
         mxm_nivel_verificado = $3,
         mxm_email            = $4,
         mxm_ultimo_login     = NOW(),
         email_verificado     = CASE WHEN NOT email_verificado THEN TRUE ELSE email_verificado END,
         email_verificado_en  = CASE WHEN NOT email_verificado THEN NOW() ELSE email_verificado_en END,
         actualizado_en       = NOW()
       WHERE id = $1`,
      [usuarioId, id.sub ?? identidad.cuil, identidad.nivel, id.email ?? null]
    )

    log.mxm.info({
      userId: usuarioId, cuil: identidad.cuil,
      nivel: identidad.nivel, isNew: false,
    }, 'MxM login — usuario existente vinculado')

  } else {
    // Crear nuevo usuario verificado por MxM
    isNewUser = true
    const emailMxM = id.email ?? `${identidad.cuil.replace(/-/g, '')}@mxm.mendoza.gob.ar`

    const rows = await transaction(async (client) => {
      const plan = await client.query<{ id: string }>(`SELECT id FROM planes WHERE nombre = 'libre' LIMIT 1`)
      const planId = plan.rows[0]?.id ?? null

      return client.query<{ id: string }>(
        `INSERT INTO usuarios
           (email, nombre, apellido, dni, cuil, rol, plan_id,
            mxm_sub, mxm_verificado, mxm_nivel, mxm_nivel_verificado, mxm_email, mxm_ultimo_login,
            email_verificado, email_verificado_en)
         VALUES ($1,$2,$3,$4,$5,'CICLISTA',$6, $7,TRUE,$8,$8,$9,NOW(), TRUE,NOW())
         RETURNING id`,
        [emailMxM, identidad.nombre, identidad.apellido,
         identidad.dni, identidad.cuil, planId,
         id.sub ?? identidad.cuil, identidad.nivel,
         id.email ?? null]
      )
    })

    usuarioId = rows.rows[0].id
    log.mxm.info({
      userId: usuarioId, cuil: identidad.cuil,
      nivel: identidad.nivel, isNew: true,
    }, 'MxM login — nuevo usuario creado')
  }

  // Persistir tokens MxM en DB para uso futuro
  await saveMxMTokens(usuarioId, tokens, identidad.cuil, identidad.nivel)

  // Audit log exitoso
  await auditLog('login_ok', {
    usuarioId, cuil: identidad.cuil, nivel: identidad.nivel, ipAddress: ctx.ipAddress,
    metadata: { isNewUser, nivel: identidad.nivel },
  })

  // Obtener usuario actualizado
  const usuario = await queryOne<{ id: string; email: string; nombre: string; apellido: string; rol: string; email_verificado: boolean }>(
    `SELECT id, email, nombre, apellido, rol, email_verificado FROM usuarios WHERE id = $1`, [usuarioId]
  )!

  // Emitir JWT RODAID
  const { buildTokenPair } = await import('./jwt.service')
  const jwtTokens = await buildTokenPair(
    usuarioId, usuario!.email, usuario!.rol as any, { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent }
  )

  return {
    usuario: {
      id:             usuario!.id,
      email:          usuario!.email,
      nombre:         usuario!.nombre,
      apellido:       usuario!.apellido,
      rol:            usuario!.rol,
      emailVerificado: true,
      mxmNivel:       identidad.nivel,
    },
    ...jwtTokens,
    isNewUser,
    mxmNivel: identidad.nivel,
  }
}

// Obtener MxM access token vigente para un usuario (refresca si expiró)
export async function getMxMAccessToken(userId: string): Promise<string | null> {
  // Delegamos al servicio de renovación proactiva con buffer + lock + retry
  const { getAccessTokenConRenovacion } = await import('./mxm.token.refresh.service')
  const result = await getAccessTokenConRenovacion(userId)
  return result.token
}

// URL de autorización (backward compat)
export function getMxMAuthUrl(state: string): string {
  if (isDev || !env.MXM_CLIENT_ID) {
    const base = process.env.FRONTEND_URL ?? 'http://localhost:5173'
    return `${base}/dev/mxm-callback?state=${state}&code=dev_code`
  }
  const params = new URLSearchParams({
    response_type: 'code', client_id: env.MXM_CLIENT_ID!, redirect_uri: env.MXM_REDIRECT_URI!,
    scope: SCOPES, state,
  })
  return `${MXM_BASE}/oauth/authorize?${params}`
}

// ── Purgar states expirados ───────────────────────────────
export async function purgeExpiredStates(): Promise<number> {
  const result = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM mxm_oauth_state WHERE expires_at < NOW() RETURNING state
     ) SELECT COUNT(*)::text AS count FROM deleted`
  )
  return parseInt(result[0]?.count ?? '0')
}

// ── Obtener historial de logins MxM ──────────────────────
export async function getMxMAuditLog(userId: string, limit = 20) {
  return query<Record<string, unknown>>(
    `SELECT evento, nivel, ip_address::text, creado_en, error
     FROM mxm_audit_log WHERE usuario_id = $1
     ORDER BY creado_en DESC LIMIT $2`,
    [userId, limit]
  )
}

// ── Instancia del servicio ────────────────────────────────
const hasMxMConfig = !!(env.MXM_CLIENT_ID && env.MXM_CLIENT_SECRET)
export const mxmService: MxMServiceReal | MxMServiceStub =
  hasMxMConfig ? new MxMServiceReal() : new MxMServiceStub()
