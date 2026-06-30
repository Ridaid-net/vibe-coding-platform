import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireStaff } from '@/lib/marketplace'
import { resolverAliado } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

interface Body {
  accion?: unknown
  motivo?: unknown
}

/**
 * POST /api/v1/admin/aliados/[id]/aprobar — Aprueba o rechaza una solicitud.
 *
 * Restringido a staff (rol admin via JWT o token de sistema). Al aprobar, si el
 * aliado tiene una cuenta duena (ciclista), su rol pasa a 'aliado' para acceder
 * al panel de inspecciones. Body: { accion: 'aprobar' | 'rechazar', motivo? }.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const staff = await requireStaff(req, 'admin')
    const body = (await req.json().catch(() => ({}))) as Body

    const accion = optionalText(body.accion)?.toLowerCase()
    if (accion !== 'aprobar' && accion !== 'rechazar') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'accion debe ser aprobar o rechazar.')
    }

    const resultado = await resolverAliado({
      aliadoId: id,
      adminId: staff.id,
      accion,
      motivo: optionalText(body.motivo),
    })

    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
