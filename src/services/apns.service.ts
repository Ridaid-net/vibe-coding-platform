// ─── RODAID · Apple Push Notification Service (APNs) ─────
// Envía push notifications directamente a dispositivos iOS
// sin depender de Firebase — usando la APNs HTTP/2 API v3.
//
// Autenticación JWT (token-based, recomendada por Apple):
//   · Clave privada EC (P-256 / ES256) — archivo .p8 de Apple
//   · Token JWT firmado: { alg:'ES256', kid:KEY_ID } + { iss:TEAM_ID, iat:now }
//   · Válido 60 min — se renueva automáticamente con buffer de 5 min
//
// Flujos soportados:
//   Notificación estándar   → push_type=alert, prioridad=10
//   Notificación silenciosa → push_type=background, prioridad=5, content-available=1
//   Notificación rica       → mutable-content=1 + service extension en la app
//   Colapso                 → apns-collapse-id (un push reemplaza al anterior del mismo ID)
//
// Push types soportados:
//   alert      → notificación visible con alerta
//   background → wake silencioso de la app (sin barra)
//   location   → para actualizaciones de ubicación
//   voip       → llamadas (PushKit)
//
// Environments:
//   sandbox    → api.sandbox.push.apple.com (TestFlight / Xcode dev)
//   production → api.push.apple.com (App Store)
//
// Variables de entorno:
//   APNS_KEY_ID      — 10 chars, desde Apple Developer Console
//   APNS_TEAM_ID     — 10 chars, desde Apple Developer Console
//   APNS_PRIVATE_KEY — contenido del archivo .p8 (EC private key)
//   APNS_BUNDLE_ID   — com.rodaid.app
//   APNS_ENVIRONMENT — sandbox | production (default: sandbox)
//
// Modo STUB (sin credenciales):
//   → loguea el intento, devuelve éxito simulado
//   → todos los tests pasan sin conexión a Apple
//
// Integración con FCM:
//   · Si la app iOS usa Firebase SDK → usar fcm.service.ts (FCM reenvía a APNs)
//   · Si la app iOS es nativa sin Firebase → usar este servicio directamente
//   · El dispatcher notif.dispatcher.ts detecta automáticamente el push_tipo
//     del token y enruta al servicio correcto

import http2             from 'http2'
import crypto            from 'crypto'
import { query, queryOne } from '../config/database'
import { log }           from '../middleware/logger'
import { env }           from '../config/env'

// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════

const APNS_HOST_PROD    = 'api.push.apple.com'
const APNS_HOST_SANDBOX = 'api.sandbox.push.apple.com'
const APNS_PORT         = 443
const JWT_BUFFER_SEC    = 300   // renovar 5 min antes de vencer
const JWT_TTL_SEC       = 3600  // tokens válidos 1 hora

const MODO_LIVE = !!(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY)
const BUNDLE_ID = env.APNS_BUNDLE_ID ?? 'com.rodaid.app'
const APNS_ENV  = (env.APNS_ENVIRONMENT ?? 'sandbox') as 'sandbox' | 'production'
const APNS_HOST = APNS_ENV === 'production' ? APNS_HOST_PROD : APNS_HOST_SANDBOX

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type APNsPushType = 'alert' | 'background' | 'location' | 'voip'
export type APNsEnv      = 'sandbox' | 'production'

export interface APNsPayload {
  titulo?:    string
  subtitulo?: string
  cuerpo?:    string
  badge?:     number
  sound?:     string | { name: string; critical?: boolean; volume?: number }
  categoria?: string               // interactive notifications
  threadId?:  string               // agrupar notifs
  collapseId?: string              // reemplaza push anterior con mismo ID
  datos?:     Record<string, unknown>
  silencioso?: boolean             // background push
  mutableContent?: boolean         // rich notifications (service extension)
  pushType?:  APNsPushType
  prioridad?: 5 | 10               // 10=inmediato, 5=energy-saving
  expiracion?: number              // Unix timestamp — 0 = no reintentar
}

