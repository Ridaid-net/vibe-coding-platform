import { leerLogoTaller } from '@/src/services/storage.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/talleres/logos/:key
 *
 * Sirve publicamente el logo de un Taller Aliado almacenado en Netlify Blobs.
 * Fuera de /api/v1/admin/* a proposito: esa ruta la intercepta
 * netlify/edge-functions/auth-admin.ts y exige un JWT de staff (admin/inspector)
 * para cualquier sub-path, lo que dejaria el logo inaccesible para cualquier
 * visitante del footer publico (confirmado en produccion con /api/v1/noticias).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key } = await params
  const logo = await leerLogoTaller(key.join('/'))
  if (!logo) {
    return new Response('Logo no encontrado.', { status: 404 })
  }
  return new Response(logo.data, {
    headers: {
      'content-type': logo.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
