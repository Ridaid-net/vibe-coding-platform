import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { agregarEvidenciaImpugnacion, type EvidenciaArchivo } from '@/src/services/impugnaciones-denuncia.service'

export const runtime = 'nodejs'

/** POST /api/v1/impugnaciones-denuncia/:id/evidencia — quien impugnó sube más evidencia mientras el caso sigue abierto. */
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

    await agregarEvidenciaImpugnacion({ impugnacionId: id, usuarioId: user.id, evidencia })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
