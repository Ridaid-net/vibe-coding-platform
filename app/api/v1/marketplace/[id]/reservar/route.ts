import { NextResponse } from 'next/server'
import { jsonError, optionalText, requireUser } from '@/lib/marketplace'
import { iniciarReservaCitCompleto } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

interface ReservarBody {
  email?: unknown
  compradorEmail?: unknown
  nombre?: unknown
  compradorNombre?: unknown
}

/**
 * POST /api/v1/marketplace/:id/reservar
 * Fase 6 (CIT Completo): primer paso del flujo. Si la bici todavia no esta
 * certificada, cobra la sena (financia la verificacion del Taller Aliado) y
 * pasa la publicacion a RESERVADO. Si ya esta certificada, cobra el saldo
 * completo en un solo pago y pasa directo a EJECUTANDO_LOGISTICA. Bloquea con
 * 422 SIN_TALLER_VINCULADO si la bici no tiene un Taller Aliado vinculado.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as ReservarBody

    const resultado = await iniciarReservaCitCompleto({
      publicacionId: id,
      compradorId: user.id,
      compradorEmail: optionalText(body.compradorEmail ?? body.email),
      compradorNombre: optionalText(body.compradorNombre ?? body.nombre),
    })

    return NextResponse.json(resultado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
