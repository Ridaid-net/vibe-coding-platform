import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import {
  obtenerDenunciaDeBici,
  registrarDenuncia,
} from '@/src/services/denuncia-mpf.service'

// TEMPORAL (diagnostico 2026-07-17): si el error no es de negocio (ApiError,
// ya con su propio mensaje claro), incluye el mensaje real en la respuesta
// para que sea visible en el modal sin depender de logs de Netlify
// (Federico no puede usar DevTools). Revertir apenas se confirme la causa
// real de la falla. Mismo patron que app/api/gpt/consulta/route.ts (4ca37be).
function jsonErrorConDebug(error: unknown) {
  if (!(error instanceof ApiError)) {
    console.error('[denuncia] error no controlado en registrarDenuncia', error)
    const detalle = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: `[DEBUG TEMPORAL] ${detalle.slice(0, 300)}` },
      { status: 500 }
    )
  }
  return jsonError(error)
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/bicicletas/[id]/denuncia — Denuncia Ciudadana (Hito 18).
 *
 * El usuario reporta el robo/hurto de su bici adjuntando OBLIGATORIAMENTE el PDF
 * de la denuncia realizada ante el MPF (multipart/form-data, campo `pdf`). El
 * sistema:
 *   - exige identidad gubernamental (MxM) del testigo,
 *   - extrae el texto del PDF (OCR si es necesario) y valida que contenga el
 *     expediente, la fecha y los datos del propietario,
 *   - si valida: pasa a DENUNCIA_JUDICIAL_ACTIVA (desactiva el CIT, bloquea el
 *     Marketplace, marca la incidencia en la BFA y avisa al Ministerio con un link
 *     seguro al PDF),
 *   - si no valida: queda EN_REVISION (no bloquea automaticamente),
 *   - siempre guarda el hash del PDF en la auditoria inmutable.
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
      throw new ApiError(
        400,
        'MULTIPART_REQUERIDO',
        'Adjuntá el PDF de la denuncia como multipart/form-data.'
      )
    }
    const form = await req.formData()
    const entry = form.get('pdf') ?? form.get('documento') ?? form.get('file')
    if (!(entry instanceof File) || entry.size === 0) {
      throw new ApiError(
        400,
        'PDF_REQUERIDO',
        'Tenés que adjuntar el PDF de la denuncia realizada ante el MPF.'
      )
    }

    const resultado = await registrarDenuncia({
      userId: user.id,
      bicicletaId: id,
      file: entry,
      fileName: entry.name ?? null,
    })

    return NextResponse.json(resultado, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return jsonErrorConDebug(error)
  }
}

/**
 * GET /api/v1/bicicletas/[id]/denuncia — estado de la denuncia mas reciente de
 * la bici (para la UI del Garaje). Solo el propietario.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireUser(req)
    const denuncia = await obtenerDenunciaDeBici(user.id, id)
    return NextResponse.json(
      { denuncia },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    return jsonError(error)
  }
}
