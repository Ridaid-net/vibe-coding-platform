export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { requireStaff, jsonError } from '@/lib/marketplace'
import { recalcularDesempenoTalleres } from '@/src/services/talleres-desempeno.service'

/**
 * POST /api/v1/talleres/recalcular-desempeno — recalcula el promedio de
 * CITs/dia (30 dias) de cada aliado y despublica al que cae por debajo del
 * umbral. Pensada para tarea programada (x-admin-token) o admin manual.
 * Fuera de /api/v1/admin/* deliberadamente (mismo motivo que el resto de esta
 * pieza) — la protege requireStaff en el origen, igual que /api/inspector/cit.
 */
export async function POST(req: Request) {
  try {
    await requireStaff(req, 'admin')
    const resultado = await recalcularDesempenoTalleres()
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
