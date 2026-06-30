import { jsonError } from '@/lib/marketplace'
import { obtenerIp } from '@/lib/ministerio-http'
import { accederDocumentoSeguro } from '@/src/services/denuncia-mpf.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/seguridad/denuncias/[id]/documento?token=... — Link SEGURO al PDF de
 * la denuncia del MPF (Hito 18 / Hito 12).
 *
 * El webhook al Ministerio de Seguridad entrega esta URL (firmada y de vida
 * acotada) para que la autoridad acceda en tiempo real al PDF alojado en nuestro
 * bucket CIFRADO. El acceso:
 *   - exige el token firmado del enlace (sin token -> 403),
 *   - descifra el PDF del bucket y verifica su integridad (hash) antes de
 *     servirlo,
 *   - queda asentado en la auditoria inmutable (trazabilidad de quien accedio).
 *
 * El PDF se sirve inline; nunca viaja en claro fuera de esta respuesta.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const token = new URL(req.url).searchParams.get('token') ?? ''

    const { pdf, pdfHash, expediente } = await accederDocumentoSeguro(id, token, {
      ip: obtenerIp(req),
      cliente: req.headers.get('user-agent'),
    })

    const nombre = `denuncia-mpf-${expediente ?? id}.pdf`.replace(/[^a-zA-Z0-9.\-]/g, '_')
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${nombre}"`,
        'content-length': String(pdf.byteLength),
        // Huella de integridad para que la autoridad pueda verificarla.
        'x-rodaid-documento-sha256': pdfHash,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}
