import { NextResponse } from 'next/server'
import { ApiError, getPool, jsonError, requireAuth } from '@/lib/marketplace'
import { getAppPorClientId, type DeveloperAppRow } from '@/src/services/developer.service'
import {
  crearCodigoAutorizacion,
  describirScopes,
  parsearScopes,
} from '@/src/services/oauth.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/v1/developer/oauth/authorize — Hito 16: Authorization Endpoint (OAuth2 + OIDC).
 *
 * GET  → describe la solicitud de autorización (app, scopes, bici) para que la
 *        pantalla de consentimiento (`/conectar`) la muestre. SIN autenticación:
 *        solo describe lo que se está por compartir.
 * POST → el usuario AUTENTICADO da (o niega) su consentimiento EXPRESO. Si lo
 *        otorga, se emite un código de autorización de un solo uso (PKCE) y se
 *        devuelve la `redirectUrl` final hacia la app de terceros.
 *
 * El acceso queda acotado a UNA bicicleta del usuario y a los scopes consentidos;
 * jamás se comparten datos personales: el tercero solo podrá leer estado público.
 */

interface SolicitudValidada {
  app: DeveloperAppRow
  redirectUri: string
  scopes: string[]
}

/** Valida los parámetros comunes del flujo de autorización. */
async function validarSolicitud(params: {
  clientId: string | null
  redirectUri: string | null
  scope: string | null
  responseType: string | null
}): Promise<SolicitudValidada> {
  if (params.responseType && params.responseType !== 'code') {
    throw new ApiError(400, 'UNSUPPORTED_RESPONSE_TYPE', 'Solo se admite response_type=code.')
  }
  if (!params.clientId) {
    throw new ApiError(400, 'INVALID_CLIENT', 'Falta client_id.')
  }
  const app = await getAppPorClientId(params.clientId)
  if (!app) {
    throw new ApiError(400, 'INVALID_CLIENT', 'La aplicación no existe.')
  }
  if (app.estado !== 'activa') {
    throw new ApiError(403, 'APP_SUSPENDED', 'La aplicación está suspendida.')
  }
  if (!params.redirectUri || !app.redirect_uris.includes(params.redirectUri)) {
    throw new ApiError(400, 'INVALID_REDIRECT_URI', 'redirect_uri no autorizada para esta app.')
  }
  // Los scopes pedidos se acotan a los que la app declaró.
  const pedidos = parsearScopes(params.scope)
  const scopes = pedidos.filter((s) => app.scopes.includes(s))
  if (!scopes.length) {
    throw new ApiError(400, 'INVALID_SCOPE', 'Los scopes solicitados no están habilitados para esta app.')
  }
  return { app, redirectUri: params.redirectUri, scopes }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const q = url.searchParams
    const solicitud = await validarSolicitud({
      clientId: q.get('client_id'),
      redirectUri: q.get('redirect_uri'),
      scope: q.get('scope'),
      responseType: q.get('response_type'),
    })
    return NextResponse.json(
      {
        valido: true,
        app: {
          nombre: solicitud.app.nombre,
          descripcion: solicitud.app.descripcion,
          sitioUrl: solicitud.app.sitio_url,
          entorno: solicitud.app.entorno,
        },
        scopes: describirScopes(solicitud.scopes),
        redirectUri: solicitud.redirectUri,
        state: q.get('state'),
      },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}

interface Body {
  client_id?: string
  redirect_uri?: string
  scope?: string
  state?: string
  code_challenge?: string
  code_challenge_method?: string
  bicicleta_id?: string
  aceptar?: boolean
}

function appendParams(redirectUri: string, params: Record<string, string>): string {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) {
    if (v) u.searchParams.set(k, v)
  }
  return u.toString()
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as Body

    const solicitud = await validarSolicitud({
      clientId: body.client_id ?? null,
      redirectUri: body.redirect_uri ?? null,
      scope: body.scope ?? null,
      responseType: 'code',
    })

    // El usuario negó el consentimiento: se vuelve a la app con un error estándar.
    if (body.aceptar === false) {
      return NextResponse.json({
        redirectUrl: appendParams(solicitud.redirectUri, {
          error: 'access_denied',
          ...(body.state ? { state: body.state } : {}),
        }),
      })
    }

    // El consentimiento siempre se acota a UNA bici del usuario.
    const bicicletaId = typeof body.bicicleta_id === 'string' ? body.bicicleta_id : ''
    if (!bicicletaId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Elegí la bicicleta cuyo estado querés compartir.')
    }
    const bici = await getPool().query<{ id: string }>(
      `SELECT id FROM bicicletas WHERE id = $1 AND propietario_id = $2`,
      [bicicletaId, user.id]
    )
    if (!bici.rows[0]) {
      throw new ApiError(403, 'NOT_OWNER', 'Esa bicicleta no figura a tu nombre.')
    }

    const code = await crearCodigoAutorizacion({
      appId: solicitud.app.id,
      usuarioId: user.id,
      bicicletaId,
      scopes: solicitud.scopes,
      redirectUri: solicitud.redirectUri,
      codeChallenge: body.code_challenge ?? null,
      codeChallengeMethod: body.code_challenge_method ?? null,
    })

    return NextResponse.json(
      {
        redirectUrl: appendParams(solicitud.redirectUri, {
          code,
          ...(body.state ? { state: body.state } : {}),
        }),
      },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
