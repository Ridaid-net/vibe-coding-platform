import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import {
  verificarSerial,
  type OrigenVerificacion,
} from '@/src/services/verificador.service'

export const runtime = 'nodejs'

const ORIGENES: OrigenVerificacion[] = ['API', 'WEB', 'APP', 'QR']

function parseOrigen(value: string | null): OrigenVerificacion {
  const upper = value?.toUpperCase()
  return ORIGENES.includes(upper as OrigenVerificacion) ? (upper as OrigenVerificacion) : 'API'
}

/**
 * GET /api/v1/verificar/:serial — verificación pública de un CIT por número de
 * serie. Consulta real en la base de datos, con datos del propietario ofuscados
 * y alertas de denuncias de robo activas. Cada consulta queda auditada.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ serial: string }> }
) {
  try {
    const { serial } = await params
    const origen = parseOrigen(new URL(req.url).searchParams.get('origen'))
    const data = await verificarSerial(decodeURIComponent(serial), {
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
