import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import {
  listarDispositivos,
  vincularDispositivo,
} from '@/src/services/iot.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/iot/dispositivos — lista los dispositivos de telemetria del usuario
 * con su estado (transmision activa, bateria, conectado).
 *
 * POST /api/v1/iot/dispositivos — vincula un nuevo dispositivo a una bici del
 * usuario. Devuelve las credenciales (device_uid + secret) UNA sola vez.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const dispositivos = await listarDispositivos(user.id)
    return NextResponse.json(
      { dispositivos },
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
    const resultado = await vincularDispositivo(user.id, {
      bicicletaId: body.bicicletaId,
      nombre: body.nombre,
      modoBajoConsumo: body.modoBajoConsumo,
    })
    return NextResponse.json(resultado, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
