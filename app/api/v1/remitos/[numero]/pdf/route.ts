import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAuth } from '@/lib/marketplace'
import { obtenerRemitoPdf, obtenerRemitoPorNumero } from '@/src/services/remito.service'
import { resolverAliadoDeUsuario } from '@/src/services/inspeccion.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/remitos/:numero/pdf — descarga el PDF firmado del remito.
 * PROTEGIDO: solo el vendedor de la venta, el Taller Aliado asignado, o
 * staff (admin/inspector). El PDF es inmutable una vez generado (se lee tal
 * cual de Netlify Blobs, nunca se regenera) -- mismo espiritu que el
 * Certificado de CIT, pero sin cache-por-fingerprint porque este documento
 * no cambia despues de emitido.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const { numero } = await params
    const user = await requireAuth(req)

    const remito = await obtenerRemitoPorNumero(numero)
    if (!remito) {
      throw new ApiError(404, 'REMITO_NOT_FOUND', 'El remito no existe.')
    }

    const esStaff = user.rol === 'admin' || user.rol === 'inspector'
    const esVendedor = remito.vendedorId === user.id
    let esAliado = false
    if (!esStaff && !esVendedor) {
      const aliado = await resolverAliadoDeUsuario(user.id)
      esAliado = aliado?.id === remito.aliadoId
    }
    if (!esStaff && !esVendedor && !esAliado) {
      throw new ApiError(403, 'NOT_OWNER', 'Este remito pertenece a otra operacion.')
    }

    const pdf = await obtenerRemitoPdf(numero)
    if (!pdf) {
      throw new ApiError(404, 'PDF_NOT_FOUND', 'No encontramos el PDF de este remito.')
    }

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${remito.numero}.pdf"`,
        'content-length': String(pdf.byteLength),
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}
