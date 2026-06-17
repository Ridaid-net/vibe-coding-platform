import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import {
  autenticarCliente,
  getAppPorClientId,
} from '@/src/services/developer.service'
import { canjearCodigo, emitirAccessToken } from '@/src/services/oauth.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/developer/oauth/token — Hito 16: Token Endpoint (OAuth2).
 *
 * Canjea un código de autorización por un access token OPACO. Autentica al
 * cliente de dos formas estándar:
 *   - Confidencial: `client_id` + `client_secret` (en el body o por Basic Auth).
 *   - Público (PKCE): `client_id` + `code_verifier` (sin secret).
 *
 * Acepta `application/x-www-form-urlencoded` (estándar OAuth2) y JSON.
 */

interface Campos {
  grant_type?: string
  code?: string
  redirect_uri?: string
  client_id?: string
  client_secret?: string
  code_verifier?: string
}

function oauthError(error: string, descripcion: string, status = 400) {
  return NextResponse.json(
    { error, error_description: descripcion },
    { status, headers: { 'cache-control': 'no-store' } }
  )
}

/** Lee client_id/secret de la cabecera Basic, si está presente. */
function basicAuth(req: Request): { id: string; secret: string } | null {
  const header = req.headers.get('authorization')
  const m = header?.match(/^Basic\s+(.+)$/i)
  if (!m) return null
  try {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    if (idx < 0) return null
    return {
      id: decodeURIComponent(decoded.slice(0, idx)),
      secret: decodeURIComponent(decoded.slice(idx + 1)),
    }
  } catch {
    return null
  }
}

async function leerCampos(req: Request): Promise<Campos> {
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    return (await req.json().catch(() => ({}))) as Campos
  }
  const text = await req.text().catch(() => '')
  const params = new URLSearchParams(text)
  const out: Campos = {}
  for (const [k, v] of params) (out as Record<string, string>)[k] = v
  return out
}

export async function POST(req: Request) {
  try {
    const campos = await leerCampos(req)
    if (campos.grant_type !== 'authorization_code') {
      return oauthError('unsupported_grant_type', 'Solo se admite grant_type=authorization_code.')
    }

    const basic = basicAuth(req)
    const clientId = basic?.id ?? campos.client_id ?? ''
    const clientSecret = basic?.secret ?? campos.client_secret ?? null
    if (!clientId) {
      return oauthError('invalid_client', 'Falta client_id.', 401)
    }
    if (!campos.code || !campos.redirect_uri) {
      return oauthError('invalid_request', 'Faltan code o redirect_uri.')
    }

    // Autenticación del cliente.
    let appId: string
    if (clientSecret) {
      const app = await autenticarCliente(clientId, clientSecret)
      if (!app) return oauthError('invalid_client', 'Credenciales de cliente inválidas.', 401)
      appId = app.id
    } else {
      // Cliente público: debe usar PKCE (code_verifier).
      const app = await getAppPorClientId(clientId)
      if (!app || app.estado !== 'activa') {
        return oauthError('invalid_client', 'Cliente desconocido o suspendido.', 401)
      }
      if (!campos.code_verifier) {
        return oauthError('invalid_request', 'Cliente público: falta code_verifier (PKCE).')
      }
      appId = app.id
    }

    const canjeado = await canjearCodigo({
      code: campos.code,
      redirectUri: campos.redirect_uri,
      appId,
      codeVerifier: campos.code_verifier ?? null,
    })
    if (!canjeado) {
      return oauthError('invalid_grant', 'El código es inválido, expiró o ya fue usado.')
    }

    const token = await emitirAccessToken({
      appId: canjeado.appId,
      usuarioId: canjeado.usuarioId,
      bicicletaId: canjeado.bicicletaId,
      scopes: canjeado.scopes,
    })

    return NextResponse.json(
      {
        access_token: token.accessToken,
        token_type: 'Bearer',
        expires_in: token.expiresIn,
        scope: token.scope,
      },
      { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
