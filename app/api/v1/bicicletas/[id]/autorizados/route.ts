import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import {
  agregarAutorizado,
  listarAutorizadosCompleto,
  validarOwnershipAutorizados,
} from '@/src/services/autorizados.service'

export const runtime = 'nodejs'

interface Body {
  nombreCompleto?: unknown
  dni?: unknown
  direccion?: unknown
  telefono?: unknown
}

/**
 * /api/v1/bicicletas/[id]/autorizados — "Uso autorizado" (Garaje Digital).
 * Hasta 2 personas por bici. DNI/direccion viajan cifrados en reposo.
 *
 * GET  -> lista completa y descifrada (solo el dueño de la bici).
 * POST -> agrega una persona (409 si ya hay 2).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    await validarOwnershipAutorizados(user.id, id)
    const autorizados = await listarAutorizadosCompleto(id)
    return NextResponse.json({ autorizados })
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

    const autorizado = await agregarAutorizado(user.id, id, {
      nombreCompleto,
      dni,
      direccion,
      telefono: telefono || undefined,
    })
    return NextResponse.json({ autorizado }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
