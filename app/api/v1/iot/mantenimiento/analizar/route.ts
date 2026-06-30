import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { analizarMantenimiento } from '@/src/services/iot-mantenimiento.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/iot/mantenimiento/analizar — Mantenimiento Predictivo con IA.
 *
 * Analiza los datos del acelerometro de la bici del usuario con RODAID-GPT (Claude
 * Sonnet via AI Gateway) y devuelve un diagnostico estructurado: 'posible desgaste
 * en cadena', 'presión de cubiertas' o 'necesidad de servicio técnico', creando
 * alertas para los hallazgos significativos. El backend es el unico intermediario
 * con el modelo. Solo el dueño puede pedirlo.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as { bicicletaId?: unknown }
    const bicicletaId =
      typeof body.bicicletaId === 'string' ? body.bicicletaId.trim() : ''
    if (!bicicletaId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Indicá la bicicleta a analizar.')
    }
    const analisis = await analizarMantenimiento(user.id, bicicletaId)
    return NextResponse.json(analisis, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
