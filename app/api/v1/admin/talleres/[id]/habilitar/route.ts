import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { toggleTaller } from '@/src/services/roles.service'

export const runtime = 'nodejs'

/**
 * PATCH /api/v1/admin/talleres/:id/habilitar — alterna la habilitación de un
 * taller aliado. Requiere x-admin-token.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAdmin(req)
    const { id } = await params
    const result = await toggleTaller(id)
    return NextResponse.json({
      ok: true,
      data: { ...result, mensaje: result.habilitado ? 'Taller habilitado.' : 'Taller deshabilitado.' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
