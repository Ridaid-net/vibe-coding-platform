export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { jsonError, requireRole } from '@/lib/marketplace'
import { resolverAliadoParaLectura } from '@/src/services/inspeccion.service'
import { listarRemitosPorAliado } from '@/src/services/remito.service'

/**
 * GET /api/v1/talleres/remitos — el Taller Aliado ve sus Remitos de Embalaje
 * y Despacho (Fase 6b, CIT Completo), pendientes primero. Solo LECTURA:
 * acepta `?verComoAliado=` (Admin View-As, resolverAliadoParaLectura) igual
 * que /api/v1/talleres/servicio-publicado y /api/v1/inspecciones/contexto.
 * El despacho en si (POST /api/v1/remitos/:numero/despachar) sigue exigiendo
 * ownership estricto -- ese endpoint nunca lee este mismo parametro.
 */
export async function GET(req: Request) {
  try {
    const user = await requireRole('aliado', 'admin')(req)
    const verComoAliado = new URL(req.url).searchParams.get('verComoAliado')
    const { aliado, modo } = await resolverAliadoParaLectura(user, verComoAliado)

    if (modo === 'vista_previa' || !aliado) {
      return NextResponse.json({ remitos: [], modoVista: modo })
    }

    const remitos = await listarRemitosPorAliado(aliado.id)
    return NextResponse.json({ remitos, modoVista: modo })
  } catch (error) {
    return jsonError(error)
  }
}
