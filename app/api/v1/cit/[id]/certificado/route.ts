import { NextResponse } from 'next/server'
import { ApiError, getPool, jsonError, requireAuth } from '@/lib/marketplace'
import {
  obtenerCertificado,
  type CertificadoDatos,
} from '@/src/services/pdf.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/cit/[id]/certificado — Descarga el Certificado Digital de
 * Propiedad y Verificacion (PDF firmado) de un CIT.
 *
 * - PROTEGIDO: requiere autenticacion (requireAuth). Solo el propietario de la
 *   bici (o un usuario staff admin/inspector) puede descargarlo.
 * - El `:id` es el id del CIT; por comodidad tambien se acepta el id de la
 *   bicicleta (se resuelve su CIT activo).
 * - El PDF se recupera de Netlify Blobs si ya existe; si no, se genera y firma
 *   bajo demanda, con el QR al Verificador Publico y el sello temporal.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireAuth(req)
    const pool = getPool()

    // Trae el CIT (por id de CIT o, en su defecto, por id de bicicleta) junto
    // con los datos de la bici, el titular y el anclaje en la BFA.
    const res = await pool.query<FilaCert>(
      `
        SELECT
          c.id AS cit_id, c.estado, c.codigo_cit, c.hash_sha256,
          c.fecha_vencimiento, c.bfa_estado, c.bfa_tx_hash, c.bfa_token_id, c.bfa_modo,
          NULL AS bfa_anclado_en, c.metadata_json,
          b.id AS bici_id, b.marca, b.modelo, b.tipo, b.numero_serie,
          b.anio, b.color, b.rodado, b.talle_cuadro, b.propietario_id, b.foto_url,
          u.datos_perfil AS titular_perfil, u.email AS titular_email
        FROM cits c
        JOIN bicicletas b ON b.id = c.bicicleta_id
        LEFT JOIN usuarios u ON u.id = b.propietario_id
        WHERE c.id = $1
           OR c.bicicleta_id = $1
        ORDER BY
          CASE WHEN c.id = $1 THEN 0 ELSE 1 END,
          (c.estado = 'activo') DESC,
          c.acunado_en DESC
        LIMIT 1
      `,
      [id]
    )

    const fila = res.rows[0]
    if (!fila) {
      throw new ApiError(404, 'CIT_NOT_FOUND', 'No encontramos la cedula (CIT) solicitada.')
    }

    // Autorizacion: dueno de la bici o staff (admin/inspector).
    const esStaff = user.rol === 'admin' || user.rol === 'inspector'
    if (fila.propietario_id !== user.id && !esStaff) {
      throw new ApiError(403, 'NOT_OWNER', 'Este certificado pertenece a otra persona.')
    }

    // El certificado de propiedad y verificacion solo tiene sentido con una
    // identidad verificada y vigente.
    const vencida =
      fila.fecha_vencimiento !== null &&
      new Date(fila.fecha_vencimiento).getTime() <= Date.now()
    if (fila.estado !== 'activo' || vencida) {
      throw new ApiError(
        409,
        'CIT_NO_VERIFICADO',
        vencida
          ? 'El CIT esta vencido. Renova la verificacion para emitir el certificado.'
          : 'El CIT todavia no esta verificado. No se puede emitir el certificado.'
      )
    }

    const datos: CertificadoDatos = {
      citId: fila.cit_id,
      codigoCit: fila.codigo_cit,
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
        fotoUrl: fila.foto_url,
      },
      bfa: {
        estado: fila.bfa_estado ?? 'pendiente',
        modo: fila.bfa_modo,
        txHash: fila.bfa_tx_hash,
        tokenId: fila.bfa_token_id,
        ancladoEn: fila.bfa_anclado_en,
      },
      titular: nombreTitular(fila),
      verifierUrl: verifierUrl(req, fila.numero_serie),
      inspeccion: inspeccionNota(fila),
    }

    const certificado = await obtenerCertificado(datos)

    return new NextResponse(Buffer.from(certificado.pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${certificado.numero}.pdf"`,
        'content-length': String(certificado.pdf.byteLength),
        'cache-control': 'private, no-store',
        'x-rodaid-cert-numero': certificado.numero,
        'x-rodaid-firma-modo': certificado.modoFirma,
        'x-rodaid-cert-cache': certificado.fromCache ? 'hit' : 'miss',
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}

interface FilaCert {
  cit_id: string
  estado: string
  codigo_cit: string
  hash_sha256: string | null
  fecha_vencimiento: string | null
  bfa_estado: string | null
  bfa_tx_hash: string | null
  bfa_token_id: string | null
  bfa_anclado_en: string | null
  bfa_modo: string | null
  metadata_json: Record<string, unknown> | null
  bici_id: string
  marca: string
  modelo: string
  tipo: string
  numero_serie: string
  anio: number | null
  color: string | null
  rodado: string | null
  talle_cuadro: string | null
  propietario_id: string
  foto_url: string | null
  titular_perfil: Record<string, unknown> | null
  titular_email: string | null
}

/**
 * Nota tecnica de la inspeccion fisica (Hito 11) para el certificado. Se lee de
 * `metadata_json.inspeccionFisica` y solo se incluye si fue una APROBADA.
 */
function inspeccionNota(fila: FilaCert): CertificadoDatos['inspeccion'] {
  const meta = fila.metadata_json ?? {}
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

/** Nombre legible del titular para el documento (privado del propietario). */
function nombreTitular(fila: FilaCert): string | null {
  const perfil = fila.titular_perfil ?? {}
  const nombre = typeof perfil.nombre === 'string' ? perfil.nombre.trim() : ''
  if (nombre) return nombre
  return fila.titular_email ?? null
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
