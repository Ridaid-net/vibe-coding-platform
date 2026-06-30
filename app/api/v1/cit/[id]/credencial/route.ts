import { NextResponse } from 'next/server'
import { ApiError, getPool, jsonError, requireAuth } from '@/lib/marketplace'
import { emitirCredencial, type DatosCredencial } from '@/src/services/credenciales-vc.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/cit/[id]/credencial — Hito 16: Verifiable Credential (W3C) del CIT.
 *
 * Entrega el Certificado de Propiedad y Verificación (Hito 6) como una Credencial
 * Verificable del estándar W3C, lista para guardarse en una billetera digital
 * universal. Devuelve el documento VC (JSON-LD) y su codificación VC-JWT (firmada
 * con EdDSA; la clave pública se publica en /.well-known/jwks.json y /.well-known/did.json).
 *
 * - PROTEGIDO: solo el propietario de la bici (o staff) puede emitir SU credencial.
 * - `?format=jwt` devuelve solo el VC-JWT compacto (lo que importan las billeteras).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireAuth(req)

    const res = await getPool().query<FilaCit>(
      `
        SELECT
          c.id AS cit_id, c.estado, c.codigo_cit, c.hash_sha256,
          c.fecha_vencimiento, c.bfa_estado, c.bfa_tx_hash, c.bfa_token_id,
          c.bfa_anclado_en,
          b.marca, b.modelo, b.tipo, b.numero_serie, b.anio, b.color,
          b.propietario_id, u.datos_perfil AS titular_perfil, u.email AS titular_email
        FROM cits c
        JOIN bicicletas b ON b.id = c.bicicleta_id
        LEFT JOIN usuarios u ON u.id = b.propietario_id
        WHERE c.id = $1 OR c.bicicleta_id = $1
        ORDER BY
          CASE WHEN c.id = $1 THEN 0 ELSE 1 END,
          (c.estado = 'activo') DESC,
          c.creado_en DESC
        LIMIT 1
      `,
      [id]
    )
    const fila = res.rows[0]
    if (!fila) throw new ApiError(404, 'CIT_NOT_FOUND', 'No encontramos la cédula (CIT) solicitada.')

    const esStaff = user.rol === 'admin' || user.rol === 'inspector'
    if (fila.propietario_id !== user.id && !esStaff) {
      throw new ApiError(403, 'NOT_OWNER', 'Esta credencial pertenece a otra persona.')
    }

    const vencida =
      fila.fecha_vencimiento !== null &&
      new Date(fila.fecha_vencimiento).getTime() <= Date.now()
    if (fila.estado !== 'activo' || vencida) {
      throw new ApiError(
        409,
        'CIT_NO_VERIFICADO',
        vencida
          ? 'El CIT está vencido. Renová la verificación para emitir la credencial.'
          : 'El CIT todavía no está verificado. No se puede emitir la credencial.'
      )
    }

    const datos: DatosCredencial = {
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
      },
      bfa: {
        estado: fila.bfa_estado,
        txHash: fila.bfa_tx_hash,
        tokenId: fila.bfa_token_id,
        ancladoEn: fila.bfa_anclado_en,
      },
      titular: nombreTitular(fila),
      origin: origen(req),
    }

    const credencial = await emitirCredencial(datos)

    const url = new URL(req.url)
    if (url.searchParams.get('format') === 'jwt') {
      return new NextResponse(credencial.jwt, {
        headers: {
          'content-type': 'application/jwt',
          'cache-control': 'private, no-store',
        },
      })
    }

    return NextResponse.json(
      {
        issuer: credencial.issuer,
        expiresAt: credencial.expira,
        verifiableCredential: credencial.vc,
        jwt: credencial.jwt,
        // Pistas para integraciones de billeteras universales.
        wallet: {
          jwksUrl: `${datos.origin.replace(/\/+$/, '')}/.well-known/jwks.json`,
          didUrl: `${datos.origin.replace(/\/+$/, '')}/.well-known/did.json`,
          format: 'W3C Verifiable Credentials 1.1 (VC-JWT, EdDSA)',
        },
      },
      { headers: { 'cache-control': 'private, no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}

interface FilaCit {
  cit_id: string
  estado: string
  codigo_cit: string
  hash_sha256: string | null
  fecha_vencimiento: string | null
  bfa_estado: string | null
  bfa_tx_hash: string | null
  bfa_token_id: string | null
  bfa_anclado_en: string | null
  marca: string
  modelo: string
  tipo: string
  numero_serie: string
  anio: number | null
  color: string | null
  propietario_id: string
  titular_perfil: Record<string, unknown> | null
  titular_email: string | null
}

function nombreTitular(fila: FilaCit): string | null {
  const perfil = fila.titular_perfil ?? {}
  const nombre = typeof perfil.nombre === 'string' ? perfil.nombre.trim() : ''
  if (nombre) return nombre
  return fila.titular_email ?? null
}

function origen(req: Request): string {
  const configured = process.env.RODAID_BASE_URL?.replace(/\/+$/, '')
  if (configured) return configured
  try {
    return new URL(req.url).origin
  } catch {
    return ''
  }
}
