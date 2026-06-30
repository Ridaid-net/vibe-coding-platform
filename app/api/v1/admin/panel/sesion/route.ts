import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText } from '@/lib/marketplace'
import { requireAdminUser, verificarMfaYStepUp } from '@/lib/admin-panel'

export const runtime = 'nodejs'

interface Body {
  code?: unknown
  codigo?: unknown
}

/**
 * POST /api/v1/admin/panel/sesion — step-up MFA. Verifica el codigo TOTP y emite
 * el token de step-up (corto) que habilita las operaciones del panel. La primera
 * verificacion confirma el enrolamiento del segundo factor.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdminUser(req)
    const body = (await req.json().catch(() => ({}))) as Body
    const code = optionalText(body.code ?? body.codigo)
    if (!code) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Ingresa el codigo de verificacion.')
    }
    const resultado = await verificarMfaYStepUp(admin, code)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
