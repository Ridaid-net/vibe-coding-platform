import { NextResponse } from 'next/server'
import { jsonError, optionalText, requireUser } from '@/lib/marketplace'
import { confirmarPagoCitCompleto } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

interface ConfirmarPagoBody {
  email?: unknown
  compradorEmail?: unknown
  nombre?: unknown
  compradorNombre?: unknown
}

/**
 * POST /api/v1/marketplace/:id/confirmar-pago
 * Fase 6 (CIT Completo): segundo pago (saldo) del flujo de dos cobros. Solo
 * disponible cuando el Taller Aliado ya sello la verificacion (publicacion
 * EJECUTANDO_LOGISTICA); si no, 409 VERIFICACION_PENDIENTE. No aplica si la
 * bici ya estaba certificada al reservar (ese camino cobro todo en /reservar).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as ConfirmarPagoBody

    const resultado = await confirmarPagoCitCompleto({
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
