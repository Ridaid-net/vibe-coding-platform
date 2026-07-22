import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireRole } from '@/lib/marketplace'
import { resolverAliadoDeUsuario } from '@/src/services/inspeccion.service'
import { cerrarPrestamo } from '@/src/services/prestamos-bici.service'

export const runtime = 'nodejs'

interface Body {
  bicicletaId?: unknown
}

/**
 * POST /api/v1/taller/prestamos/cerrar — registra la devolución y deja la
 * bici lista para el próximo préstamo (sin historial, ver el servicio).
 */
export async function POST(req: Request) {
  try {
    const [user, body] = await Promise.all([
      requireRole('aliado', 'admin')(req),
      req.json().catch(() => ({})) as Promise<Body>,
    ])

    const bicicletaId = typeof body.bicicletaId === 'string' ? body.bicicletaId : ''
    if (!bicicletaId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'bicicletaId es obligatorio.')
    }

    const aliado = await resolverAliadoDeUsuario(user.id)
    if (!aliado) {
      throw new ApiError(403, 'SIN_ALIADO', 'No tenes un Taller Aliado propio vinculado.')
    }

    const prestamo = await cerrarPrestamo(aliado.id, bicicletaId)
    return NextResponse.json({ prestamo })
  } catch (error) {
    return jsonError(error)
  }
}
