import { NextResponse } from 'next/server'
import { catalogoScopes } from '@/src/services/developer.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /.well-known/oauth-authorization-server — Hito 16: documento de descubrimiento
 * OAuth2 / OpenID Connect del ecosistema Open-Connect (RFC 8414).
 *
 * Permite que las herramientas y SDKs de terceros descubran automáticamente los
 * endpoints de autorización y token, los scopes soportados y los métodos PKCE.
 */
export async function GET(req: Request) {
  const origin = process.env.RODAID_BASE_URL?.replace(/\/+$/, '') || new URL(req.url).origin
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/conectar`,
      token_endpoint: `${origin}/api/v1/developer/oauth/token`,
      jwks_uri: `${origin}/.well-known/jwks.json`,
      scopes_supported: catalogoScopes().map((s) => s.id),
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      code_challenge_methods_supported: ['S256', 'plain'],
      service_documentation: `${origin}/desarrolladores`,
    },
    { headers: { 'cache-control': 'public, max-age=300' } }
  )
}
