import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, jsonError, optionalText } from '@/lib/marketplace'
import { requireAdminPanel, resolverImpugnacionDenunciaHumano } from '@/lib/admin-panel'

export const runtime = 'nodejs'

const bodySchema = z.object({
  decision: z.enum(['confirmar_falsa', 'desestimar']),
  nota: z.string().max(2000).optional(),
})

/**
 * POST /api/v1/admin/panel/impugnaciones-denuncia/:id/resolver — resuelve
 * una impugnación EN_REVISION_HUMANA. Solo `moderacion:accion`
 * (superadmin/soporte). 'confirmar_falsa' NO levanta ningún bloqueo real --
 * ver la nota en impugnaciones-denuncia.service.ts.
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
    const resultado = await resolverImpugnacionDenunciaHumano(
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
