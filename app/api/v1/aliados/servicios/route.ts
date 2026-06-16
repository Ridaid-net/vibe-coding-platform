import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireRole } from '@/lib/marketplace'
import { cargarInspectorContexto } from '@/src/services/inspeccion.service'
import { vincularServicio } from '@/src/services/aliados.service'

export const runtime = 'nodejs'

interface Body {
  numeroSerie?: unknown
  tipoServicio?: unknown
  detalle?: unknown
  aliadoId?: unknown
}

/**
 * POST /api/v1/aliados/servicios — Vincula una bici a un aliado.
 *
 * Registra que el taller vendio o mantiene una bicicleta (por numero de serie),
 * habilitando su inspeccion por ese aliado. Un 'aliado' vincula a su propio
 * taller; un 'admin' puede vincular a cualquiera pasando `aliadoId`.
 */
export async function POST(req: Request) {
  try {
    const user = await requireRole('aliado', 'admin')(req)
    const body = (await req.json().catch(() => ({}))) as Body

    let aliadoId: string | null = null
    if (user.rol === 'admin') {
      aliadoId = optionalText(body.aliadoId)
      if (!aliadoId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Indica el aliadoId a vincular.')
      }
    } else {
      const ctx = await cargarInspectorContexto(user.id)
      if (!ctx.aliado) {
        throw new ApiError(
          403,
          'ALIADO_NO_APROBADO',
          'Tu cuenta de aliado todavia no esta aprobada.'
        )
      }
      aliadoId = ctx.aliado.id
    }

    const numeroSerie = optionalText(body.numeroSerie)
    if (!numeroSerie) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Indica el numero de serie de la bici.')
    }

    const resultado = await vincularServicio({
      aliadoId,
      numeroSerie,
      tipoServicio: typeof body.tipoServicio === 'string' ? body.tipoServicio : undefined,
      detalle: optionalText(body.detalle),
    })

    return NextResponse.json(resultado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
