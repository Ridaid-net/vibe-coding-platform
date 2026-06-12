import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { procesarPendientes } from '@/src/services/queue.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/queue/procesar — drena la cola: reclama y ejecuta los
 * trabajos listos (auto-release de escrow, expiracion de CITs, notificaciones).
 * Pensado para ejecutarse como tarea programada. Acepta `{ limite }` opcional.
 * Requiere x-admin-token.
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    let limite = 25
    try {
      const body = await req.json()
      if (body && Number.isFinite(Number(body.limite))) {
        limite = Math.max(1, Math.min(200, Math.floor(Number(body.limite))))
      }
    } catch {
      // Sin cuerpo: usar el limite por defecto.
    }
    return NextResponse.json({ ok: true, data: await procesarPendientes(limite) })
  } catch (error) {
    return jsonError(error)
  }
}
