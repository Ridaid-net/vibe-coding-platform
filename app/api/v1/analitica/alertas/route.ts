import { NextResponse } from 'next/server'
import { jsonError, requireStaff } from '@/lib/marketplace'
import {
  detectarPuntosCalientes,
  listarAlertas,
  type AlertaEstado,
} from '@/src/services/analytics.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/analitica/alertas — Alertas de comportamiento (Hito 8).
 *
 * Lista los "Puntos Calientes" detectados: zonas donde el volumen de consultas
 * de verificacion supero el umbral critico. Es el feed del equipo de seguridad.
 *
 * Acceso: back-office (admin/inspector) o token de sistema.
 * Query params: ?estado=abierta|reconocida|descartada (por defecto, todas).
 */
export async function GET(req: Request) {
  try {
    await requireStaff(req, 'admin', 'inspector')
    const url = new URL(req.url)
    const estadoParam = url.searchParams.get('estado') as AlertaEstado | null
    const estado =
      estadoParam &&
      ['abierta', 'reconocida', 'descartada'].includes(estadoParam)
        ? estadoParam
        : undefined

    const alertas = await listarAlertas({ estado })
    return NextResponse.json({ total: alertas.length, alertas })
  } catch (error) {
    return jsonError(error)
  }
}

/**
 * POST /api/v1/analitica/alertas — Ejecuta la deteccion de Puntos Calientes a
 * demanda y persiste/actualiza las alertas. Pensado para un boton de "analizar
 * ahora" del dashboard o para una funcion programada.
 *
 * Body opcional: { ventanaHoras?: number, umbral?: number }
 */
export async function POST(req: Request) {
  try {
    await requireStaff(req, 'admin', 'inspector')
    const body = (await req.json().catch(() => ({}))) as {
      ventanaHoras?: number
      umbral?: number
    }
    const resultado = await detectarPuntosCalientes({
      ventanaHoras:
        Number.isFinite(body.ventanaHoras) && (body.ventanaHoras ?? 0) > 0
          ? Math.floor(body.ventanaHoras as number)
          : undefined,
      umbral:
        Number.isFinite(body.umbral) && (body.umbral ?? 0) >= 3
          ? Math.floor(body.umbral as number)
          : undefined,
      persistir: true,
    })
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
