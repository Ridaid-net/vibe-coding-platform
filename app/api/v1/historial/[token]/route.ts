import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { obtenerHistorialPublico } from '@/src/services/garaje-publico.service'
import { chequearRateLimit, hashIp } from '@/src/services/verificacion.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/historial/:token — Historial Clinico publico (Hito "Score de
 * Confianza" / compartir). Endpoint ABIERTO (sin requireAuth), destino del
 * link/QR que el dueño activa desde el Garaje Digital.
 *
 * Mismo rate limiting que /api/v1/verificar/:serial (reusa
 * chequearRateLimit()/hashIp() tal cual). El token en si ya es un
 * identificador de 128 bits -- el rate limit acota fuerza bruta igual que en
 * el Verificador Publico, no porque el token sea debil.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const ip = obtenerIp(req)
    const ipHash = hashIp(ip)
    const rate = await chequearRateLimit(ipHash)
    if (!rate.permitido) {
      return NextResponse.json(
        {
          error: 'RATE_LIMITED',
          message: 'Demasiadas consultas. Espera unos segundos antes de volver a intentar.',
          retryAfter: rate.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rate.retryAfter),
            'X-RateLimit-Limit': String(rate.limite),
            'X-RateLimit-Remaining': '0',
          },
        }
      )
    }

    const historial = await obtenerHistorialPublico(token)
    if (!historial) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Este link no existe o ya no esta disponible.' },
        { status: 404 }
      )
    }

    return NextResponse.json(historial, {
      headers: {
        'X-RateLimit-Limit': String(rate.limite),
        'X-RateLimit-Remaining': String(rate.restantes),
        'Cache-Control': 'public, max-age=15',
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}

/**
 * IP del consultante. En Netlify el valor confiable es
 * `x-nf-client-connection-ip`; se cae a la primera IP de `x-forwarded-for`.
 */
function obtenerIp(req: Request): string | null {
  const nf = req.headers.get('x-nf-client-connection-ip')
  if (nf && nf.trim()) return nf.trim()
  const xff = req.headers.get('x-forwarded-for')
  if (xff && xff.trim()) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')?.trim() || null
}
