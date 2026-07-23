import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { requireAdminPanel } from '@/lib/admin-panel'
import {
  leerEvidencia,
  obtenerImpugnacionConEvidencia,
  resolverEvidenciaBlobKey,
} from '@/src/services/impugnaciones-denuncia.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/impugnaciones-denuncia/:id/evidencia/:evidenciaId — descarga
 * (descifrada) un archivo de evidencia puntual. Autorizado para quien inició
 * la impugnación, o un admin del panel con `moderacion:ver`.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; evidenciaId: string }> }
) {
  try {
    const { id, evidenciaId } = await params

    let autorizado = false
    try {
      const user = await requireUser(req)
      await obtenerImpugnacionConEvidencia(id, user.id)
      autorizado = true
    } catch {
      await requireAdminPanel(req, 'moderacion:ver')
      autorizado = true
    }
    if (!autorizado) {
      throw new ApiError(403, 'NOT_PARTICIPANT', 'No tenés acceso a esta evidencia.')
    }

    const blobKey = await resolverEvidenciaBlobKey(id, evidenciaId)
    if (!blobKey) {
      throw new ApiError(404, 'EVIDENCIA_NOT_FOUND', 'La evidencia no existe.')
    }
    const bytes = await leerEvidencia(blobKey)
    if (!bytes) {
      throw new ApiError(404, 'EVIDENCIA_NOT_FOUND', 'La evidencia no existe.')
    }

    return new NextResponse(new Uint8Array(bytes), {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
