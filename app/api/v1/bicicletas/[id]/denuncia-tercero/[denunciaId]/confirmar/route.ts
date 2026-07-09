import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { confirmarComoPropietario } from '@/src/services/denuncia-tercero.service'

export const runtime = 'nodejs'

interface Body {
  confirmaRobo?: unknown
  confirma_robo?: unknown
}

/**
 * POST /api/v1/bicicletas/:id/denuncia-tercero/:denunciaId/confirmar — el
 * propietario registrado confirma o niega el robo denunciado por un tercero.
 * ENDPOINT REAL de usuario (no un mock): el dueño es una cuenta RODAID que se
 * loguea y responde el mismo, sin depender de ningun canal externo. Solo
 * valido en estado ESPERANDO_PROPIETARIO (409 ESTADO_INVALIDO si no).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; denunciaId: string }> }
) {
  try {
    const { denunciaId } = await params
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as Body

    const raw = body.confirmaRobo ?? body.confirma_robo
    if (typeof raw !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'confirmaRobo debe ser true o false.')
    }

    await confirmarComoPropietario(denunciaId, user.id, raw)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
