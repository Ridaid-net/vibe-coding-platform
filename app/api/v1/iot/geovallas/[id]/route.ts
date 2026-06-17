import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { actualizarGeovalla, eliminarGeovalla } from '@/src/services/iot.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/v1/iot/geovallas/[id] — activa/pausa una zona segura, autoriza una
 * salida temporal (sin alertar) o la renombra. Solo el dueño.
 *
 * DELETE /api/v1/iot/geovallas/[id] — elimina la zona segura. Solo el dueño.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser(req)
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const geovalla = await actualizarGeovalla(user.id, id, {
      activa: body.activa,
      autorizadaSalida: body.autorizadaSalida,
      nombre: body.nombre,
    })
    return NextResponse.json(
      { geovalla },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser(req)
    const { id } = await params
    await eliminarGeovalla(user.id, id)
    return NextResponse.json(
      { ok: true },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
