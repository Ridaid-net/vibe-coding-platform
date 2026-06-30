import { NextResponse } from 'next/server'
import { jsonError, requireStaff } from '@/lib/marketplace'
import {
  construirMapaCalor,
  detectarPuntosCalientes,
} from '@/src/services/analytics.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/analitica/mapa-calor — Mapa de Calor de Seguridad (Hito 8).
 *
 * Devuelve un GeoJSON (FeatureCollection) con dos capas AGREGADAS y ANONIMAS
 * sobre la ciudad (Mendoza):
 *   - `consultas`: densidad de consultas del verificador publico ("indice de
 *     curiosidad" sobre bicis por barrio),
 *   - `denuncias`: densidad de denuncias/discrepancias (puntos rojos).
 *
 * Cada feature es un punto en el CENTRO de una celda de ~barrio (tecnica de
 * clipping): jamas la ubicacion exacta de una bici ni de un usuario. La salida
 * es siempre conteos por celda, nunca eventos sueltos.
 *
 * Acceso: back-office (rol admin/inspector) o token de sistema (x-admin-token):
 * es inteligencia para el equipo de seguridad / autoridades.
 *
 * Query params: ?dias=7|30|90 (cualquier valor 1..365; por defecto 7).
 */
export async function GET(req: Request) {
  try {
    await requireStaff(req, 'admin', 'inspector')

    const url = new URL(req.url)
    const dias = Number(url.searchParams.get('dias')) || 7

    // Deteccion de "Puntos Calientes" best-effort al refrescar el mapa: mantiene
    // las alertas del equipo de seguridad al dia sin un cron dedicado. Nunca
    // tira abajo la respuesta del mapa.
    detectarPuntosCalientes().catch((e) =>
      console.error('[analitica] deteccion de puntos calientes fallo', e)
    )

    const geojson = await construirMapaCalor({ dias })

    return NextResponse.json(geojson, {
      headers: {
        // Cacheable brevemente: son datos agregados, no sensibles.
        'Cache-Control': 'private, max-age=30',
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}
