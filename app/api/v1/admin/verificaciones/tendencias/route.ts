import { NextResponse } from 'next/server'
import { jsonError, requireStaff } from '@/lib/marketplace'
import { getTendenciasVerificaciones } from '@/src/services/verificacion.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/verificaciones/tendencias — Analitica de seguridad (Hito 7).
 *
 * Devuelve las series/codigos consultados repetidamente en el verificador
 * publico dentro de una ventana de tiempo. Sirve para detectar el interes
 * inusual en una bici puntual (posible compra/venta de una unidad robada).
 *
 * Acceso: back-office (rol admin/inspector) o token de sistema (x-admin-token).
 * Los datos son anonimos: se cuentan IPs distintas por su hash, nunca la IP.
 *
 * Query params: ?horas=24&min=3&limite=50
 */
export async function GET(req: Request) {
  try {
    await requireStaff(req, 'admin', 'inspector')

    const url = new URL(req.url)
    const horas = clamp(Number(url.searchParams.get('horas')) || 24, 1, 720)
    const min = clamp(Number(url.searchParams.get('min')) || 3, 2, 100)
    const limite = clamp(Number(url.searchParams.get('limite')) || 50, 1, 200)

    const tendencias = await getTendenciasVerificaciones({
      horas,
      minConsultas: min,
      limite,
    })

    return NextResponse.json({
      ventanaHoras: horas,
      minConsultas: min,
      total: tendencias.length,
      tendencias,
    })
  } catch (error) {
    return jsonError(error)
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}