export interface APNsResult {
  enviado:    boolean
  apnsId?:    string               // UUID devuelto por APNs en el header apns-id
  error?:     string
  errorCode?: string               // APNS error code (Unregistered, BadDeviceToken…)
  tokenInvalido?: boolean
  stub?:      boolean
}

// ══════════════════════════════════════════════════════════
// JWT TOKEN PARA APNS
// ══════════════════════════════════════════════════════════

let _jwt:        string | null = null
let _jwtExpira:  number        = 0

/**
 * Genera (o reutiliza desde cache) el JWT Bearer token para APNs.
 * Apple requiere:
 *   header: { alg: 'ES256', kid: KEY_ID }
 *   payload: { iss: TEAM_ID, iat: <unix timestamp> }
 */
export function getJWT(): string {
  if (!MODO_LIVE) return 'STUB_APNS_JWT'

  const ahora = Math.floor(Date.now() / 1000)
  if (_jwt && ahora < _jwtExpira - JWT_BUFFER_SEC) return _jwt

  const header  = Buffer.from(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: ahora })).toString('base64url')
  const data    = `${header}.${payload}`

  // Firma ES256 con la private key del .p8
  const privateKey = env.APNS_PRIVATE_KEY!.replace(/\\n/g, '\n')
  const sign       = crypto.createSign('SHA256')
  sign.update(data)
  const signature = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')

  _jwt       = `${data}.${signature}`
  _jwtExpira = ahora + JWT_TTL_SEC

  log.mensajeria.debug({ kidSlice: env.APNS_KEY_ID?.slice(0, 4), expira: _jwtExpira }, 'JWT APNs generado')
  return _jwt
}

// ══════════════════════════════════════════════════════════
// CONEXIÓN HTTP/2 A APNs (singleton por host)
// ══════════════════════════════════════════════════════════

let _session:     http2.ClientHttp2Session | null = null
let _sessionHost: string | null                   = null

function getSession(host: string): Promise<http2.ClientHttp2Session> {
  return new Promise((resolve, reject) => {
    if (_session && !_session.destroyed && _sessionHost === host) {
      return resolve(_session)
    }
    _session?.destroy()
    const session = http2.connect(`https://${host}:${APNS_PORT}`, {
      rejectUnauthorized: true,
    })
    session.once('connect', () => {
      _session     = session
      _sessionHost = host
      log.mensajeria.debug({ host }, 'APNs HTTP/2 sesión establecida')
      resolve(session)
    })
    session.once('error', (err) => {
      _session = null
      reject(err)
    })
    session.once('goaway', () => {
      _session = null
      log.mensajeria.warn({ host }, 'APNs HTTP/2 GOAWAY — sesión cerrada por Apple')
    })
  })
}

function closeSession(): void {
  if (_session && !_session.destroyed) {
    _session.destroy()
    _session = null
  }
}

// ══════════════════════════════════════════════════════════
// CONSTRUIR PAYLOAD APS
// ══════════════════════════════════════════════════════════

function buildApsPayload(opts: APNsPayload): object {
  const aps: Record<string, unknown> = {}

  if (!opts.silencioso) {
    aps.alert = {
      ...(opts.titulo    ? { title:    opts.titulo    } : {}),
      ...(opts.subtitulo ? { subtitle: opts.subtitulo } : {}),
      ...(opts.cuerpo    ? { body:     opts.cuerpo    } : {}),
    }
    aps.sound = opts.sound ?? 'default'
  }

  if (opts.badge !== undefined) aps.badge             = opts.badge
  if (opts.categoria)           aps['category']       = opts.categoria
  if (opts.threadId)            aps['thread-id']      = opts.threadId
  if (opts.silencioso)          aps['content-available'] = 1
  if (opts.mutableContent)      aps['mutable-content']   = 1

  const datos = { ...opts.datos, source: 'RODAID' }

  return { aps, ...datos }
}

