import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAdmin } from '@/lib/marketplace'
import { esRolValido, listarUsuarios } from '@/src/services/roles.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/usuarios?rol=INSPECTOR&page=1&limit=20 — lista usuarios,
 * opcionalmente filtrados por rol. Requiere x-admin-token.
 */
export async function GET(req: Request) {
  try {
    requireAdmin(req)
    const url = new URL(req.url)
    const rolParam = url.searchParams.get('rol')
    if (rolParam !== null && !esRolValido(rolParam)) {
      throw new ApiError(400, 'ROL_INVALIDO', 'rol debe ser CICLISTA, INSPECTOR, ALIADO o ADMIN.')
    }
    const page = clampInt(url.searchParams.get('page'), 1, 1, 100000)
    const limit = clampInt(url.searchParams.get('limit'), 20, 1, 100)

    const data = await listarUsuarios(rolParam ?? undefined, page, limit)
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return jsonError(error)
  }
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(Math.max(parsed, min), max)
}
