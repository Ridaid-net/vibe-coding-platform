import { NextResponse } from 'next/server'
import {
  requireAuth,
  toUsuarioPublico,
  USUARIO_PUBLIC_COLUMNS,
  type UsuarioRow,
} from '@/lib/auth'
import { ApiError, getPool, jsonError } from '@/lib/marketplace'

export const runtime = 'nodejs'

/**
 * GET /api/v1/auth/me — Perfil del usuario autenticado.
 *
 * Endpoint privado protegido por `requireAuth`. Devuelve el usuario en su forma
 * publica (nunca la contrasena). Util para que el frontend hidrate la sesion.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req)
    const result = await getPool().query<UsuarioRow>(
      `SELECT ${USUARIO_PUBLIC_COLUMNS} FROM usuarios WHERE id = $1 LIMIT 1`,
      [auth.id]
    )
    const row = result.rows[0]
    if (!row) {
      throw new ApiError(404, 'USUARIO_NOT_FOUND', 'El usuario no existe.')
    }
    return NextResponse.json({ usuario: toUsuarioPublico(row) })
  } catch (error) {
    return jsonError(error)
  }
}
