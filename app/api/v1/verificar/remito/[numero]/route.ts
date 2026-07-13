import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { obtenerVerificacionPublicaRemito } from '@/src/services/remito.service'
import { chequearRateLimit, hashIp } from '@/src/services/verificacion.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/verificar/remito/:numero — Verificador Publico de Remitos.
 *
 * Endpoint ABIERTO (sin requireAuth), mismo espiritu que
 * /api/v1/verificar/:serial (bicis): cualquiera que escanee el QR del PDF
 * puede confirmar que el remito es genuino y ver su estado actual, sin
 * necesitar cuenta. Reusa el mismo rate limiting por IP
 * (verificacion.service.ts) para compartir el mismo presupuesto anti-fuerza-
 * bruta que el verificador de bicis -- misma amenaza (enumeracion), sin
 * escribir en logs_verificaciones (esa tabla y su tipo_busqueda estan
 * modeladas para el veredicto semaforico de bicis, no para remitos; no vale
 * la pena forzar el mismo esquema para un evento de negocio distinto).
 *
 * Deliberadamente NO expone vendedor/comprador/taller: esos datos SI viajan
 * impresos en el PDF (que solo llega a las partes por canales
 * autenticados), pero esta respuesta publica es mas conservadora.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const { numero } = await params
    const termino = decodeURIComponent(numero ?? '').trim()

    if (termino.length < 3 || termino.length > 40) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Numero de remito invalido.' },
        { status: 400 }
      )
    }

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

    const verificacion = await obtenerVerificacionPublicaRemito(termino)

    return NextResponse.json(
      verificacion ? { encontrado: true, ...verificacion } : { encontrado: false },
      {
        headers: {
          'X-RateLimit-Limit': String(rate.limite),
          'X-RateLimit-Remaining': String(rate.restantes),
          'Cache-Control': 'public, max-age=15',
        },
      }
    )
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
