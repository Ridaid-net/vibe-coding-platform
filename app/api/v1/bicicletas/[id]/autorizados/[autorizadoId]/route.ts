import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { editarAutorizado, eliminarAutorizado } from '@/src/services/autorizados.service'

export const runtime = 'nodejs'

interface Body {
  nombreCompleto?: unknown
  dni?: unknown
  direccion?: unknown
  telefono?: unknown
}

/**
 * /api/v1/bicicletas/[id]/autorizados/[autorizadoId] — editar/quitar una
 * persona con "Uso autorizado". Ownership validado dentro del servicio.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; autorizadoId: string }> }
) {
  try {
    const { id, autorizadoId } = await params
    const [user, body] = await Promise.all([
      requireUser(req),
      req.json().catch(() => ({})) as Promise<Body>,
    ])

    const nombreCompleto = typeof body.nombreCompleto === 'string' ? body.nombreCompleto.trim() : ''
    const dni = typeof body.dni === 'string' ? body.dni.trim() : ''
    const direccion = typeof body.direccion === 'string' ? body.direccion.trim() : ''
    const telefono = typeof body.telefono === 'string' ? body.telefono.trim() : ''

    if (!nombreCompleto || !dni || !direccion) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'nombreCompleto, dni y direccion son obligatorios.')
    }
    if (!/^\d{7,8}$/.test(dni)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'El DNI debe tener 7 u 8 dígitos, sin puntos.')
    }

    const autorizado = await editarAutorizado(user.id, id, autorizadoId, {
      nombreCompleto,
      dni,
      direccion,
      telefono: telefono || undefined,
    })
    return NextResponse.json({ autorizado })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; autorizadoId: string }> }
) {
  try {
    const { id, autorizadoId } = await params
    const user = await requireUser(req)
    await eliminarAutorizado(user.id, id, autorizadoId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
