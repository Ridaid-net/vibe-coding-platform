import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { registrarInspeccion } from '@/src/services/cit.service'
import type { ResultadosPuntos } from '@/lib/cit'

export const runtime = 'nodejs'

interface InspeccionBody {
  bicicletaId?: unknown
  bicicleta_id?: unknown
  tallerId?: unknown
  taller_id?: unknown
  inspectorNombre?: unknown
  inspector_nombre?: unknown
  puntos?: unknown
  resultados?: unknown
  observaciones?: unknown
  notas?: unknown
  djFirmada?: unknown
  dj_firmada?: unknown
}

function asResultados(value: unknown): ResultadosPuntos {
  if (typeof value !== 'object' || value === null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Se requieren los resultados de los 20 puntos.')
  }
  const out: ResultadosPuntos = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = raw === true || raw === 'true' || raw === 1
  }
  return out
}

function asObservaciones(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim()) {
      out[key] = raw.trim()
    }
  }
  return out
}

/**
 * POST /api/v1/cit/inspecciones
 * Registra los 20 puntos de control y gatilla el evento del CIT
 * (ACTIVO si >= 15/20, RECHAZADO en caso contrario). El inspector es el
 * usuario autenticado.
 */
export async function POST(req: Request) {
  try {
    const [user, body] = await Promise.all([
      requireUser(req),
      req.json() as Promise<InspeccionBody>,
    ])

    const bicicletaId = body.bicicletaId ?? body.bicicleta_id
    if (typeof bicicletaId !== 'string' || bicicletaId.length === 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'bicicletaId es obligatorio.')
    }

    const inspectorNombre = body.inspectorNombre ?? body.inspector_nombre
    if (typeof inspectorNombre !== 'string') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'inspectorNombre es obligatorio.')
    }

    const tallerId = body.tallerId ?? body.taller_id
    const djFirmada = (body.djFirmada ?? body.dj_firmada) === true

    const resultado = await registrarInspeccion({
      bicicletaId,
      tallerId: typeof tallerId === 'string' ? tallerId : null,
      inspectorId: user.id,
      inspectorNombre,
      resultados: asResultados(body.puntos ?? body.resultados),
      observaciones: asObservaciones(body.observaciones),
      notas: typeof body.notas === 'string' ? body.notas : null,
      djFirmada,
    })

    return NextResponse.json(resultado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
