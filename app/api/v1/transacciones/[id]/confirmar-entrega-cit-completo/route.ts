import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { confirmarEntregaCitCompleto } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/transacciones/:id/confirmar-entrega-cit-completo — cierre de
 * CIT Completo (Fase 6 TODO resuelto): el comprador confirma la recepcion,
 * libera el pago, transfiere la titularidad real de la bici y liquida al
 * vendedor + Taller Aliado (logistica + exito).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const transaccion = await confirmarEntregaCitCompleto({
      transaccionId: id,
      compradorId: user.id,
    })
    return NextResponse.json({ transaccion })
  } catch (error) {
    return jsonError(error)
  }
}
