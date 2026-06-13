import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { listarNotificaciones } from '@/src/services/notificaciones.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/notificaciones
 * Centro de notificaciones del usuario autenticado (mas recientes primero).
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)

    const limiteParam = new URL(req.url).searchParams.get('limite')
    const limite = limiteParam ? Number(limiteParam) : undefined

    const notificaciones = await listarNotificaciones(
      user.id,
      Number.isFinite(limite) ? (limite as number) : undefined
    )

    return NextResponse.json({ notificaciones })
  } catch (error) {
    return jsonError(error)
  }
}
