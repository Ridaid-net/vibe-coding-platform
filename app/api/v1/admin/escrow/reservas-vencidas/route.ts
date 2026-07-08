import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { procesarReservasVencidas } from '@/src/services/escrow.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/escrow/reservas-vencidas — barrido del timeout de 48hs.
 * Revierte a PUBLICADO_CERTIFICADO / PUBLICADO_PENDIENTE_CERTIFICACION las
 * publicaciones cuya reserva vencio sin que el comprador confirmara el pago.
 * Pensado para ejecutarse como tarea programada (requiere x-admin-token).
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await procesarReservasVencidas()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
