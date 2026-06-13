import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { estadoCIT } from '@/src/services/cit-estado.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/cit/numero/:numeroCIT — estado efectivo de un CIT por su número
 * (RCIT-2026-00041). Alias explícito de GET /api/v1/cit/:id pensado para QR y
 * enlaces. Público.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ numeroCIT: string }> }
) {
  try {
    const { numeroCIT } = await params
    const data = await estadoCIT(decodeURIComponent(numeroCIT))
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return jsonError(error)
  }
}
