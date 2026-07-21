import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildAuthResponse, passwordSchema } from '@/lib/auth-http'
import { toUsuarioPublico } from '@/lib/auth'
import { ApiError, jsonError } from '@/lib/marketplace'
import { reclamarCuenta } from '@/src/services/certificacion-mostrador.service'

export const runtime = 'nodejs'

const bodySchema = z.object({
  token: z.string({ required_error: 'El token es obligatorio.' }).trim().min(1),
  password: passwordSchema,
})

/**
 * POST /api/v1/auth/reclamar-cuenta — El cliente de un taller (cuenta creada
 * por "Iniciar Certificación") elige su propia contraseña usando el link que
 * le llegó por mail. Sin auth: el token en si es la credencial. Devuelve una
 * sesion ya iniciada, mismo criterio que el registro normal.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON valido.')
    })) as Record<string, unknown>

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ApiError(400, 'VALIDATION_ERROR', issue?.message ?? 'Datos invalidos.')
    }

    const row = await reclamarCuenta(parsed.data.token, parsed.data.password)
    const sesion = await buildAuthResponse(row, req)
    return NextResponse.json({ ...sesion, usuario: toUsuarioPublico(row) })
  } catch (error) {
    return jsonError(error)
  }
}
