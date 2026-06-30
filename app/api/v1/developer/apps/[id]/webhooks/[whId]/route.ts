import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAuth } from '@/lib/marketplace'
import { getAppDeUsuario } from '@/src/services/developer.service'
import {
  actualizarWebhook,
  eliminarWebhook,
} from '@/src/services/webhooks-ecosistema.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/v1/developer/apps/[id]/webhooks/[whId] — gestión de UNA suscripción.
 *
 * PATCH  → actualiza url / eventos / estado (activar o pausar).
 * DELETE → elimina la suscripción.
 */

async function exigirApp(req: Request, appId: string) {
  const user = await requireAuth(req)
  const app = await getAppDeUsuario(appId, user.id)
  if (!app) throw new ApiError(404, 'APP_NOT_FOUND', 'No encontramos la aplicación.')
  return app
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; whId: string }> }
) {
  try {
    const { id, whId } = await params
    await exigirApp(req, id)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const webhook = await actualizarWebhook(whId, id, {
      url: body.url,
      eventos: body.eventos,
      estado: body.estado,
    })
    return NextResponse.json({ webhook }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; whId: string }> }
) {
  try {
    const { id, whId } = await params
    await exigirApp(req, id)
    await eliminarWebhook(whId, id)
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return jsonError(error)
  }
}
