import { NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyPassword, USUARIO_PUBLIC_COLUMNS, type UsuarioRow } from '@/lib/auth'
import { buildAuthResponse } from '@/lib/auth-http'
import { ApiError, getPool, jsonError } from '@/lib/marketplace'

export const runtime = 'nodejs'

/**
 * POST /api/v1/auth/login — Inicio de sesion con email + contrasena.
 *
 * Verifica la contrasena contra su hash (scrypt, comparacion en tiempo
 * constante) y, si es correcta, abre una sesion: AccessToken corto +
 * RefreshToken largo persistido en `sesiones`. Ante credenciales invalidas
 * responde un 401 generico (no revela si el email existe).
 */
const loginSchema = z.object({
  email: z.string().min(1, 'El identificador es obligatorio.'),
  password: z.string({ required_error: 'La contrasena es obligatoria.' }).min(1),
})
function esCuil(v: string) { return /^[0-9]{11}$/.test(v.replace(/[-s]/g, '')) }
function normalizarId(v: string) { return esCuil(v) ? v.replace(/[-s]/g, '') : v.trim().toLowerCase() }

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON valido.')
    })) as Record<string, unknown>

    const parsed = loginSchema.safeParse({
      email: body.email,
      password: body.password,
    })
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Email y contrasena son obligatorios.')
    }
    const { email: rawId, password } = parsed.data
    const email = normalizarId(rawId)

    const pool = getPool()
    const result = await pool.query<UsuarioRow>(
      `
        SELECT ${USUARIO_PUBLIC_COLUMNS}, password_hash
        FROM usuarios
        WHERE (lower(email) = lower($1) OR (cuil IS NOT NULL AND cuil = $1)) AND proveedor = 'local'
        LIMIT 1
      `,
      [email]
    )

    const row = result.rows[0]
    // Verificamos siempre la contrasena (aun si el usuario no existe usamos un
    // hash dummy) para no filtrar la existencia del email por timing.
    const ok = await verifyPassword(
      password,
      row?.password_hash ??
        'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    )

    if (!row || !ok) {
      throw new ApiError(401, 'CREDENCIALES_INVALIDAS', 'CUIL, email o contrasena incorrectos.')
    }

    const sesion = await buildAuthResponse(row, req)
    return NextResponse.json(sesion)
  } catch (error) {
    return jsonError(error)
  }
}
