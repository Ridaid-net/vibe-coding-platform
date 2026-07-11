import { leerImagenNoticia } from '@/src/services/storage.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/noticias/imagenes/:key
 *
 * Sirve publicamente una imagen de portada de noticia almacenada en Netlify
 * Blobs. Es la URL que `subirImagenNoticia` devuelve y que se guarda en
 * `noticias_rodaid.imagen_url`. Publica (sin auth), igual que el GET de
 * /api/v1/admin/noticias — el widget y /prensa la consumen sin sesion.
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