// ══════════════════════════════════════════════════════════
// ENVIAR A UN TOKEN APNS
// ══════════════════════════════════════════════════════════

export async function enviarAPNsToken(
  deviceToken: string,
  opts:        APNsPayload,
  meta?: {
    bundleId?:   string
    entorno?:    APNsEnv
    tokenId?:    string
    usuarioId?:  string
  }
): Promise<APNsResult> {

  const bundleId = meta?.bundleId ?? BUNDLE_ID
  const entorno  = meta?.entorno  ?? APNS_ENV
  const host     = entorno === 'production' ? APNS_HOST_PROD : APNS_HOST_SANDBOX

  if (!MODO_LIVE) {
    log.mensajeria.warn({
      token: deviceToken.slice(0, 10) + '...',
      bundleId, titulo: opts.titulo ?? '(background)',
    }, '⚠ APNs STUB — configurar APNS_KEY_ID + APNS_TEAM_ID + APNS_PRIVATE_KEY')

    await registrarMensaje({
      usuarioId: meta?.usuarioId, tokenId: meta?.tokenId,
      deviceToken, bundleId,
      pushType:  opts.pushType ?? (opts.silencioso ? 'background' : 'alert'),
      titulo: opts.titulo, subtitulo: opts.subtitulo, cuerpo: opts.cuerpo,
      badge: opts.badge, sound: typeof opts.sound === 'string' ? opts.sound : 'default',
      datos: opts.datos, prioridad: opts.prioridad ?? (opts.silencioso ? 5 : 10),
      estado: 'ENVIADO',
    })
    return { enviado: true, apnsId: 'stub_' + crypto.randomUUID(), stub: true }
  }

  const jwt         = getJWT()
  const pushType    = opts.pushType ?? (opts.silencioso ? 'background' : 'alert')
  const prioridad   = opts.prioridad ?? (opts.silencioso ? 5 : 10)
  const body        = Buffer.from(JSON.stringify(buildApsPayload(opts)))

  try {
    const session = await getSession(host)

    const resultado = await new Promise<APNsResult>((resolve) => {
      const req = session.request({
        ':method':           'POST',
        ':path':             `/3/device/${deviceToken}`,
        ':scheme':           'https',
        ':authority':        host,
        'authorization':     `bearer ${jwt}`,
        'content-type':      'application/json',
        'content-length':    body.length.toString(),
        'apns-topic':        bundleId,
        'apns-push-type':    pushType,
        'apns-priority':     prioridad.toString(),
        'apns-expiration':   (opts.expiracion ?? 0).toString(),
        ...(opts.collapseId ? { 'apns-collapse-id': opts.collapseId } : {}),
      })

      let respHeaders: http2.IncomingHttpHeaders = {}
      let respBody = ''

      req.on('response', (headers) => { respHeaders = headers })
      req.on('data', (chunk) => { respBody += chunk })
      req.on('end', () => {
        const status  = parseInt(String(respHeaders[':status'] ?? '0'))
        const apnsId  = String(respHeaders['apns-id'] ?? '')

        if (status === 200) {
          resolve({ enviado: true, apnsId })
          return
        }

        // Error de APNs
        let errorCode: string | undefined
        let errorMsg  = `HTTP ${status}`
        try {
          const parsed = JSON.parse(respBody)
          errorCode = parsed.reason
          errorMsg  = `${parsed.reason}: ${parsed.timestamp ?? ''}`
        } catch { /* noop */ }

        const tokenInvalido = ['Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic']
          .includes(errorCode ?? '')

        resolve({ enviado: false, apnsId, errorCode, error: errorMsg, tokenInvalido })
      })

      req.on('error', (err) => {
        closeSession()
        resolve({ enviado: false, error: err.message })
      })

      req.setTimeout(8_000, () => {
        req.destroy()
        resolve({ enviado: false, error: 'APNs timeout (8s)' })
      })

      req.write(body)
      req.end()
    })

    // Desactivar token inválido
    if (resultado.tokenInvalido && meta?.tokenId) {
      await query(`UPDATE fcm_tokens SET activo=FALSE WHERE id=$1`, [meta.tokenId]).catch(() => {})
      log.mensajeria.warn({ token: deviceToken.slice(0, 10) + '...', code: resultado.errorCode },
        'Token APNs inválido — desactivado')
    }

    const estado = resultado.enviado ? 'ENVIADO'
      : resultado.tokenInvalido ? 'INVALIDO' : 'FALLIDO'

    await registrarMensaje({
      usuarioId: meta?.usuarioId, tokenId: meta?.tokenId,
      deviceToken, apnsId: resultado.apnsId, bundleId,
      pushType, titulo: opts.titulo, subtitulo: opts.subtitulo,
      cuerpo: opts.cuerpo, badge: opts.badge,
      sound: typeof opts.sound === 'string' ? opts.sound : 'default',
      datos: opts.datos, prioridad, estado,
      errorCode: resultado.errorCode, error: resultado.error,
    })

    if (resultado.enviado) {
      log.mensajeria.info({
        token: deviceToken.slice(0, 10) + '...', bundleId, pushType,
        titulo: opts.titulo ?? '(background)', apnsId: resultado.apnsId,
      }, '🍎 APNs push enviado')
    } else {
      log.mensajeria.warn({
        token: deviceToken.slice(0, 10) + '...', errorCode: resultado.errorCode,
      }, `✗ APNs fallido: ${resultado.error}`)
    }

    return resultado

  } catch (err) {
    const errMsg = (err as Error).message
    await registrarMensaje({
      usuarioId: meta?.usuarioId, tokenId: meta?.tokenId,
      deviceToken, bundleId, pushType,
      titulo: opts.titulo, cuerpo: opts.cuerpo,
      prioridad, estado: 'FALLIDO', error: errMsg,
    })
    closeSession()
    return { enviado: false, error: errMsg }
  }
}

