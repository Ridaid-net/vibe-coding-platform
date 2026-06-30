import { leerFotoBicicleta } from '@/src/services/storage.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/marketplace/fotos/:key
 *
 * Sirve publicamente una foto de bicicleta almacenada en Netlify Blobs. La clave
 * es de varios segmentos (`bicicletas/<id>/<uuid>.<ext>`), por eso la ruta usa un
 * catch-all `[...key]`. Es la URL que `subirFotoBicicleta` devuelve y que se guarda
 * en `bicicletas.foto_url`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key } = await params
  const fullKey = key.join('/')

  const foto = await leerFotoBicicleta(fullKey)
  if (!foto) {
    return new Response('Foto no encontrada.', { status: 404 })
  }

  return new Response(foto.data, {
    headers: {
      'content-type': foto.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
