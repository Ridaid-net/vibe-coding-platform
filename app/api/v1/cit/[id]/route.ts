import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { estadoCIT } from '@/src/services/cit-estado.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/cit/:id — estado efectivo de un CIT. Acepta el UUID del CIT o su
 * número (RCIT-2026-00041). Endpoint público (no requiere JWT); el apellido del
 * propietario se enmascara y el hash del acta se trunca.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const data = await estadoCIT(decodeURIComponent(id))
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return jsonError(error)
  }
}
