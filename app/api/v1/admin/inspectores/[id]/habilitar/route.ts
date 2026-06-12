import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { toggleInspector } from '@/src/services/roles.service'

export const runtime = 'nodejs'

/**
 * PATCH /api/v1/admin/inspectores/:id/habilitar — alterna el estado activo del
 * inspector (alta/baja). Requiere x-admin-token.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = requireAdmin(req)
    const { id } = await params
    const result = await toggleInspector(id, admin.id)
    return NextResponse.json({
      ok: true,
      data: { ...result, mensaje: result.activo ? 'Inspector habilitado.' : 'Inspector deshabilitado.' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
