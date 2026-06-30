import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAuth } from '@/lib/marketplace'
import {
  actualizarApp,
  eliminarApp,
  getAppDeUsuario,
  resumenUso,
  toAppPublic,
} from '@/src/services/developer.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/v1/developer/apps/[id] — gestión de UNA app del desarrollador.
 *
 * GET    → detalle de la app + resumen de uso (dashboard: totales, errores, P95,
 *          últimas llamadas) para el panel de rate-limiting y logs.
 * PATCH  → actualiza nombre/descripcion/redirects/scopes/entorno/estado.
 * DELETE → elimina la app (y en cascada sus tokens/códigos/webhooks lógicos).
 */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { id } = await params
    const app = await getAppDeUsuario(id, user.id)
    if (!app) throw new ApiError(404, 'APP_NOT_FOUND', 'No encontramos la aplicación.')
    const uso = await resumenUso(id)
    return NextResponse.json(
      { app: toAppPublic(app), uso },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const app = await actualizarApp(id, user.id, {
      nombre: body.nombre,
      descripcion: body.descripcion,
      sitioUrl: body.sitioUrl,
      redirectUris: body.redirectUris,
      scopes: body.scopes,
      entorno: body.entorno,
      estado: body.estado,
    })
    return NextResponse.json({ app }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { id } = await params
    await eliminarApp(id, user.id)
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return jsonError(error)
  }
}
