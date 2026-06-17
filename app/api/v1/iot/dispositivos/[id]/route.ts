import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { actualizarDispositivo } from '@/src/services/iot.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/v1/iot/dispositivos/[id] — gestion del dispositivo por su DUEÑO.
 *
 * Permite ACTIVAR/desactivar la transmision en tiempo real (opt-in expreso del
 * usuario — es el unico que puede), cambiar el modo de bajo consumo, renombrarlo o
 * revocarlo (desvincular). Apagar la transmision borra el estado vivo.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser(req)
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const dispositivo = await actualizarDispositivo(user.id, id, {
      transmisionActiva: body.transmisionActiva,
      modoBajoConsumo: body.modoBajoConsumo,
      nombre: body.nombre,
      revocar: body.revocar,
    })
    return NextResponse.json(
      { dispositivo },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
