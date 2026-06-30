import { NextResponse } from 'next/server'
import {
  buildAuthorizationUrl,
  firmarFlowState,
  getMxmConfig,
  getRedirectUri,
  MXM_FLOW_COOKIE,
  nuevoFlowState,
} from '@/src/services/mxm.service'
import { jsonError } from '@/lib/marketplace'

export const runtime = 'nodejs'

/**
 * GET /api/v1/auth/mxm/login — Inicia el login con Mendoza por Mi (OIDC).
 *
 * Genera el estado del flujo (state + nonce + PKCE), lo guarda firmado en una
 * cookie httpOnly y redirige al endpoint de autorizacion del IDP. En modo
 * SIMULADO ese endpoint es nuestro sandbox interno, que permite ejercitar el
 * flujo completo en preview sin tocar los datos reales del Gobierno.
 *
 * `returnTo` (query, opcional): a donde volver en el frontend tras autenticar.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const config = getMxmConfig()
    const redirectUri = getRedirectUri(url.origin)
    const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'))

    const flow = nuevoFlowState(redirectUri, returnTo)
    let authorizationUrl = buildAuthorizationUrl(config, flow)
    // En SIMULADO el endpoint es una ruta relativa: la absolutizamos al host.
    if (authorizationUrl.startsWith('/')) {
      authorizationUrl = `${url.origin}${authorizationUrl}`
    }

    const cookieValue = await firmarFlowState(flow)
    const res = NextResponse.redirect(authorizationUrl)
    res.cookies.set(MXM_FLOW_COOKIE, cookieValue, {
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'lax',
      path: '/api/v1/auth/mxm',
      maxAge: 10 * 60,
    })
    return res
  } catch (error) {
    return jsonError(error)
  }
}

/** Solo permite rutas internas relativas para evitar open-redirect. */
function sanitizeReturnTo(value: string | null): string {
  if (value && value.startsWith('/') && !value.startsWith('//')) {
    return value
  }
  return '/garaje'
}
