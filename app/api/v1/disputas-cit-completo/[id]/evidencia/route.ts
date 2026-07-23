import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { agregarEvidenciaDisputa, type EvidenciaArchivo } from '@/src/services/disputas-cit-completo.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/disputas-cit-completo/:id/evidencia — el comprador o el
 * vendedor de la disputa suben mas evidencia (contra-evidencia del vendedor,
 * en el caso mas comun) mientras el caso sigue ABIERTA o EN_REVISION_HUMANA.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)

    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser multipart/form-data.')
    }
    const form = await req.formData()
    const evidencia: EvidenciaArchivo[] = []
    for (const [key, value] of form.entries()) {
      if (key === 'evidencia' && value instanceof File && value.size > 0) {
        evidencia.push({
          bytes: Buffer.from(await value.arrayBuffer()),
          nombreArchivo: value.name,
          contentType: value.type || 'application/octet-stream',
        })
      }
    }

    await agregarEvidenciaDisputa({ disputaId: id, usuarioId: user.id, evidencia })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
