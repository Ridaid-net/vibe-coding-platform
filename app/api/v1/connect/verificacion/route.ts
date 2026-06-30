import { NextResponse } from 'next/server'
import { getPool, jsonError } from '@/lib/marketplace'
import {
  chequearRateLimitApp,
  hashIpDev,
  registrarUso,
} from '@/src/services/developer.service'
import { validarAccessToken } from '@/src/services/oauth.service'
import { buscarYVerificar } from '@/src/services/verificacion.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/connect/verificacion — Hito 16: recurso PÚBLICO consumido por terceros.
 *
 * Es el recurso que una app externa lee con su access token OAuth2. Devuelve el
 * VEREDICTO PÚBLICO de la bicicleta que el usuario consintió compartir — el mismo
 * del Verificador Público (Hito 7) — y NADA de datos personales.
 *
 * Seguridad / SLA:
 *   - Requiere Bearer token válido + scope `verificacion:read`.
 *   - El token está acotado a UNA bici consentida: el tercero no puede pivotar a
 *     otra. (Acá no hay serial en la ruta: el token determina el recurso.)
 *   - Rate limiting por app (fixed-window atómico) para sostener el SLA < 2 s con
 *     alta concurrencia de terceros.
 *   - Cada llamada queda en la bitácora de uso del desarrollador (IP solo como hash).
 */
export async function GET(req: Request) {
  const inicio = Date.now()
  const ipHash = hashIpDev(obtenerIp(req))
  let appId: string | null = null
  let status = 200
  let scopeUsado: string | null = null

  try {
    const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? ''
    const ctx = await validarAccessToken(token)
    if (!ctx) {
      status = 401
      return bearerError(401, 'invalid_token', 'El access token es inválido o expiró.')
    }
    appId = ctx.appId

    if (!ctx.scopes.includes('verificacion:read')) {
      status = 403
      return bearerError(
        403,
        'insufficient_scope',
        'El token no tiene el scope verificacion:read.'
      )
    }
    scopeUsado = 'verificacion:read'

    // Rate limiting por app.
    const rate = await chequearRateLimitApp(ctx.appId, ctx.rateLimitRpm)
    if (!rate.permitido) {
      status = 429
      return NextResponse.json(
        { error: 'rate_limited', message: 'Límite de consultas alcanzado.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rate.retryAfter),
            'X-RateLimit-Limit': String(rate.limite),
            'X-RateLimit-Remaining': '0',
            'cache-control': 'no-store',
          },
        }
      )
    }

    // El token está acotado a una bici consentida: resolvemos su serie.
    if (!ctx.bicicletaId) {
      status = 409
      return bearerError(409, 'no_resource', 'El token no tiene una bici asociada.')
    }
    const bici = await getPool().query<{ numero_serie: string }>(
      `SELECT numero_serie FROM bicicletas WHERE id = $1`,
      [ctx.bicicletaId]
    )
    const serie = bici.rows[0]?.numero_serie
    if (!serie) {
      status = 404
      return bearerError(404, 'not_found', 'La bici asociada al token ya no existe.')
    }

    const veredicto = await buscarYVerificar(serie.toUpperCase())

    return NextResponse.json(
      {
        // Forma compacta y estable para integradores; solo estado público.
        serialNumber: veredicto.bicicleta?.numeroSerie ?? serie,
        status: veredicto.estado,
        color: veredicto.color,
        title: veredicto.titulo,
        message: veredicto.mensaje,
        cit: veredicto.codigoCit ?? null,
        bicycle: veredicto.bicicleta
          ? {
              brand: veredicto.bicicleta.marca,
              model: veredicto.bicicleta.modelo,
              type: veredicto.bicicleta.tipo,
              year: veredicto.bicicleta.anio,
              color: veredicto.bicicleta.color,
            }
          : null,
        blockchain: veredicto.bfa
          ? {
              matches: veredicto.bfa.coincide,
              status: veredicto.bfa.estado,
              txHash: veredicto.bfa.txHash,
            }
          : null,
      },
      {
        headers: {
          'X-RateLimit-Limit': String(rate.limite),
          'X-RateLimit-Remaining': String(rate.restantes),
          'cache-control': 'private, max-age=15',
        },
      }
    )
  } catch (error) {
    status = 500
    return jsonError(error)
  } finally {
    if (appId) {
      registrarUso({
        appId,
        endpoint: '/api/v1/connect/verificacion',
        metodo: 'GET',
        status,
        scopeUsado,
        latenciaMs: Date.now() - inicio,
        ipHash,
      }).catch(() => undefined)
    }
  }
}

function bearerError(status: number, code: string, descripcion: string) {
  return NextResponse.json(
    { error: code, message: descripcion },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'WWW-Authenticate': `Bearer error="${code}", error_description="${descripcion}"`,
      },
    }
  )
}

function obtenerIp(req: Request): string | null {
  const nf = req.headers.get('x-nf-client-connection-ip')
  if (nf && nf.trim()) return nf.trim()
  const xff = req.headers.get('x-forwarded-for')
  if (xff && xff.trim()) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')?.trim() || null
}
