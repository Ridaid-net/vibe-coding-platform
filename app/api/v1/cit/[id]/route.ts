import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { obtenerCIT } from '@/src/services/cit.service'

export const runtime = 'nodejs'

/** GET /api/v1/cit/:id — devuelve un certificado. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const cit = await obtenerCIT(id)
    return NextResponse.json({ cit })
  } catch (error) {
    return jsonError(error)
  }
}
