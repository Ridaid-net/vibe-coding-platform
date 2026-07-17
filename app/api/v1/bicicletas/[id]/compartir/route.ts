import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import {
  activarCompartir,
  obtenerEstadoCompartir,
  revocarCompartir,
} from '@/src/services/garaje-publico.service'

export const runtime = 'nodejs'

/**
 * /api/v1/bicicletas/[id]/compartir — Historial Clinico publico (opt-in).
 *
 * GET    -> estado actual (activo/token/url/vistas), para que el Garaje sepa
 *           que boton mostrar.
 * POST   -> activa el compartir (genera el token si no habia uno activo).
 * DELETE -> revoca el compartir (no borra el historial de vistas).
 *
 * Las tres requieren sesion y que el usuario sea el propietario de la bici
 * (verificado dentro del servicio).
 */

function baseUrl(req: Request): string {
  const configured = process.env.RODAID_BASE_URL?.replace(/\/+$/, '')
  if (configured) return configured
  try {
    return new URL(req.url).origin
  } catch {
    return 'https://rodaid.net'
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const estado = await obtenerEstadoCompartir(id, user.id, baseUrl(req))
    return NextResponse.json(estado)
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
    const user = await requireUser(req)
    const estado = await activarCompartir(id, user.id, baseUrl(req))
    return NextResponse.json(estado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    await revocarCompartir(id, user.id)
    return NextResponse.json({ activo: false })
  } catch (error) {
    return jsonError(error)
  }
}
