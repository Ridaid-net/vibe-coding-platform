import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { getColaTrabajo, getResumenHoy, getTalleres } from '@/src/services/cit.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/inspector/cola
 * Cola de trabajo del taller aliado: bicicletas sin CIT vigente, talleres
 * activos y los KPIs de CITs emitidos hoy.
 */
export async function GET(req: Request) {
  try {
    await requireUser(req)
    const [cola, talleres, resumen] = await Promise.all([
      getColaTrabajo(),
      getTalleres(),
      getResumenHoy(),
    ])
    return NextResponse.json({ cola, talleres, resumen })
  } catch (error) {
    return jsonError(error)
  }
}
