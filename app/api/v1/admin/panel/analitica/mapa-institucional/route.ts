import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { auditarAdmin, mapaInstitucional, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/analitica/mapa-institucional — mapa de calor para el
 * Ministerio, SIN la supresion por k-anonimato del mapa publico (focos reales,
 * incluidas las celdas de bajo volumen). Es un acceso sensible: queda auditado.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireAdminPanel(req, 'analitica:ver')
    const dias = Number(new URL(req.url).searchParams.get('dias') ?? 30)
    const mapa = await mapaInstitucional(dias)
    await auditarAdmin(ctx, {
      accion: 'analitica.mapa-institucional.ver',
      recursoTipo: 'mapa_calor',
      recursoId: `dias=${mapa.dias}`,
      detalle: { celdas: mapa.totales.celdas },
    })
    return NextResponse.json(mapa)
  } catch (error) {
    return jsonError(error)
  }
}
