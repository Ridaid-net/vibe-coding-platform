import { NextResponse } from 'next/server'
import { ApiError, getPool, jsonError, requireUser } from '@/lib/marketplace'
import { verifyPassword } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * Re-autenticacion por contrasena del usuario ya logueado (paso de "alta
 * seguridad" antes de una accion sensible en el cliente, p. ej. el Boton de
 * Panico "Modo Robo" -- ver garaje-digital.tsx).
 *
 * No es MFA. Se evaluo reusar `verificarMfaYStepUp()`/`requireAdminPanel()`
 * (lib/admin-panel.ts, el "Re-verificar MFA" del Admin Dashboard) para esto y
 * se descarto: ese mecanismo esta scopeado enteramente a `rol = 'admin'` (pasa
 * por `requireAdminUser`) y exige un TOTP ya enrolado (QR escaneado en una app
 * autenticadora) -- ningun ciclista tiene una fila en `admin_perfiles` ni pasa
 * jamas por ese enrolamiento. Reusarlo tal cual hubiera significado construir,
 * desde cero, un enrolamiento TOTP para cada ciclista -- y la primera vez que
 * lo necesitaria seria en medio de un robo real, el peor momento para pedirle
 * que configure un segundo factor por primera vez.
 *
 * En su lugar, se reusa el UNICO primitivo de "confirmar que sos vos" que ya
 * existe para cuentas locales: `verifyPassword()` (lib/auth.ts), el mismo que
 * ya usa `POST /api/v1/auth/cambiar-password`. Las cuentas creadas via
 * Mendoza x Mi (MxM) tienen `password_hash = NULL` (mxm.service.ts: "Crear la
 * cuenta federada (sin password: se autentica por MxM)") -- para esas, GET
 * devuelve `requierePassword: false`: su identidad ya viene verificada por un
 * proveedor gubernamental real, mas fuerte que una contrasena local, asi que
 * exigir una que no tienen no agregaria seguridad, solo las bloquearia.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const res = await getPool().query<{ password_hash: string | null }>(
      'SELECT password_hash FROM usuarios WHERE id = $1',
      [user.id]
    )
    const requierePassword = Boolean(res.rows[0]?.password_hash)
    return NextResponse.json({ requierePassword })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON valido.')
    })) as { password?: unknown }

    if (typeof body.password !== 'string' || body.password.length === 0) {
      throw new ApiError(400, 'PASSWORD_REQUERIDA', 'Ingresa tu contrasena.')
    }

    const res = await getPool().query<{ password_hash: string | null }>(
      'SELECT password_hash FROM usuarios WHERE id = $1',
      [user.id]
    )
    const hash = res.rows[0]?.password_hash ?? null
    if (!(await verifyPassword(body.password, hash))) {
      throw new ApiError(401, 'PASSWORD_INCORRECTA', 'La contrasena ingresada es incorrecta.')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
