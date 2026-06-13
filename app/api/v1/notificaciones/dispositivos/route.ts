import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import {
  registrarDispositivo,
  desactivarDispositivo,
} from '@/src/services/notificaciones.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DispositivoBody {
  token?: unknown
  plataforma?: unknown
}

/**
 * POST /api/v1/notificaciones/dispositivos
 * Registra (o reactiva) el token push del dispositivo del usuario autenticado.
 */
export async function POST(req: Request) {
  try {
    const [user, body] = await Promise.all([
      requireUser(req),
      req.json() as Promise<DispositivoBody>,
    ])

    const resultado = await registrarDispositivo({
      usuarioId: user.id,
      token: typeof body.token === 'string' ? body.token : '',
      plataforma: typeof body.plataforma === 'string' ? body.plataforma : null,
    })

    return NextResponse.json({ dispositivo: resultado }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}

/**
 * DELETE /api/v1/notificaciones/dispositivos
 * Desuscribe un token del usuario (logout / baja del dispositivo).
 */
export async function DELETE(req: Request) {
  try {
    const [user, body] = await Promise.all([
      requireUser(req),
      req.json() as Promise<DispositivoBody>,
    ])

    const resultado = await desactivarDispositivo({
      usuarioId: user.id,
      token: typeof body.token === 'string' ? body.token : '',
    })

    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
