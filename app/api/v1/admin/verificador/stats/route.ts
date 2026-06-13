import { NextResponse } from 'next/server'
import { jsonError, requireAdmin } from '@/lib/marketplace'
import { verificadorStats } from '@/src/services/verificador.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/verificador/stats — analytics de verificaciones públicas
 * (totales, tasa de aciertos, latencia, desglose por origen y estado, últimas
 * consultas). Requiere x-admin-token. Acepta ?dias=N (por defecto 30).
 */
export async function GET(req: Request) {
  try {
    requireAdmin(req)
    const diasParam = Number(new URL(req.url).searchParams.get('dias'))
    const dias = Number.isFinite(diasParam) && diasParam > 0 && diasParam <= 365 ? diasParam : 30
    return NextResponse.json({ ok: true, data: await verificadorStats(dias) })
  } catch (error) {
    return jsonError(error)
  }
}
