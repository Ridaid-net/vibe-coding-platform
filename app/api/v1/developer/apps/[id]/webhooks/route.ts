import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAuth } from '@/lib/marketplace'
import { getAppDeUsuario } from '@/src/services/developer.service'
import {
  EVENTOS_ECOSISTEMA,
  crearWebhook,
  listarWebhooksDeApp,
} from '@/src/services/webhooks-ecosistema.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/v1/developer/apps/[id]/webhooks — Hito 16: Webhooks de Ecosistema.
 *
 * GET  → lista las suscripciones de la app + el catálogo de eventos públicos.
 * POST → crea una suscripción. Devuelve el secreto de firma HMAC UNA sola vez.
 */

async function exigirAppDeUsuario(req: Request, appId: string) {
  const user = await requireAuth(req)
  const app = await getAppDeUsuario(appId, user.id)
  if (!app) throw new ApiError(404, 'APP_NOT_FOUND', 'No encontramos la aplicación.')
  return app
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await exigirAppDeUsuario(req, id)
    const webhooks = await listarWebhooksDeApp(id)
    return NextResponse.json(
      { webhooks, eventos: EVENTOS_ECOSISTEMA },
      { headers: { 'cache-control': 'no-store' } }
    )
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
    await exigirAppDeUsuario(req, id)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const webhook = await crearWebhook(id, { url: body.url, eventos: body.eventos })
    return NextResponse.json(
      { webhook },
      { status: 201, headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
