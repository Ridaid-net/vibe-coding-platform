import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { getPermisos, resolverRol } from '@/src/services/roles.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/roles/mine — rol efectivo y permisos del usuario autenticado.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const rol = await resolverRol(user.id, user.rol)
    const permisos = getPermisos(rol)
    return NextResponse.json({
      ok: true,
      data: { rol, permisos, total: permisos.length },
    })
  } catch (error) {
    return jsonError(error)
  }
}
