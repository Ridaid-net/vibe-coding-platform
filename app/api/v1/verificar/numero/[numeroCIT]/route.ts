import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import {
  verificarNumeroCIT,
  type OrigenVerificacion,
} from '@/src/services/verificador.service'

export const runtime = 'nodejs'

const ORIGENES: OrigenVerificacion[] = ['API', 'WEB', 'APP', 'QR']

function parseOrigen(value: string | null): OrigenVerificacion {
  const upper = value?.toUpperCase()
  return ORIGENES.includes(upper as OrigenVerificacion) ? (upper as OrigenVerificacion) : 'API'
}

/**
 * GET /api/v1/verificar/numero/:numeroCIT — verificación pública por número de
 * CIT (p. ej. RCIT-2026-00139).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ numeroCIT: string }> }
) {
  try {
    const { numeroCIT } = await params
    const origen = parseOrigen(new URL(req.url).searchParams.get('origen'))
    const data = await verificarNumeroCIT(decodeURIComponent(numeroCIT), {
      origen,
      ip:
        req.headers.get('x-nf-client-connection-ip') ??
        req.headers.get('x-forwarded-for'),
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return jsonError(error)
  }
}
