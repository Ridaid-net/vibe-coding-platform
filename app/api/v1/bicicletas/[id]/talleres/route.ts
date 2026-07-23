import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import {
  listarTalleresDeBicicleta,
  otorgarAccesoTaller,
  validarOwnershipBicicleta,
} from '@/src/services/aliados.service'

export const runtime = 'nodejs'

interface Body {
  aliadoId?: unknown
  esPrincipal?: unknown
}

/**
 * /api/v1/bicicletas/[id]/talleres — Acceso multi-taller por bici (Garaje
 * Digital). El dueño administra que Talleres Aliados tienen acceso al panel
 * de servicios de su bici, y cual es el "principal" (el que
 * resolverAliadoPorBicicleta() usa para CIT Completo).
 *
 * GET  -> lista los talleres con acceso vigente.
 * POST -> otorga acceso a un taller nuevo (o re-otorga uno revocado); el
 *         dueño decide en el mismo request si reemplaza al principal actual
 *         (esPrincipal=true) o lo suma como acceso secundario (false).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    await validarOwnershipBicicleta(user.id, id)
    const talleres = await listarTalleresDeBicicleta(id)
    return NextResponse.json({ talleres })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const [user, body] = await Promise.all([
      requireUser(req),
      req.json().catch(() => ({})) as Promise<Body>,
    ])

    const aliadoId = typeof body.aliadoId === 'string' ? body.aliadoId : ''
    if (!aliadoId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'aliadoId es obligatorio.')
    }
    const esPrincipal = body.esPrincipal === true

    const taller = await otorgarAccesoTaller({
      propietarioId: user.id,
      bicicletaId: id,
      aliadoId,
      esPrincipal,
    })
    return NextResponse.json({ taller }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
