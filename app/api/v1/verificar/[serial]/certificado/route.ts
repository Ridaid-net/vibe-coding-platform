import { NextResponse } from 'next/server'
import { ApiError, getPool, jsonError } from '@/lib/marketplace'
import {
  chequearRateLimit,
  hashIp,
  normalizarTermino,
} from '@/src/services/verificacion.service'
import { obtenerCertificado, type CertificadoDatos } from '@/src/services/pdf.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/verificar/:serial/certificado — Certificado Publico de
 * Verificacion (PDF firmado), version SIN datos personales del Verificador
 * Publico.
 *
 * Endpoint ABIERTO (sin requireAuth), mismo espiritu que
 * /api/v1/verificar/:serial: cualquiera que escanee el QR del sticker o
 * busque un numero de serie puede bajar un certificado oficial y firmado
 * (PKCS#7, misma Autoridad Certificadora RODAID que el certificado privado)
 * SIN exponer al titular ni al inspector individual -- el caso de uso real es
 * alguien verificando una bici de segunda mano antes de comprarla, sin
 * necesitar cuenta ni exponer a nadie.
 *
 * Reusa el mismo rate limiting por IP que el resto del Verificador Publico
 * (verificacion.service.ts) para compartir el presupuesto anti-enumeracion.
 *
 * Solo emite certificado para un CIT realmente 'activo' y vigente -- una bici
 * bloqueada, pendiente, rechazada o vencida devuelve 409 (ese estado ya se ve
 * en pantalla en /verificar, sin necesidad de un PDF).
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
          message: 'Ingresa un numero de serie valido (entre 3 y 120 caracteres).',
        },
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

    const pool = getPool()
    const res = await pool.query<FilaCertPublico>(
      `
        SELECT
          c.id AS cit_id, c.estado, c.codigo_cit, c.hash_sha256,
          c.fecha_vencimiento, c.bfa_estado, c.bfa_tx_hash, c.bfa_token_id, c.bfa_modo,
          c.metadata_json,
          b.marca, b.modelo, b.tipo, b.numero_serie, b.anio, b.color, b.rodado, b.talle_cuadro, b.foto_url
        FROM bicicletas b
        LEFT JOIN LATERAL (
          SELECT *
          FROM cits c
          WHERE c.bicicleta_id = b.id
          ORDER BY
            CASE c.estado WHEN 'activo' THEN 0 ELSE 1 END,
            c.acunado_en DESC
          LIMIT 1
        ) c ON TRUE
        WHERE UPPER(b.numero_serie) = $1
        LIMIT 1
      `,
      [termino]
    )

    const fila = res.rows[0]
    if (!fila) {
      throw new ApiError(
        404,
        'NO_ENCONTRADA',
        'No encontramos una bicicleta con ese numero de serie.'
      )
    }

    const vencida =
      fila.fecha_vencimiento !== null &&
      new Date(fila.fecha_vencimiento).getTime() <= Date.now()
    if (!fila.cit_id || fila.estado !== 'activo' || vencida) {
      throw new ApiError(
        409,
        'CIT_NO_VERIFICADO',
        'Esta bicicleta no tiene un CIT activo y vigente. No hay certificado publico disponible.'
      )
    }

    const datos: CertificadoDatos = {
      citId: fila.cit_id,
      codigoCit: fila.codigo_cit ?? '',
      estado: fila.estado,
      hashSha256: fila.hash_sha256,
      fechaVencimiento: fila.fecha_vencimiento,
      bici: {
        marca: fila.marca,
        modelo: fila.modelo,
        tipo: fila.tipo,
        numeroSerie: fila.numero_serie,
        anio: fila.anio,
        color: fila.color,
        rodado: fila.rodado === null ? null : Number(fila.rodado),
        talleCuadro: fila.talle_cuadro,
        fotoUrl: absolutizarUrl(req, fila.foto_url),
      },
      bfa: {
        estado: fila.bfa_estado ?? 'pendiente',
        modo: fila.bfa_modo,
        txHash: fila.bfa_tx_hash,
        tokenId: fila.bfa_token_id,
        ancladoEn: null,
      },
      titular: null,
      verifierUrl: verifierUrl(req, fila.numero_serie),
      inspeccion: inspeccionNota(fila.metadata_json),
      publico: true,
    }

    const certificado = await obtenerCertificado(datos)

    return new NextResponse(Buffer.from(certificado.pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${certificado.numero}.pdf"`,
        'content-length': String(certificado.pdf.byteLength),
        'cache-control': 'public, max-age=60',
        'x-rodaid-cert-numero': certificado.numero,
        'x-rodaid-firma-modo': certificado.modoFirma,
        'X-RateLimit-Limit': String(rate.limite),
        'X-RateLimit-Remaining': String(rate.restantes),
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}

interface FilaCertPublico {
  cit_id: string | null
  estado: string | null
  codigo_cit: string | null
  hash_sha256: string | null
  fecha_vencimiento: string | null
  bfa_estado: string | null
  bfa_tx_hash: string | null
  bfa_token_id: string | null
  bfa_modo: string | null
  metadata_json: Record<string, unknown> | null
  marca: string
  modelo: string
  tipo: string
  numero_serie: string
  anio: number | null
  color: string | null
  rodado: string | null
  talle_cuadro: string | null
  foto_url: string | null
}

/**
 * Nota tecnica de la inspeccion fisica para el certificado publico -- mismo
 * criterio que pdf.service.ts::inspeccionNota() (certificado privado). El
 * nombre del inspector individual viaja igual en este objeto; es
 * pdf.service.ts (via el flag `publico`) el que decide omitirlo al renderizar.
 */
function inspeccionNota(
  metadata: Record<string, unknown> | null
): CertificadoDatos['inspeccion'] {
  const meta = metadata ?? {}
  const insp = (meta as Record<string, unknown>).inspeccionFisica
  if (!insp || typeof insp !== 'object') return null
  const i = insp as Record<string, unknown>
  if (i.resultado !== 'APROBADA') return null
  const inspector =
    typeof i.inspectorNombre === 'string' && i.inspectorNombre.trim()
      ? i.inspectorNombre.trim()
      : 'Inspector verificado'
  const taller =
    typeof i.aliadoNombre === 'string' && i.aliadoNombre.trim()
      ? i.aliadoNombre.trim()
      : null
  return {
    taller,
    inspector,
    firmaHash: typeof i.firmaHash === 'string' ? i.firmaHash : '',
    aprobadaEn: typeof i.aprobadaEn === 'string' ? i.aprobadaEn : null,
  }
}

/**
 * URL absoluta del Verificador Publico para el QR. Usa `RODAID_BASE_URL` si
 * esta definida; si no, deriva el origen del propio request.
 */
function verifierUrl(req: Request, numeroSerie: string): string {
  const configured = process.env.RODAID_BASE_URL?.replace(/\/+$/, '')
  let base = configured
  if (!base) {
    try {
      base = new URL(req.url).origin
    } catch {
      base = ''
    }
  }
  return `${base}/verificar/${encodeURIComponent(numeroSerie)}`
}

/**
 * Ver la nota gemela en app/api/v1/cit/[id]/certificado/route.ts:
 * `bicicletas.foto_url` es una ruta relativa, no una URL absoluta -- hace
 * falta resolverla antes de que `generarCertificado()` intente descargarla.
 */
function absolutizarUrl(req: Request, url: string | null): string | null {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  const configured = process.env.RODAID_BASE_URL?.replace(/\/+$/, '')
  let base = configured
  if (!base) {
    try {
      base = new URL(req.url).origin
    } catch {
      return null
    }
  }
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`
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
