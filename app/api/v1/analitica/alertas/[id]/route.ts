import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireStaff } from '@/lib/marketplace'
import {
  actualizarEstadoAlerta,
  type AlertaEstado,
} from '@/src/services/analytics.service'

export const runtime = 'nodejs'

/**
 * PATCH /api/v1/analitica/alertas/[id] — Cambia el estado de una alerta de
 * seguridad (reconocida / descartada) desde el dashboard del equipo.
 *
 * Body: { estado: 'reconocida' | 'descartada' | 'abierta' }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireStaff(req, 'admin', 'inspector')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { estado?: string }
    const estado = body.estado as AlertaEstado | undefined
    if (!estado || !['abierta', 'reconocida', 'descartada'].includes(estado)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Estado invalido. Use abierta, reconocida o descartada.'
      )
    }
    const alerta = await actualizarEstadoAlerta(id, estado)
    if (!alerta) {
      throw new ApiError(404, 'ALERTA_NOT_FOUND', 'La alerta indicada no existe.')
    }
    return NextResponse.json({ alerta })
  } catch (error) {
    return jsonError(error)
  }
}
