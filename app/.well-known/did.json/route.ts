import { NextResponse } from 'next/server'
import { didDocument } from '@/src/services/credenciales-vc.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /.well-known/did.json — Hito 16: documento DID (`did:web`) de RODAID como
 * emisor de Credenciales Verificables. Publica el método de verificación Ed25519
 * para que las billeteras universales resuelvan y validen los VC-JWT.
 */
export async function GET(req: Request) {
  const origin = process.env.RODAID_BASE_URL?.replace(/\/+$/, '') || new URL(req.url).origin
  const doc = await didDocument(origin)
  return NextResponse.json(doc, {
    headers: { 'cache-control': 'public, max-age=3600', 'content-type': 'application/did+json' },
  })
}
