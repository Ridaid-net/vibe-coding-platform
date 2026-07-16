import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireStaff } from '@/lib/marketplace'
import { confirmarPagoLiquidacion } from '@/src/services/compensaciones.service'

export const runtime = 'nodejs'

interface Body {
  resultado?: unknown
  referencia?: unknown
  motivo?: unknown
}

/**
 * POST /api/v1/admin/pagos/liquidaciones/[id]/confirmar — el empleado de
 * cuentas confirma a mano el resultado de una liquidación LISTA_PARA_PAGO,
 * después de haber ejecutado (o intentado ejecutar) la transferencia real por
 * fuera del sistema. Body: { resultado: 'PAGADA'|'FALLIDA', referencia?, motivo? }.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const staff = await requireStaff(req, 'admin')
    const body = (await req.json().catch(() => ({}))) as Body

    const resultado = optionalText(body.resultado)?.toUpperCase()
    if (resultado !== 'PAGADA' && resultado !== 'FALLIDA') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'resultado debe ser PAGADA o FALLIDA.')
    }

    const out = await confirmarPagoLiquidacion({
      liquidacionId: id,
      resultado,
      referencia: optionalText(body.referencia),
      motivo: optionalText(body.motivo),
      actorId: staff.id !== 'admin' ? staff.id : null,
    })

    return NextResponse.json(out)
  } catch (error) {
    return jsonError(error)
  }
}
