import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { escanearVencimientosProximos } from '@/src/services/notificaciones.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/notificaciones/escanear-vencimientos
 *
 * Ejecuta el arbol de decision del CIT: detecta los certificados activos que
 * entraron en la zona de "proximo a vencer" (menos de 60 dias) y todavia no
 * fueron alertados, y dispara la notificacion de vencimiento. Idempotente:
 * una sola alerta por CIT. Pensado para ejecutarse como tarea programada
 * (requiere x-admin-token).
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await escanearVencimientosProximos()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
