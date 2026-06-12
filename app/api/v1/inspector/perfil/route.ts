import { NextResponse } from 'next/server'
import { ApiError, getPool, jsonError, requireUser } from '@/lib/marketplace'
import { getInspectorProfile } from '@/src/services/roles.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/inspector/perfil — perfil del inspector autenticado, con sus
 * estadísticas de CITs emitidos.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const perfil = await getInspectorProfile(user.id)
    if (!perfil) {
      throw new ApiError(404, 'NO_INSPECTOR_PROFILE', 'No tenés un perfil de inspector.')
    }

    const pool = getPool()
    const { rows } = await pool.query<{ emitidos: string; activos: string; mes: string }>(
      `SELECT COUNT(*)::text AS emitidos,
              COUNT(*) FILTER (WHERE estado = 'ACTIVO')::text AS activos,
              COUNT(*) FILTER (WHERE fecha_emision > NOW() - INTERVAL '30 days')::text AS mes
         FROM cits WHERE inspector_id = $1`,
      [perfil.inspectorId]
    )
    const stats = rows[0]

    return NextResponse.json({
      ok: true,
      data: {
        ...perfil,
        stats: {
          citsEmitidos: Number(stats?.emitidos ?? 0),
          citsActivos: Number(stats?.activos ?? 0),
          citsUltimos30Dias: Number(stats?.mes ?? 0),
        },
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}
