import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { parseTexto } from '@/lib/cit'
import { obtenerCIT, revocarCIT } from '@/src/services/cit.service'

export const runtime = 'nodejs'

interface RevocarBody {
  motivo?: unknown
}

/**
 * POST /api/v1/cit/:id/revocar — anula el certificado (robo, fraude, error).
 * Pueden revocar el ciclista (propietario del rodado) o el aliado emisor.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as RevocarBody
    const motivo = parseTexto(body.motivo, 'motivo', 500)

    const cit = await obtenerCIT(id)
    const esAliado = cit.aliadoId === user.id
    const esCiclista = cit.ciclistaId === user.id
    if (!esAliado && !esCiclista) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'No tenes permiso para revocar este certificado.' },
        { status: 403 }
      )
    }

    const actualizado = await revocarCIT({
      citId: id,
      motivo,
      actorId: user.id,
      actorRol: esAliado ? 'aliado' : 'ciclista',
    })

    return NextResponse.json({ cit: actualizado })
  } catch (error) {
    return jsonError(error)
  }
}
