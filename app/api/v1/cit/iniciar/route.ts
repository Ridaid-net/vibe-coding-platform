import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import {
  PUNTOS_INSPECCION,
  can,
  iniciarCIT,
  requireInspectorProfile,
  resolverRol,
  type PuntosInspeccion,
} from '@/src/services/roles.service'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface IniciarBody {
  bicicletaId?: unknown
  puntos?: unknown
  fotosUrls?: unknown
  firmaInspector?: unknown
  djFirmada?: unknown
  propietarioDNI?: unknown
  propietarioNombre?: unknown
}

/**
 * POST /api/v1/cit/iniciar — emite un CIT para una bicicleta. Pipeline de
 * autorización: JWT válido → rol con permiso `cit:iniciar` → perfil de inspector
 * activo, certificado y con taller habilitado → emisión.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)

    const rol = await resolverRol(user.id, user.rol)
    if (!can(rol, 'cit:iniciar')) {
      throw new ApiError(403, 'FORBIDDEN', 'Tu rol no puede emitir CITs.')
    }

    const inspector = await requireInspectorProfile(user.id)
    const body = (await req.json().catch(() => ({}))) as IniciarBody

    if (typeof body.bicicletaId !== 'string' || !UUID_RE.test(body.bicicletaId)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'bicicletaId debe ser un UUID válido.')
    }
    const puntos = parsePuntos(body.puntos)
    const fotosUrls = parseFotos(body.fotosUrls)
    if (typeof body.firmaInspector !== 'string' || body.firmaInspector.trim().length < 10) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'firmaInspector es obligatoria (mínimo 10 caracteres).')
    }
    if (body.djFirmada !== true) {
      throw new ApiError(422, 'DJ_REQUERIDA', 'La declaración jurada debe estar firmada (djFirmada: true).')
    }
    if (typeof body.propietarioDNI !== 'string' || body.propietarioDNI.trim().length < 7) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'propietarioDNI es obligatorio (mínimo 7 caracteres).')
    }
    if (typeof body.propietarioNombre !== 'string' || body.propietarioNombre.trim().length < 3) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'propietarioNombre es obligatorio (mínimo 3 caracteres).')
    }

    const result = await iniciarCIT({
      bicicletaId: body.bicicletaId,
      inspectorId: inspector.inspectorId,
      tallerAliadoId: inspector.tallerAliadoId,
      puntos,
      fotosUrls,
      firmaInspector: body.firmaInspector.trim(),
      djFirmada: true,
      propietarioDNI: body.propietarioDNI.trim(),
      propietarioNombre: body.propietarioNombre.trim(),
    })

    return NextResponse.json({ ok: true, data: result }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}

function parsePuntos(value: unknown): PuntosInspeccion {
  if (typeof value !== 'object' || value === null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'puntos debe ser un objeto con los 20 puntos de inspección.')
  }
  const source = value as Record<string, unknown>
  const puntos = {} as PuntosInspeccion
  for (const punto of PUNTOS_INSPECCION) {
    puntos[punto] = source[punto] === true
  }
  return puntos
}

function parseFotos(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'fotosUrls debe ser un arreglo con al menos 1 foto.')
  }
  const fotos = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if (fotos.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Se requiere al menos 1 foto en fotosUrls.')
  }
  return fotos
}
