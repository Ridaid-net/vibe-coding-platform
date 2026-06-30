import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { procesarValidacionesPendientes } from '@/src/services/validation.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/admin/validaciones/procesar — Worker del pipeline de validacion.
 *
 * Barre los jobs PENDIENTE de `cola_validaciones` cuya ventana de 72hs vencio y
 * los procesa (cross-reference -> decision -> hash -> notificacion). Pensado
 * para ejecutarse desde la Netlify Scheduled Function `validacion-worker`
 * (requiere x-admin-token). Idempotente: invocarlo de mas no duplica trabajo.
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const resultado = await procesarValidacionesPendientes()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
