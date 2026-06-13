import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { getCit } from '@/src/services/cit.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/cit/inspecciones/:id
 * Devuelve el CIT con el detalle de sus 20 puntos de control.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const cit = await getCit(id)
    return NextResponse.json({ cit })
  } catch (error) {
    return jsonError(error)
  }
}
