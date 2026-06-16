import { SignJWT } from 'jose'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ApiError, getAuthSecret, jsonError, optionalText } from '@/lib/marketplace'
import { getModo } from '@/src/services/mercadopago.service'

export const runtime = 'nodejs'

interface Body {
  userId?: unknown
  nombre?: unknown
  email?: unknown
}

/**
 * POST /api/v1/auth/demo-session
 *
 * Emite un JWT de comprador de prueba para poder ejercitar el checkout de
 * RODAID PAY mientras el sistema de cuentas (Hito 1) todavia no existe.
 *
 * Es un atajo de desarrollo: solo responde fuera del modo LIVE de MercadoPago
 * (STUB/SANDBOX). En produccion real (LIVE) queda deshabilitado y debe usarse
 * la autenticacion definitiva.
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

    const secret = getAuthSecret()
    if (!secret) {
      throw new ApiError(500, 'AUTH_NOT_CONFIGURED', 'Autenticacion no configurada.')
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const userId = optionalText(body.userId) ?? randomUUID()
    const nombre = optionalText(body.nombre) ?? 'Comprador de prueba'
    const email =
      optionalText(body.email) ?? `comprador-${userId.slice(0, 8)}@rodaid.test`

    const token = await new SignJWT({ nombre, email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(new TextEncoder().encode(secret))

    return NextResponse.json({ token, userId, nombre, email, modo: getModo() })
  } catch (error) {
    return jsonError(error)
  }
}
