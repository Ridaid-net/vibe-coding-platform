import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText } from '@/lib/marketplace'
import { accionPublicacion, requireAdminPanel, type AccionPublicacion } from '@/lib/admin-panel'

export const runtime = 'nodejs'

const ACCIONES: AccionPublicacion[] = ['despublicar', 'reactivar', 'suspender-cuenta', 'reactivar-cuenta']

interface Body {
  accion?: unknown
  motivo?: unknown
}

/**
 * POST /api/v1/admin/panel/moderacion/publicaciones/:id — control sobre el
 * Marketplace: despublicar/reactivar una publicacion que infringe los terminos,
 * o suspender/reactivar la cuenta del vendedor. Auditado con la identidad del admin.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAdminPanel(req, 'moderacion:accion')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Body
    const accion = optionalText(body.accion) as AccionPublicacion | null
    if (!accion || !ACCIONES.includes(accion)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `accion debe ser una de: ${ACCIONES.join(', ')}.`)
    }
    return NextResponse.json(await accionPublicacion(ctx, id, accion, { motivo: optionalText(body.motivo) }))
  } catch (error) {
    return jsonError(error)
  }
}
