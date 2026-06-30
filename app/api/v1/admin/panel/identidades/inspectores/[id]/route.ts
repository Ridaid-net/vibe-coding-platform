import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText } from '@/lib/marketplace'
import { accionInspector, requireAdminPanel, type AccionInspector } from '@/lib/admin-panel'

export const runtime = 'nodejs'

const ACCIONES: AccionInspector[] = ['licencia', 'asignar-taller', 'quitar-taller']

interface Body {
  accion?: unknown
  licenciaNumero?: unknown
  licenciaEstado?: unknown
  venceEn?: unknown
  aliadoId?: unknown
}

/**
 * POST /api/v1/admin/panel/identidades/inspectores/:id — gestiona la licencia del
 * inspector (numero/estado/vencimiento) o asigna/quita un taller autorizado.
 * Auditado con la identidad del admin.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAdminPanel(req, 'identidades:accion')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Body
    const accion = optionalText(body.accion) as AccionInspector | null
    if (!accion || !ACCIONES.includes(accion)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `accion debe ser una de: ${ACCIONES.join(', ')}.`)
    }
    return NextResponse.json(
      await accionInspector(ctx, id, accion, {
        licenciaNumero: optionalText(body.licenciaNumero),
        licenciaEstado: optionalText(body.licenciaEstado),
        venceEn: optionalText(body.venceEn),
        aliadoId: optionalText(body.aliadoId),
      })
    )
  } catch (error) {
    return jsonError(error)
  }
}
