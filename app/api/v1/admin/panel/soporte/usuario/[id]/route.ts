import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText } from '@/lib/marketplace'
import { requireAdminPanel, revelarDatosUsuario } from '@/lib/admin-panel'

export const runtime = 'nodejs'

interface Body {
  motivo?: unknown
}

/**
 * POST /api/v1/admin/panel/soporte/usuario/:id — revela los datos personales de
 * un usuario para un PROCESO DE SOPORTE OFICIAL. Exige un motivo explicito y
 * queda asentado en la bitacora inmutable. Es la unica via por la que un
 * administrador ve DNI/email en claro.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAdminPanel(req, 'datos-personales:ver')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Body
    const motivo = optionalText(body.motivo)
    if (!motivo) {
      throw new ApiError(400, 'MOTIVO_REQUERIDO', 'Indica el motivo de soporte oficial.')
    }
    return NextResponse.json(await revelarDatosUsuario(ctx, id, motivo))
  } catch (error) {
    return jsonError(error)
  }
}
