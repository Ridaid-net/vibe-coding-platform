export interface NoticiaBody {
  titulo?: string
  resumen?: string
  url?: string
  fuente?: string
  tipo?: string
  orden?: number
  video_url?: string
  es_comunicado_prensa?: boolean
  activa?: boolean
}

/**
 * Lee el body de POST/PATCH de noticias, aceptando tanto `application/json`
 * (usado por toggleActiva, que solo manda `{ activa }`) como
 * `multipart/form-data` (usado por el formulario de edicion, que puede incluir
 * un archivo `imagen`).
 */
export async function parseNoticiaBody(
  req: Request
): Promise<{ data: NoticiaBody; imagen: File | null }> {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const imagenEntry = form.get('imagen')
    const imagen = imagenEntry instanceof File && imagenEntry.size > 0 ? imagenEntry : null
    const ordenRaw = form.get('orden')
    return {
      data: {
        titulo: (form.get('titulo') as string) || undefined,
        resumen: (form.get('resumen') as string) || undefined,
        url: (form.get('url') as string) || undefined,
        fuente: (form.get('fuente') as string) || undefined,
        tipo: (form.get('tipo') as string) || undefined,
        orden: ordenRaw ? Number(ordenRaw) : undefined,
        video_url: (form.get('video_url') as string) || undefined,
        es_comunicado_prensa: form.get('es_comunicado_prensa') === 'true',
      },
      imagen,
    }
  }
  const body = await req.json().catch(() => ({}))
  return { data: body as NoticiaBody, imagen: null }
}