// ══════════════════════════════════════════════════════════
// ENVIAR A TODOS LOS TOKENS IOS DE UN USUARIO
// ══════════════════════════════════════════════════════════

export async function enviarAPNsUsuario(
  usuarioId: string,
  opts:      APNsPayload,
  opcionesMeta?: { notifId?: string }
): Promise<{ enviados: number; fallidos: number; tokens_invalidos: string[] }> {

  const tokens = await query<{
    id: string; token: string; apns_env: string; bundle_id: string | null; push_tipo: string
  }>(
    `SELECT id, token, apns_env, bundle_id, push_tipo
     FROM fcm_tokens
     WHERE usuario_id=$1 AND activo=TRUE AND plataforma='IOS'
     ORDER BY ultimo_uso DESC NULLS LAST`,
    [usuarioId]
  )

  if (tokens.length === 0) return { enviados: 0, fallidos: 0, tokens_invalidos: [] }

  const resultados = await Promise.allSettled(
    tokens.map(t => {
      if (t.push_tipo === 'fcm') {
        // Token FCM para iOS → delegar a fcm.service
        const { enviarPushToken } = require('./fcm.service')
        return enviarPushToken(t.token, 'IOS', opts, {
          tokenId: t.id, notifId: opcionesMeta?.notifId, usuarioId,
        })
      }
      // Token APNs nativo
      return enviarAPNsToken(t.token, opts, {
        bundleId:  t.bundle_id ?? BUNDLE_ID,
        entorno:   (t.apns_env as APNsEnv) ?? APNS_ENV,
        tokenId:   t.id,
        usuarioId,
      })
    })
  )

  let enviados = 0; let fallidos = 0
  const invalidos: string[] = []

  resultados.forEach((r, i) => {
    const ok = r.status === 'fulfilled' && r.value.enviado
    if (ok) {
      enviados++
    } else {
      fallidos++
      if (r.status === 'fulfilled' && r.value.tokenInvalido) {
        invalidos.push(tokens[i].token)
      }
    }
  })

  if (enviados > 0) {
    await query(
      `UPDATE fcm_tokens SET ultimo_uso=NOW() WHERE usuario_id=$1 AND plataforma='IOS' AND activo=TRUE`,
      [usuarioId]
    ).catch(() => {})
  }

  return { enviados, fallidos, tokens_invalidos: invalidos }
}

