import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { PERMISOS, can, resolverRol, type Permiso } from '@/src/services/roles.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/roles/check/:permiso — indica si el usuario autenticado tiene el
 * permiso indicado según su rol.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ permiso: string }> }
) {
  try {
    const user = await requireUser(req)
    const { permiso } = await params

    if (!(PERMISOS as readonly string[]).includes(permiso)) {
      throw new ApiError(404, 'PERMISO_DESCONOCIDO', `Permiso desconocido: ${permiso}.`)
    }

    const rol = await resolverRol(user.id, user.rol)
    const allowed = can(rol, permiso as Permiso)
    return NextResponse.json({ ok: true, data: { rol, permiso, allowed } })
  } catch (error) {
    return jsonError(error)
  }
}
