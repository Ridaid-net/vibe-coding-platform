import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { crearGeovalla, listarGeovallas } from '@/src/services/iot.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/iot/geovallas — lista las "zonas seguras" del usuario (opcionalmente
 * filtradas por bici con ?bicicletaId=...).
 *
 * POST /api/v1/iot/geovallas — crea una zona segura (centro + radio). Si la bici
 * sale de una geovalla activa sin autorizacion, el sistema dispara una alerta push.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const url = new URL(req.url)
    const bicicletaId = url.searchParams.get('bicicletaId') ?? undefined
    const geovallas = await listarGeovallas(user.id, bicicletaId)
    return NextResponse.json(
      { geovallas },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const geovalla = await crearGeovalla(user.id, {
      bicicletaId: body.bicicletaId,
      nombre: body.nombre,
      centerLat: body.centerLat,
      centerLng: body.centerLng,
      radioM: body.radioM,
    })
    return NextResponse.json(
      { geovalla },
      { status: 201, headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