// ══════════════════════════════════════════════════════════
// PAYLOADS PREDEFINIDOS PARA RODAID
// ══════════════════════════════════════════════════════════

/** Notificación de CIT emitido — con badge + deep link */
export function payloadCITEmitido(numeroCIT: string, marca: string, modelo: string): APNsPayload {
  return {
    titulo:        '✅ CIT emitido',
    subtitulo:     `${marca} ${modelo}`,
    cuerpo:        `Tu certificado ${numeroCIT} fue registrado en la Blockchain Federal Argentina.`,
    sound:         'default',
    badge:         1,
    mutableContent: true,
    datos:         { tipo: 'CIT_APROBADO', numeroCIT, url: `rodaid://cit/${numeroCIT}` },
    categoria:     'CIT_EMITIDO',
    collapseId:    `cit-${numeroCIT}`,
  }
}

/** Notificación de denuncia — urgente, máxima prioridad */
export function payloadDenunciaRobo(serial: string, numeroDenuncia: string): APNsPayload {
  return {
    titulo:    '🚨 Denuncia registrada',
    cuerpo:    `S/N ${serial} — CIT bloqueado. Denuncia N° ${numeroDenuncia}`,
    sound:     { name: 'default', critical: true, volume: 1.0 },
    prioridad: 10,
    datos:     { tipo: 'DENUNCIA_REGISTRADA', serial, numeroDenuncia, url: `rodaid://denuncias/${numeroDenuncia}` },
    categoria: 'DENUNCIA_ROBO',
  }
}

/** Notificación silenciosa — actualizar estado en background */
export function payloadBackground(tipo: string, datos: Record<string, unknown>): APNsPayload {
  return {
    silencioso: true,
    pushType:   'background',
    prioridad:  5,
    datos:      { tipo, ...datos },
  }
}

/** Notificación de venta */
export function payloadVenta(marca: string, modelo: string, montoNeto: number): APNsPayload {
  return {
    titulo:    '💰 Venta confirmada',
    subtitulo: `${marca} ${modelo}`,
    cuerpo:    `$${montoNeto.toLocaleString('es-AR')} ARS acreditados`,
    sound:     'default',
    badge:     1,
    datos:     { tipo: 'VENTA_CONFIRMADA', url: 'rodaid://wallet' },
    categoria: 'VENTA_COMPLETADA',
  }
}

// ══════════════════════════════════════════════════════════
// REGISTRAR TOKEN APNS NATIVO
// ══════════════════════════════════════════════════════════

export async function registrarTokenAPNs(opts: {
  usuarioId:   string
  deviceToken: string
  entorno:     APNsEnv
  bundleId?:   string
  dispositivo?: string
  appVersion?:  string
}): Promise<{ tokenId: string; nuevo: boolean }> {
  const row = await queryOne<{ id: string; created: boolean }>(
    `INSERT INTO fcm_tokens
       (usuario_id, token, plataforma, dispositivo, app_version,
        apns_env, bundle_id, push_tipo, ultimo_uso)
     VALUES ($1,$2,'IOS',$3,$4,$5,$6,'apns',NOW())
     ON CONFLICT (usuario_id, token) DO UPDATE
       SET activo=TRUE, ultimo_uso=NOW(), apns_env=$5,
           bundle_id=$6, app_version=$4, actualizado_en=NOW()
     RETURNING id, (xmax=0) AS created`,
    [
      opts.usuarioId, opts.deviceToken,
      opts.dispositivo ?? null, opts.appVersion ?? null,
      opts.entorno, opts.bundleId ?? BUNDLE_ID,
    ]
  )
  log.mensajeria.info({
    usuarioId: opts.usuarioId.slice(0, 8),
    entorno: opts.entorno, nuevo: row?.created,
  }, `🍎 Token APNs ${row?.created ? 'registrado' : 'actualizado'}`)

  return { tokenId: row!.id, nuevo: !!row?.created }
}

