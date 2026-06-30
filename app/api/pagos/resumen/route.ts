import { NextResponse } from 'next/server'
import { jsonError, requireRole } from '@/lib/marketplace'
import { resumenFinanciero } from '@/src/services/compensaciones.service'

export const runtime = 'nodejs'

/**
 * GET /api/pagos/resumen — Dashboard Financiero (Hito 13).
 *
 * Accesible para administradores y dueños de talleres (rol aliado). El admin ve
 * el resumen GLOBAL (Total Recaudado, Comisiones RODAID, Pagos a Aliados y
 * Disputas abiertas); un dueño de taller ve unicamente lo suyo.
 */
export async function GET(req: Request) {
  try {
    const user = await requireRole('admin', 'aliado')(req)
    const resumen = await resumenFinanciero({ rol: user.rol, usuarioId: user.id })
    return NextResponse.json(resumen)
  } catch (error) {
    return jsonError(error)
  }
}
