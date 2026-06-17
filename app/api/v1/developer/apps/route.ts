import { NextResponse } from 'next/server'
import { jsonError, requireAuth } from '@/lib/marketplace'
import {
  catalogoScopes,
  listarAppsDeUsuario,
  registrarApp,
} from '@/src/services/developer.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/v1/developer/apps — Hito 16: Portal de Desarrolladores (App Registration).
 *
 * GET  → lista las apps del usuario autenticado (sin secretos) + el catálogo de
 *        scopes disponibles.
 * POST → registra una nueva app. Devuelve el client_secret y la API Key EN CLARO
 *        una sola vez (luego solo se conserva su hash).
 */

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req)
    const apps = await listarAppsDeUsuario(user.id)
    return NextResponse.json(
      { apps, scopes: catalogoScopes() },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const creada = await registrarApp(user.id, {
      nombre: body.nombre,
      descripcion: body.descripcion,
      sitioUrl: body.sitioUrl,
      redirectUris: body.redirectUris,
      scopes: body.scopes,
      entorno: body.entorno,
    })
    return NextResponse.json(creada, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
