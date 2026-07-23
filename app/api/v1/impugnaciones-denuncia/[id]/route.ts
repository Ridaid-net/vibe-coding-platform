import { NextResponse } from 'next/server'
import { jsonError, requireUser } from '@/lib/marketplace'
import { obtenerImpugnacionConEvidencia } from '@/src/services/impugnaciones-denuncia.service'

export const runtime = 'nodejs'

/** GET /api/v1/impugnaciones-denuncia/:id — lectura para quien inició la impugnación. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const resultado = await obtenerImpugnacionConEvidencia(id, user.id)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}
