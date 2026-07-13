export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { procesarRecordatoriosRemito } from '@/src/services/remito.service'

/**
 * POST /api/v1/admin/remitos/recordatorios-pendientes — barrido de
 * recordatorios al vendedor que todavia no genero el Remito de Embalaje y
 * Despacho, con el saldo ya confirmado. Pensado para ejecutarse como tarea
 * programada (requiere x-admin-token).
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await procesarRecordatoriosRemito()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
