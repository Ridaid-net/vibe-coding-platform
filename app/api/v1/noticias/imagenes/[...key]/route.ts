import { leerImagenNoticia } from '@/src/services/storage.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/noticias/imagenes/:key
 *
 * Sirve publicamente una imagen de portada de noticia almacenada en Netlify
 * Blobs. NO vive bajo /api/v1/admin/* a proposito — ver la nota en
 * app/api/v1/noticias/route.ts sobre por que esa ruta exige staff para
 * cualquier sub-path.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key } = await params
  const fullKey = key.join('/')

  const imagen = await leerImagenNoticia(fullKey)
  if (!imagen) {
    return new Response('Imagen no encontrada.', { status: 404 })
  }

  return new Response(imagen.data, {
    headers: {
      'content-type': imagen.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
