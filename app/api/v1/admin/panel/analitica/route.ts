import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { analiticaEcosistema, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/analitica — Analitica de Ecosistema: metricas agregadas
 * (tokens GPT, consumo de API de terceros, volumen de transacciones de RODAID PAY,
 * estado de CITs y cuentas). Sin datos personales.
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'analitica:ver')
    return NextResponse.json(await analiticaEcosistema())
  } catch (error) {
    return jsonError(error)
  }
}
