import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { responderComoDuenoActual } from '@/src/services/reclamos-titularidad.service'

export const runtime = 'nodejs'

const bodySchema = z.object({
  respuesta: z.enum(['niega', 'confirma']),
})

/**
 * POST /api/v1/reclamos-titularidad/:id/responder — el dueño actual
 * registrado responde a un reclamo de titularidad: 'niega' rechaza
 * automático (antecedente para el reclamante), 'confirma' ejecuta la
 * transferencia real de inmediato (sin revisión humana adicional).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ApiError(400, 'VALIDATION_ERROR', issue?.message ?? 'Datos inválidos.')
    }

    const resultado = await responderComoDuenoActual(id, user.id, parsed.data.respuesta)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
