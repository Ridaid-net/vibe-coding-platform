import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { procesarPrestamosVencidos } from '@/src/services/prestamos-bici.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/prestamos/procesar-vencidos — barrido de préstamos
 * gratuitos de bici vencidos: dispara una alerta SOLO interna (iot_alertas,
 * visible en el panel del taller) -- nunca Modo Robo, nunca notifica a
 * RODAID o autoridades. Pensado para ejecutarse como tarea programada
 * (requiere x-admin-token).
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await procesarPrestamosVencidos()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
