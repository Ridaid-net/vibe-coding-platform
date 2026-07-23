import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { iniciarReclamoTitularidad, type EvidenciaArchivo } from '@/src/services/reclamos-titularidad.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/bicicletas/:id/reclamo-titularidad — Esquema 3: alguien que
 * compró una bici ya registrada por otro dueño, pero por fuera de la
 * plataforma, reclama la titularidad con evidencia. Notifica automáticamente
 * al dueño actual registrado (48hs para responder).
 *
 * multipart/form-data: `motivo` (texto) + uno o más archivos bajo el campo
 * `evidencia` (mismo patrón que /api/v1/escrow/[txId]/disputa).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)

    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser multipart/form-data.')
    }
    const form = await req.formData()
    const motivo = form.get('motivo')
    if (typeof motivo !== 'string' || !motivo.trim()) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Contanos por qué esta bici es tuya.')
    }

    const evidencia: EvidenciaArchivo[] = []
    for (const [key, value] of form.entries()) {
      if (key === 'evidencia' && value instanceof File && value.size > 0) {
        evidencia.push({
          bytes: Buffer.from(await value.arrayBuffer()),
          nombreArchivo: value.name,
          contentType: value.type || 'application/octet-stream',
        })
      }
    }

    const reclamo = await iniciarReclamoTitularidad({
      bicicletaId: id,
      reclamanteId: user.id,
      motivo: motivo.trim(),
      evidencia,
    })

    return NextResponse.json({ reclamo }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
