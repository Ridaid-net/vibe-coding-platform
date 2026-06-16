import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import {
  buscarYVerificar,
  chequearRateLimit,
  hashIp,
  normalizarTermino,
  registrarConsulta,
} from '@/src/services/verificacion.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/verificar/:serial — Verificador Publico (Hito 7).
 *
 * Endpoint ABIERTO (sin requireAuth): cualquiera puede consultar el estado de
 * una bicicleta por su numero de serie o codigo CIT. Devuelve un veredicto
 * semaforico (SEGURO / ROBADA / EN_VALIDACION / SIN_VERIFICAR / NO_ENCONTRADA),
 * la marca/modelo y si la huella del CIT coincide con el registro en la BFA.
 *
 * Seguridad:
 *   - Rate limiting estricto por IP (fixed-window) para evitar la enumeracion
 *     por fuerza bruta de los numeros de serie.
 *   - NUNCA expone datos personales del propietario (solo el estado del bien).
 *   - Cada consulta queda en `logs_verificaciones` de forma ANONIMA (la IP solo
 *     como hash) para analitica de uso.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ serial: string }> }
) {
  try {
    const { serial } = await params
    const termino = normalizarTermino(decodeURIComponent(serial ?? ''))

    if (termino.length < 3 || termino.length > 120) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message:
            'Ingresa un numero de serie o codigo CIT valido (entre 3 y 120 caracteres).',
        },
        { status: 400 }
      )
    }

    // Rate limiting estricto por IP (anonima: solo se persiste el hash).
    const ip = obtenerIp(req)
    const ipHash = hashIp(ip)
    const rate = await chequearRateLimit(ipHash)
    if (!rate.permitido) {
      return NextResponse.json(
        {
          error: 'RATE_LIMITED',
          message:
            'Demasiadas consultas. Espera unos segundos antes de volver a intentar.',
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

    // Busqueda + veredicto (sin datos del propietario).
    const veredicto = await buscarYVerificar(termino)

    // Bitacora anonima (best-effort, no bloquea la respuesta).
    await registrarConsulta({
      consulta: termino,
      tipoBusqueda: veredicto.tipoBusqueda,
      veredicto: veredicto.estado,
      encontrada: veredicto.encontrada,
      ipHash,
      userAgent: req.headers.get('user-agent'),
    })

    return NextResponse.json(veredicto, {
      headers: {
        'X-RateLimit-Limit': String(rate.limite),
        'X-RateLimit-Remaining': String(rate.restantes),
        // Resultado cacheable brevemente por CDN/cliente sin filtrar nada privado.
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
