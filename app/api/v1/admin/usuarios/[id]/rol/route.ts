import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAdmin } from '@/lib/marketplace'
import { cambiarRol, esRolValido } from '@/src/services/roles.service'

export const runtime = 'nodejs'

interface CambiarRolBody {
  rol?: unknown
}

/**
 * POST /api/v1/admin/usuarios/:id/rol — cambia el rol de un usuario. El nuevo rol
 * se refleja en el próximo login (el JWT vigente conserva el rol anterior).
 * Requiere x-admin-token.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = requireAdmin(req)
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as CambiarRolBody

    if (!esRolValido(body.rol)) {
      throw new ApiError(400, 'ROL_INVALIDO', 'rol debe ser CICLISTA, INSPECTOR, ALIADO o ADMIN.')
    }

    const result = await cambiarRol({ usuarioId: id, nuevoRol: body.rol, adminId: admin.id })
    return NextResponse.json({
      ok: true,
      data: {
        ...result,
        mensaje: `Rol actualizado: ${result.rolAnterior} → ${result.rolNuevo}.`,
        aviso: 'El cambio se aplica en el próximo inicio de sesión del usuario.',
      },
    })
  } catch (error) {
    return jsonError(error)
  }
}
