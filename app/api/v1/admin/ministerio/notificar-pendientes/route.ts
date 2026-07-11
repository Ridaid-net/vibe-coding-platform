import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { notificarDenunciasJudicialesPendientes } from '@/src/services/denuncia-mpf.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/ministerio/notificar-pendientes — Reintento de la
 * notificacion de denuncia judicial al Ministerio de Seguridad.
 *
 * Barre las denuncias activas cuya notificacion institucional quedo pendiente
 * (la red fallo o se colgo al notificar) y reintenta. Pensado para una
 * Netlify Scheduled Function (requiere x-admin-token). Best-effort e
 * idempotente: una denuncia ya notificada no se vuelve a notificar. Mismo
 * patron que POST /api/v1/admin/blockchain/anclar.
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await notificarDenunciasJudicialesPendientes()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
