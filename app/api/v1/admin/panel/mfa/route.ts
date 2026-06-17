import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { enrolarMfa, permisosDeRol, requireAdminUser } from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/mfa — estado del perfil de administracion del usuario
 * (sub-rol, permisos y si el MFA ya esta enrolado). No exige step-up todavia.
 */
export async function GET(req: Request) {
  try {
    const admin = await requireAdminUser(req)
    return NextResponse.json({
      adminRol: admin.adminRol,
      mfaHabilitado: admin.mfaHabilitado,
      permisos: permisosDeRol(admin.adminRol),
    })
  } catch (error) {
    return jsonError(error)
  }
}

/**
 * POST /api/v1/admin/panel/mfa — enrola (o re-enrola) el segundo factor (TOTP).
 * Devuelve el secreto y el otpauth:// URI para escanear. Fuera de LIVE incluye el
 * codigo demo vigente para ejercitar el flujo.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdminUser(req)
    const resultado = await enrolarMfa(admin)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
