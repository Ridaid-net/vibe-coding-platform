import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { generarQrPng } from '@/lib/qr'

export const runtime = 'nodejs'

/**
 * GET /api/v1/historial/:token/qr — PNG del QR del Historial Clinico
 * publico. Sin auth (el token ya es el permiso) y sin rate limit propio: es
 * una imagen estatica una vez que el token existe -- si el token no existe,
 * el QR igual apuntaria a un link que /api/v1/historial/:token responde 404,
 * asi que no hay nada sensible que proteger acá.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const url = `${baseUrl(req)}/historial/${token}`
    const png = await generarQrPng(url)
    return new NextResponse(new Uint8Array(png), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=86400, immutable',
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}

function baseUrl(req: Request): string {
  const configured = process.env.RODAID_BASE_URL?.replace(/\/+$/, '')
  if (configured) return configured
  try {
    return new URL(req.url).origin
  } catch {
    return 'https://rodaid.net'
  }
}
