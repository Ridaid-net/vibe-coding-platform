import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireStaff } from '@/lib/marketplace'
import { resolverPagoForzado, type AccionForzada } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

interface Body {
  accion?: unknown
  motivo?: unknown
}

/**
 * POST /api/pagos/disputa/:id — resolucion FORZADA de una disputa (Hito 13).
 *
 * Solo para el rol admin (o el token de sistema). Permite forzar manualmente la
 * liberacion (`accion: "LIBERAR"`) de los fondos al vendedor o el reembolso
 * (`accion: "REEMBOLSAR"`) al comprador cuando el sistema detecta un
 * comportamiento irregular, sin exigir que la transaccion ya este en disputa.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await requireStaff(req, 'admin')
    const body = (await req.json().catch(() => ({}))) as Body

    const accionRaw = optionalText(body.accion)?.toUpperCase()
    if (accionRaw !== 'LIBERAR' && accionRaw !== 'REEMBOLSAR') {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'accion debe ser LIBERAR o REEMBOLSAR.'
      )
    }

    const resultado = await resolverPagoForzado({
      transaccionId: id,
      adminId: admin.id,
      accion: accionRaw as AccionForzada,
      motivo: optionalText(body.motivo),
    })

    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