// ══════════════════════════════════════════════════════════
// ESTADÍSTICAS APNs
// ══════════════════════════════════════════════════════════

export async function getEstadisticasAPNs(dias = 30): Promise<{
  totalMensajes: number; enviados: number; fallidos: number; invalidos: number
  sandbox: number; production: number; tasaEntrega: number
}> {
  const [msgs, tokens] = await Promise.all([
    queryOne<{ total: string; env: string; fall: string; inv: string }>(
      `SELECT
         COUNT(*)::text                                         AS total,
         COUNT(*) FILTER (WHERE estado='ENVIADO')::text        AS env,
         COUNT(*) FILTER (WHERE estado='FALLIDO')::text        AS fall,
         COUNT(*) FILTER (WHERE estado='INVALIDO')::text       AS inv
       FROM apns_mensajes WHERE enviado_en > NOW()-($1||' days')::interval`, [dias]
    ),
    queryOne<{ sandbox: string; production: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE apns_env='sandbox')::text    AS sandbox,
         COUNT(*) FILTER (WHERE apns_env='production')::text AS production
       FROM fcm_tokens WHERE plataforma='IOS' AND activo=TRUE AND push_tipo='apns'`, []
    ),
  ])
  const total = parseInt(msgs?.total ?? '0')
  const env   = parseInt(msgs?.env   ?? '0')
  return {
    totalMensajes: total,
    enviados:      env,
    fallidos:      parseInt(msgs?.fall ?? '0'),
    invalidos:     parseInt(msgs?.inv  ?? '0'),
    sandbox:       parseInt(tokens?.sandbox    ?? '0'),
    production:    parseInt(tokens?.production ?? '0'),
    tasaEntrega:   total > 0 ? Math.round(env / total * 100) : 100,
  }
}

export function getModoAPNs(): 'LIVE' | 'STUB' { return MODO_LIVE ? 'LIVE' : 'STUB' }
export function getApnsEnv(): APNsEnv { return APNS_ENV }
export function getBundleId(): string  { return BUNDLE_ID }

// ── Helper privado ──────────────────────────────────────
async function registrarMensaje(opts: {
  usuarioId?: string; tokenId?: string; deviceToken: string
  apnsId?: string; bundleId?: string; pushType?: string
  titulo?: string; subtitulo?: string; cuerpo?: string
  badge?: number; sound?: string; categoria?: string
  datos?: Record<string, unknown>; collapseId?: string; prioridad?: number
  estado: string; errorCode?: string; error?: string
}): Promise<void> {
  await query(
    `INSERT INTO apns_mensajes
       (usuario_id, token_id, device_token, apns_id, bundle_id, push_type,
        titulo, subtitulo, cuerpo, badge, sound, categoria,
        datos_extra, collapse_id, prioridad, estado, error_code, error_msg)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18)`,
    [
      opts.usuarioId ?? null, opts.tokenId ?? null,
      opts.deviceToken, opts.apnsId ?? null, opts.bundleId ?? null,
      opts.pushType ?? 'alert',
      opts.titulo ?? null, opts.subtitulo ?? null, opts.cuerpo ?? null,
      opts.badge ?? null, opts.sound ?? null, opts.categoria ?? null,
      opts.datos ? JSON.stringify(opts.datos) : null,
      opts.collapseId ?? null, opts.prioridad ?? 10,
      opts.estado, opts.errorCode ?? null, opts.error ?? null,
    ]
  ).catch(() => {})
}
