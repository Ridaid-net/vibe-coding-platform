import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { listarEventos, obtenerCIT } from '@/src/services/cit.service'

export const runtime = 'nodejs'

/** GET /api/v1/cit/:id/eventos — audit trail del ciclo de vida del certificado. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const cit = await obtenerCIT(id)

    if (cit.ciclistaId !== user.id && cit.aliadoId !== user.id) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'No tenes acceso a este certificado.' },
        { status: 403 }
      )
    }

    const eventos = await listarEventos(id)
    return NextResponse.json({ eventos })
  } catch (error) {
    return jsonError(error)
  }
}
