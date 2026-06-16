import { NextResponse } from 'next/server'
import { ApiError, jsonError, parseText, requireRole } from '@/lib/marketplace'
import {
  autorizarCitParaInspeccion,
  cargarInspectorContexto,
  reportarDiscrepancia,
} from '@/src/services/inspeccion.service'

export const runtime = 'nodejs'

interface Body {
  motivo?: unknown
}

/**
 * POST /api/v1/inspecciones/[citId]/discrepancia — Reportar una discrepancia.
 *
 * Restringido a inspector / aliado / admin (con wallet_address). Registra el
 * acta de discrepancia (firmada) y FRENA la verificacion: el CIT pasa a
 * 'rechazado' y el pipeline no auto-aprobara la bici.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ citId: string }> }
) {
  try {
    const { citId } = await params
    const user = await requireRole('inspector', 'aliado', 'admin')(req)
    const ctx = await cargarInspectorContexto(user.id)

    if (!ctx.walletAddress) {
      throw new ApiError(
        409,
        'WALLET_REQUERIDA',
        'Necesitas una wallet_address en tu perfil para firmar el acta.'
      )
    }

    const { aliadoId } = await autorizarCitParaInspeccion(ctx, citId)
    const body = (await req.json().catch(() => ({}))) as Body
    const motivo = parseText(body.motivo, 'El motivo de la discrepancia', 600)

    const resultado = await reportarDiscrepancia({
      citId,
      inspector: ctx,
      aliadoId,
      motivo,
    })

    return NextResponse.json(resultado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
