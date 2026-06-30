import { NextResponse } from 'next/server'
import { jsonError, requireRole } from '@/lib/marketplace'
import {
  buscarParaInspeccion,
  cargarInspectorContexto,
} from '@/src/services/inspeccion.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/inspecciones/buscar?q=SERIE_O_CIT — Panel de Inspecciones.
 *
 * Restringido a inspector / aliado / admin. Busca la bici por numero de serie o
 * codigo CIT y devuelve los datos para la inspeccion fisica, respetando el
 * alcance del usuario (un aliado solo ve sus bicis vinculadas).
 */
export async function GET(req: Request) {
  try {
    const user = await requireRole('inspector', 'aliado', 'admin')(req)
    const ctx = await cargarInspectorContexto(user.id)
    const url = new URL(req.url)
    const q = url.searchParams.get('q') ?? url.searchParams.get('serial') ?? ''
    const resultado = await buscarParaInspeccion(q, ctx)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
