import { NextResponse } from 'next/server'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  hashPassword,
  USUARIO_PUBLIC_COLUMNS,
  type UsuarioRow,
} from '@/lib/auth'
import { buildAuthResponse } from '@/lib/auth-http'
import { ApiError, getPool, jsonError, optionalText } from '@/lib/marketplace'
import { getModo } from '@/src/services/mercadopago.service'

export const runtime = 'nodejs'

interface Body {
  nombre?: unknown
  email?: unknown
}

/**
 * POST /api/v1/auth/demo-session
 *
 * Conveniencia para ejercitar el checkout de RODAID PAY en los entornos de
 * preview (sin pagos reales), donde todavia no hay un alta de usuarios cargada.
 *
 * A diferencia del atajo anterior —que firmaba un JWT con un id arbitrario no
 * respaldado por ninguna fila—, ahora CREA un usuario real en `usuarios` (mismo
 * camino que el registro: contrasena hasheada, sesion con RefreshToken) y
 * devuelve tokens validos. Asi el `propietario_id` / `vendedor_id` que produce
 * este usuario referencia siempre una fila real y respeta las claves foraneas.
 *
 * Queda deshabilitado en modo LIVE de MercadoPago: con dinero real solo se
 * permite la autenticacion definitiva (registro / login).
 */
export async function POST(req: Request) {
  try {
    if (getModo() === 'LIVE') {
      throw new ApiError(
        403,
        'DEMO_DESHABILITADO',
        'La sesion de prueba no esta disponible en modo LIVE.'
      )
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const nombre = optionalText(body.nombre) ?? 'Comprador de prueba'
    const email =
      optionalText(body.email)?.toLowerCase() ??
      `demo-${randomUUID().slice(0, 12)}@rodaid.test`

    // Contrasena aleatoria (no se devuelve): la cuenta demo opera por tokens.
    const passwordHash = await hashPassword(randomBytes(24).toString('base64url'))

    const pool = getPool()
    const insert = await pool.query<UsuarioRow>(
      `
        INSERT INTO usuarios (email, password_hash, rol, datos_perfil, proveedor)
        VALUES ($1, $2, 'ciclista', $3::jsonb, 'local')
        RETURNING ${USUARIO_PUBLIC_COLUMNS}, password_hash
      `,
      [email, passwordHash, JSON.stringify({ nombre, demo: true })]
    ).catch(async (error: unknown) => {
      // Email demo ya existente (poco probable): reutilizamos esa cuenta.
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        return pool.query<UsuarioRow>(
          `SELECT ${USUARIO_PUBLIC_COLUMNS}, password_hash FROM usuarios WHERE lower(email) = lower($1) LIMIT 1`,
          [email]
        )
      }
      throw error
    })

    const row = insert.rows[0]
    if (!row) {
      throw new ApiError(500, 'DEMO_ERROR', 'No se pudo crear la sesion de prueba.')
    }

    const sesion = await buildAuthResponse(row, req)
    return NextResponse.json({
      ...sesion,
      userId: row.id,
      nombre,
      email: row.email,
      modo: getModo(),
    })
  } catch (error) {
    return jsonError(error)
  }
}
