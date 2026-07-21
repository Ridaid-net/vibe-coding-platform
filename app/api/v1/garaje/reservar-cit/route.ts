import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { crearSolicitudReserva } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

interface Body {
  bicicletaId?: unknown
  aliadoId?: unknown
  nota?: unknown
}

/**
 * POST /api/v1/garaje/reservar-cit — Reserva simple: el ciclista elige un
 * Taller Aliado para certificar su bici. Sin horario, sin pago -- el taller
 * la ve en su panel y contacta por fuera del sistema.
 */
export async function POST(req: Request) {
  try {
    const [user, body] = await Promise.all([
      requireUser(req),
      req.json().catch(() => ({})) as Promise<Body>,
    ])

    const bicicletaId = typeof body.bicicletaId === 'string' ? body.bicicletaId : ''
    const aliadoId = typeof body.aliadoId === 'string' ? body.aliadoId : ''
    if (!bicicletaId || !aliadoId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'bicicletaId y aliadoId son obligatorios.')
    }
    const nota =
      typeof body.nota === 'string' && body.nota.trim() ? body.nota.trim().slice(0, 500) : null

    const solicitud = await crearSolicitudReserva({
      usuarioId: user.id,
      bicicletaId,
      aliadoId,
      nota,
    })

    return NextResponse.json({ solicitud }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
