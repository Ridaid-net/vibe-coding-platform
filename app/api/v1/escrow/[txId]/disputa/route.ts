import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { abrirDisputaCitCompleto, type EvidenciaArchivo } from '@/src/services/disputas-cit-completo.service'

export const runtime = 'nodejs'

/**
 * POST /api/v1/escrow/:txId/disputa — Esquema 1 Caso B: el comprador abre una
 * disputa de CIT Completo (el vendedor no completa una venta ya pagada).
 * Reembolsa de inmediato y cancela la venta puntual -- el CIT nunca se toca.
 *
 * multipart/form-data: `motivo` (texto) + uno o mas archivos bajo el campo
 * `evidencia` (mismo patron de subida de archivos que /api/inspector/cit).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ txId: string }> }
) {
  try {
    const { txId } = await params
    const user = await requireUser(req)

    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser multipart/form-data.')
    }
    const form = await req.formData()
    const motivo = form.get('motivo')
    if (typeof motivo !== 'string' || !motivo.trim()) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Indicá el motivo de la disputa.')
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

    const disputa = await abrirDisputaCitCompleto({
      escrowTransaccionId: txId,
      compradorId: user.id,
      motivo: motivo.trim(),
      evidencia,
    })

    return NextResponse.json({ disputa }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
