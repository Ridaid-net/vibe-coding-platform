import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { reportarRoboEnCurso } from '@/src/services/iot.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/iot/robo-en-curso — reporte de "robo en curso" al Ministerio de
 * Seguridad (Hito 12) con la ubicacion en tiempo real.
 *
 * Requiere la AUTORIZACION EXPRESA del usuario ante la emergencia
 * ({ bicicletaId, autorizo: true }): sin ese consentimiento explicito no se
 * comparte ninguna ubicacion. Comparte la ultima posicion conocida, asienta la
 * alerta y notifica al dueño.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as {
      bicicletaId?: unknown
      autorizo?: unknown
    }
    const bicicletaId =
      typeof body.bicicletaId === 'string' ? body.bicicletaId.trim() : ''
    if (!bicicletaId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Indicá la bicicleta robada.')
    }
    const resultado = await reportarRoboEnCurso(
      user.id,
      bicicletaId,
      body.autorizo === true
    )
    return NextResponse.json(resultado, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return jsonError(error)
  }
}
