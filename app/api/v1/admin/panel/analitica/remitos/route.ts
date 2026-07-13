import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { auditarAdmin, remitosAdminResumen, requireAdminPanel } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/analitica/remitos — panorama consolidado de TODOS
 * los Remitos de Embalaje y Despacho del sistema (Fase 6b, CIT Completo):
 * cuántos se generaron, cuántos se despacharon, cuáles están pendientes hace
 * mucho, y qué Taller los tiene. Expone nombres de vendedores puntuales, asi
 * que queda auditado (mismo criterio que el mapa institucional).
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireAdminPanel(req, 'analitica:ver')
    const url = new URL(req.url)
    const estadoParam = url.searchParams.get('estado')
    const estado =
      estadoParam === 'GENERADO' || estadoParam === 'DESPACHADO' ? estadoParam : undefined
    const aliadoId = url.searchParams.get('aliadoId')
    const dias = Number(url.searchParams.get('dias') ?? 30)

    const datos = await remitosAdminResumen({ estado, aliadoId, dias })

    await auditarAdmin(ctx, {
      accion: 'analitica.remitos.ver',
      recursoTipo: 'remitos',
      recursoId: `dias=${datos.dias}${estado ? `,estado=${estado}` : ''}${aliadoId ? `,aliadoId=${aliadoId}` : ''}`,
      detalle: { total: datos.resumen.totalGenerados },
    })

    return NextResponse.json(datos)
  } catch (error) {
    return jsonError(error)
  }
}
