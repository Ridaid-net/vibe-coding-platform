import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireRole } from '@/lib/marketplace'
import {
  aprobarInspeccionFisica,
  autorizarCitParaInspeccion,
  cargarInspectorContexto,
} from '@/src/services/inspeccion.service'

export const runtime = 'nodejs'

interface Body {
  notas?: unknown
}

/**
 * POST /api/v1/inspecciones/[citId]/aprobar — Aprobar la inspeccion fisica.
 *
 * Restringido a inspector / aliado / admin. El inspector DEBE tener una
 * wallet_address en su perfil (identidad digital). La accion es una transaccion
 * atomica: registra el acta de auditoria, la firma con la wallet del inspector y
 * acelera el pipeline de 72hs a 0hs, disparando la decision + el anclaje en la
 * BFA de inmediato.
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
        'Necesitas una wallet_address en tu perfil para firmar la aprobacion.'
      )
    }

    const { aliadoId } = await autorizarCitParaInspeccion(ctx, citId)
    const body = (await req.json().catch(() => ({}))) as Body
    const notas = optionalText(body.notas)

    const resultado = await aprobarInspeccionFisica({
      citId,
      inspector: ctx,
      aliadoId,
      notas,
    })

    return NextResponse.json(resultado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
