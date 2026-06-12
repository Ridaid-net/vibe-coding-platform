import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAdmin } from '@/lib/marketplace'
import { certificarInspector } from '@/src/services/roles.service'

export const runtime = 'nodejs'

interface CertificarBody {
  certificacion?: unknown
}

/**
 * POST /api/v1/admin/inspectores/:id/certificar — certifica un inspector para que
 * pueda emitir CITs. Requiere x-admin-token.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = requireAdmin(req)
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as CertificarBody

    if (typeof body.certificacion !== 'string' || body.certificacion.trim().length < 3) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'certificacion es obligatoria (mínimo 3 caracteres).')
    }

    await certificarInspector(id, admin.id, body.certificacion.trim())
    return NextResponse.json({
      ok: true,
      data: { inspectorId: id, certificado: true, mensaje: 'Inspector certificado. Ya puede emitir CITs.' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
