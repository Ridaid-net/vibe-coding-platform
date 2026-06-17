import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText } from '@/lib/marketplace'
import { accionDenuncia, requireAdminPanel, type AccionDenuncia } from '@/lib/admin-panel'

export const runtime = 'nodejs'

const ACCIONES: AccionDenuncia[] = ['aprobar', 'rechazar', 'desbloquear']

interface Body {
  accion?: unknown
  motivo?: unknown
}

/**
 * POST /api/v1/admin/panel/moderacion/denuncias/:id — resuelve una denuncia en
 * revision: aprobar (bloquea CIT + Marketplace), rechazar (anula) o desbloquear
 * (reactiva el CIT). Queda en la bitacora inmutable con la identidad del admin.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAdminPanel(req, 'moderacion:accion')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Body
    const accion = optionalText(body.accion) as AccionDenuncia | null
    if (!accion || !ACCIONES.includes(accion)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `accion debe ser una de: ${ACCIONES.join(', ')}.`)
    }
    return NextResponse.json(await accionDenuncia(ctx, id, accion, { motivo: optionalText(body.motivo) }))
  } catch (error) {
    return jsonError(error)
  }
}
