import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAdmin } from '@/lib/marketplace'
import { crearTaller, listarTalleres } from '@/src/services/roles.service'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface CrearTallerBody {
  nombre?: unknown
  direccion?: unknown
  localidad?: unknown
  provincia?: unknown
  telefono?: unknown
  email?: unknown
  descripcion?: unknown
  planAliado?: unknown
  propietarioId?: unknown
}

/**
 * GET /api/v1/admin/talleres?habilitados=true|false — lista talleres aliados.
 * Requiere x-admin-token.
 */
export async function GET(req: Request) {
  try {
    requireAdmin(req)
    const habilitadosParam = new URL(req.url).searchParams.get('habilitados')
    const habilitado =
      habilitadosParam === null ? undefined : habilitadosParam === 'true'
    const data = await listarTalleres(habilitado)
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return jsonError(error)
  }
}

/**
 * POST /api/v1/admin/talleres — crea un taller aliado y, si se indica un
 * propietario, lo promueve a ALIADO. Requiere x-admin-token.
 */
export async function POST(req: Request) {
  try {
    const admin = requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as CrearTallerBody

    if (typeof body.nombre !== 'string' || body.nombre.trim().length < 3) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'nombre es obligatorio (mínimo 3 caracteres).')
    }
    if (body.propietarioId !== undefined && body.propietarioId !== null) {
      if (typeof body.propietarioId !== 'string' || !UUID_RE.test(body.propietarioId)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'propietarioId debe ser un UUID válido.')
      }
    }

    const taller = await crearTaller({
      nombre: body.nombre.trim(),
      direccion: optionalStr(body.direccion),
      localidad: optionalStr(body.localidad),
      provincia: optionalStr(body.provincia),
      telefono: optionalStr(body.telefono),
      email: optionalStr(body.email),
      descripcion: optionalStr(body.descripcion),
      planAliado: optionalStr(body.planAliado),
      propietarioId: typeof body.propietarioId === 'string' ? body.propietarioId : null,
      adminId: admin.id,
    })

    return NextResponse.json({ ok: true, data: taller }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}

function optionalStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
