import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  hashPassword,
  toUsuarioPublico,
  USUARIO_PUBLIC_COLUMNS,
  type UsuarioRow,
} from '@/lib/auth'
import { buildAuthResponse, emailSchema, passwordSchema } from '@/lib/auth-http'
import { ApiError, getPool, jsonError } from '@/lib/marketplace'

export const runtime = 'nodejs'

/**
 * POST /api/v1/auth/registro — Alta de una cuenta local (email + contrasena).
 *
 * Crea el usuario con la contrasena hasheada (scrypt) y abre una sesion: emite
 * un AccessToken corto y un RefreshToken largo (persistido en `sesiones`). El
 * rol se fija en 'ciclista'; elevar a inspector/admin es una accion
 * administrativa y nunca puede auto-asignarse en el registro.
 */
const registroSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  nombre: z.string().trim().min(1).max(120).optional(),
})

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON valido.')
    })) as Record<string, unknown>

    const parsed = registroSchema.safeParse({
      email: body.email,
      password: body.password,
      nombre: typeof body.nombre === 'string' ? body.nombre : undefined,
    })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ApiError(400, 'VALIDATION_ERROR', issue?.message ?? 'Datos invalidos.')
    }
    const { email, password, nombre } = parsed.data

    const pool = getPool()
    const passwordHash = await hashPassword(password)
    const datosPerfil = nombre ? { nombre } : {}

    let row: UsuarioRow
    try {
      const insert = await pool.query<UsuarioRow>(
        `
          INSERT INTO usuarios (email, password_hash, rol, datos_perfil, proveedor)
          VALUES ($1, $2, 'ciclista', $3::jsonb, 'local')
          RETURNING ${USUARIO_PUBLIC_COLUMNS}, password_hash
        `,
        [email, passwordHash, JSON.stringify(datosPerfil)]
      )
      row = insert.rows[0]
    } catch (error) {
      // Email duplicado (indice unico sobre lower(email)).
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        throw new ApiError(
          409,
          'EMAIL_EN_USO',
          'Ya existe una cuenta registrada con ese email.'
        )
      }
      throw error
    }

    const sesion = await buildAuthResponse(row, req)
    // `toUsuarioPublico` ya excluye password_hash; reforzamos no filtrarlo.
    return NextResponse.json({ ...sesion, usuario: toUsuarioPublico(row) }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
