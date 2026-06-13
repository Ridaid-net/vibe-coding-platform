import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAdmin } from '@/lib/marketplace'
import {
  notificarCITAprobado,
  notificarCITRechazado,
  notificarAlertaRobo,
} from '@/src/services/notificaciones.service'

export const runtime = 'nodejs'

interface EventoBody {
  tipo?: unknown
  citId?: unknown
  cit_id?: unknown
  bicicletaId?: unknown
  bicicleta_id?: unknown
  motivo?: unknown
  detalle?: unknown
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * POST /api/v1/admin/notificaciones/eventos
 *
 * Punto de integracion de los disparadores de eventos del ciclo de vida que
 * generan notificaciones. Lo invocan los flujos del sistema (aprobacion /
 * rechazo del CIT, reporte de robo). Requiere x-admin-token.
 *
 * Body: { tipo: 'CIT_APROBADO' | 'CIT_RECHAZADO' | 'ALERTA_ROBO', ... }
 *   · CIT_APROBADO  → { citId }
 *   · CIT_RECHAZADO → { citId, motivo? }
 *   · ALERTA_ROBO   → { bicicletaId, detalle? }
 */
export async function POST(req: Request) {
  try {
    requireAdmin(req)
    const body = (await req.json()) as EventoBody
    const tipo = asText(body.tipo)

    if (tipo === 'CIT_APROBADO') {
      const citId = asText(body.citId ?? body.cit_id)
      if (!citId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'citId es obligatorio.')
      }
      const notificacion = await notificarCITAprobado(citId)
      return NextResponse.json({ notificacion })
    }

    if (tipo === 'CIT_RECHAZADO') {
      const citId = asText(body.citId ?? body.cit_id)
      if (!citId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'citId es obligatorio.')
      }
      const notificacion = await notificarCITRechazado(citId, asText(body.motivo))
      return NextResponse.json({ notificacion })
    }

    if (tipo === 'ALERTA_ROBO') {
      const bicicletaId = asText(body.bicicletaId ?? body.bicicleta_id)
      if (!bicicletaId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'bicicletaId es obligatorio.')
      }
      const notificacion = await notificarAlertaRobo({
        bicicletaId,
        detalle: asText(body.detalle),
      })
      return NextResponse.json({ notificacion })
    }

    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'tipo invalido. Use CIT_APROBADO, CIT_RECHAZADO o ALERTA_ROBO.'
    )
  } catch (error) {
    return jsonError(error)
  }
}
