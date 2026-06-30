import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { validarCIT } from '@/src/services/cit.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/cit/:id/validar — RODAID valida el intake dentro de la ventana de
 * 72 hs y emite el certificado (PENDIENTE_VALIDACION -> ACTIVO). Endpoint de
 * sistema (requiere credenciales de administrador).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    requireAdmin(req)
    const cit = await validarCIT({ citId: id, validadorId: null })
    return NextResponse.json({ cit })
  } catch (error) {
    return jsonError(error)
  }
}
