import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { listarAlertas, reconocerAlerta } from '@/src/services/iot.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/iot/alertas — lista las alertas de telemetria del usuario (salida de
 * geovalla, mantenimiento predictivo, robo en curso, batería baja).
 *
 * PATCH /api/v1/iot/alertas — marca una alerta como reconocida ({ alertaId }).
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const url = new URL(req.url)
    const limite = Number(url.searchParams.get('limite')) || 50
    const alertas = await listarAlertas(user.id, limite)
    return NextResponse.json(
      { alertas },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as { alertaId?: unknown }
    const alertaId = typeof body.alertaId === 'string' ? body.alertaId : ''
    if (!alertaId) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Falta el id de la alerta.' },
        { status: 400 }
      )
    }
    await reconocerAlerta(user.id, alertaId)
    return NextResponse.json(
      { ok: true },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
