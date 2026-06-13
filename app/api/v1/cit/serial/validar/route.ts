import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { can, requireInspectorProfile, resolverRol } from '@/src/services/roles.service'
import { validarSerial } from '@/src/services/validacion-serial.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/cit/serial/validar?serial=SN-...&propietarioDNI=30123456 —
 * pre-check de un serial sin crear ningún CIT. Un inspector lo ejecuta desde la
 * app antes de ir al taller del cliente. Persiste la validación para auditoría.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const rol = await resolverRol(user.id, user.rol)
    if (!can(rol, 'cit:iniciar')) {
      throw new ApiError(403, 'FORBIDDEN', 'Tu rol no puede validar seriales para CIT.')
    }
    const inspector = await requireInspectorProfile(user.id)

    const url = new URL(req.url)
    const serial = url.searchParams.get('serial')?.trim()
    const propietarioDNI = url.searchParams.get('propietarioDNI')?.trim()
    const propietarioNombre = url.searchParams.get('propietarioNombre')?.trim() || null

    if (!serial) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'El parámetro serial es obligatorio.')
    }
    if (!propietarioDNI || propietarioDNI.length < 7) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'propietarioDNI es obligatorio (mínimo 7 caracteres).')
    }

    const data = await validarSerial({
      serial,
      propietarioDNI,
      propietarioNombre,
      inspectorId: inspector.inspectorId,
    })

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return jsonError(error)
  }
}
