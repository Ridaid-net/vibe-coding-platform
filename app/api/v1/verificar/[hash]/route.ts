import { NextResponse } from 'next/server'
import { verificarCIT } from '@/lib/verificar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/verificar/:hash
 *
 * Verificacion publica de un Certificado de Identidad Tecnologica a partir de
 * su serialHash (el hash SHA-256 del sello). Es el endpoint al que apunta el
 * codigo QR impreso en cada certificado PDF. No requiere sesion.
 *
 * Contrato de respuesta:
 *   encontrado    → 200 { data: VerificacionCIT }
 *   no encontrado → 404 { error: { code: 'CIT_NO_ENCONTRADO', message } }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ hash: string }> }
) {
  try {
    const { hash } = await params
    const verificacion = await verificarCIT(hash)

    if (!verificacion) {
      return NextResponse.json(
        {
          error: {
            code: 'CIT_NO_ENCONTRADO',
            message: 'No existe ningun certificado con ese codigo de verificacion.',
          },
        },
        { status: 404, headers: { 'Cache-Control': 'public, s-maxage=30' } }
      )
    }

    return NextResponse.json(
      { data: verificacion },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
    )
  } catch (error) {
    console.error('Verificacion CIT error', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'No se pudo verificar el certificado.',
        },
      },
      { status: 500 }
    )
  }
}
