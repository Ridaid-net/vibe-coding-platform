import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { anonimizarHistorico } from '@/src/services/iot.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/iot/anonimizar — Hito 17: anonimizacion de la traza historica.
 *
 * Barrido de sistema (autenticado con `x-admin-token`) que borra la posicion
 * PRECISA cifrada de la telemetria historica anterior a 30 dias y deja solo el geo
 * RECORTADO a barrio, exactamente como el mapa de calor (Hito 14). Lo invoca la
 * Scheduled Function `iot-anonimizacion-worker`. Idempotente.
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await anonimizarHistorico()
    return NextResponse.json(resultado, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
