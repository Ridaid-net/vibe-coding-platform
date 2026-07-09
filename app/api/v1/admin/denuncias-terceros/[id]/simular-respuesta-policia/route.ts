import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireStaff } from '@/lib/marketplace'
import { simularRespuestaPolicia } from '@/src/services/denuncia-tercero.service'

export const runtime = 'nodejs'

interface Body {
  confirmaRobo?: unknown
  confirma_robo?: unknown
}

/**
 * POST /api/v1/admin/denuncias-terceros/:id/simular-respuesta-policia —
 * simula la confirmacion de la Policia de Mendoza (Fase 7, caso 3). No hay
 * canal real ni usuario "policia" en RODAID (ver policia-mendoza.mock.ts) --
 * por eso esto es una accion de ADMIN, distinta del endpoint real del
 * propietario. Restringido a staff (rol admin via JWT).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await requireStaff(req, 'admin')
    const body = (await req.json().catch(() => ({}))) as Body

    const raw = body.confirmaRobo ?? body.confirma_robo
    if (typeof raw !== 'boolean') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'confirmaRobo debe ser true o false.')
    }

    await simularRespuestaPolicia(id, raw, admin.id)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
