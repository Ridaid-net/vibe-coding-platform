import { NextResponse } from 'next/server'
import { jwksPublico } from '@/src/services/credenciales-vc.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /.well-known/jwks.json — Hito 16: clave pública (JWKS) con la que cualquier
 * verificador o billetera valida los VC-JWT emitidos por RODAID (estándar W3C VC).
 */
export async function GET() {
  const jwks = await jwksPublico()
  return NextResponse.json(jwks, {
    headers: { 'cache-control': 'public, max-age=3600', 'content-type': 'application/json' },
  })
}
