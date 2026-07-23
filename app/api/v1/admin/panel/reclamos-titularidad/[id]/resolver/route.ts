import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, jsonError, optionalText } from '@/lib/marketplace'
import { requireAdminPanel, resolverReclamoTitularidadHumano } from '@/lib/admin-panel'

export const runtime = 'nodejs'

const bodySchema = z.object({
  decision: z.enum(['aprobar', 'desestimar']),
  nota: z.string().max(2000).optional(),
})

/**
 * POST /api/v1/admin/panel/reclamos-titularidad/:id/resolver — resuelve un
 * reclamo EN_REVISION_HUMANA. Solo `moderacion:accion` (superadmin/soporte).
 * Aprobar ejecuta la transferencia real de titularidad de inmediato.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdminPanel(req, 'moderacion:accion')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ApiError(400, 'VALIDATION_ERROR', issue?.message ?? 'Datos inválidos.')
    }
    const resultado = await resolverReclamoTitularidadHumano(
      ctx,
      id,
      parsed.data.decision,
      optionalText(parsed.data.nota) ?? null
    )
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
