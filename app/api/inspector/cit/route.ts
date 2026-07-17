import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText, requireRole } from '@/lib/marketplace'
import type { ChecklistInspeccion } from '@/lib/puntos-inspeccion'
import {
  aprobarInspeccionFisica,
  autorizarCitParaInspeccion,
  buscarParaInspeccion,
  cargarInspectorContexto,
  reportarDiscrepancia,
  verificarActaPorId,
} from '@/src/services/inspeccion.service'

export const runtime = 'nodejs'

/**
 * Panel de Gestion del Hito 11 — endpoint unificado del Portal de Inspectores.
 *
 * Restringido a los roles `inspector` / `aliado` / `admin`.
 *
 *   GET  /api/inspector/cit?q=SERIE_O_CIT
 *        Busca la bici por numero de serie o codigo CIT y devuelve la vista de
 *        inspeccion (datos + estado del pipeline + historial de actas firmadas),
 *        respetando el alcance del usuario (un aliado solo ve sus bicis).
 *
 *   POST /api/inspector/cit
 *        { citId, accion: 'aprobar' | 'discrepancia' | 'verificar', ... }
 *        - 'aprobar'      -> firma digital del acta (Web Crypto / PKCS#12) +
 *                            acelerador del pipeline (72hs -> 0) + anclaje en BFA.
 *        - 'discrepancia' -> frena la verificacion (CIT rechazado). { motivo }.
 *        - 'verificar'    -> valida la firma digital de un acta. { actaId }.
 *        Toda accion exige una identidad digital (wallet_address) en el perfil y
 *        asocia la validacion a `inspector_id` + `taller_id` (trazabilidad).
 */

interface PostBody {
  citId?: unknown
  actaId?: unknown
  accion?: unknown
  notas?: unknown
  motivo?: unknown
  /** Checklist de 20 puntos (JSON serializado). Presente en 'aprobar' (via
   * multipart) y opcionalmente en 'discrepancia' (via JSON) cuando el
   * rechazo se origina en el checklist completo. */
  checklist?: unknown
}

/**
 * Parsea el body en JSON (camino de siempre: discrepancia/verificar, y
 * aprobar sin checklist) o en multipart/form-data (aprobar CON checklist +
 * fotos de componentes). El content-type real del request decide, no un
 * flag -- así ningún caller existente que siga mandando JSON se rompe.
 * Campos de archivo esperados: `foto_P06`, `foto_P08`, etc. (prefijo
 * `foto_` + puntoId).
 */
async function parseBody(
  req: Request
): Promise<{ body: PostBody; fotosPorPunto: Record<string, Blob> }> {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const body: PostBody = {
      citId: form.get('citId') ?? undefined,
      actaId: form.get('actaId') ?? undefined,
      accion: form.get('accion') ?? undefined,
      notas: form.get('notas') ?? undefined,
      motivo: form.get('motivo') ?? undefined,
      checklist: form.get('checklist') ?? undefined,
    }
    const fotosPorPunto: Record<string, Blob> = {}
    for (const [key, value] of form.entries()) {
      if (key.startsWith('foto_') && value instanceof File && value.size > 0) {
        fotosPorPunto[key.slice('foto_'.length)] = value
      }
    }
    return { body, fotosPorPunto }
  }
  const body = (await req.json().catch(() => ({}))) as PostBody
  return { body, fotosPorPunto: {} }
}

/**
 * Parsea `body.checklist` (string JSON, tanto en multipart como en el body
 * JSON de 'discrepancia') a `ChecklistInspeccion`. Compartido entre 'aprobar'
 * y 'discrepancia' -- mismo formato de campo en los dos casos.
 */
function parseChecklist(body: PostBody): ChecklistInspeccion | null {
  const raw = typeof body.checklist === 'string' ? body.checklist : null
  if (!raw) return null
  try {
    return JSON.parse(raw) as ChecklistInspeccion
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El checklist enviado no es JSON válido.')
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireRole('inspector', 'aliado', 'admin')(req)
    const url = new URL(req.url)
    const verComoAliado = url.searchParams.get('verComoAliado')
    const ctx = await cargarInspectorContexto(user.id, verComoAliado)
    const q = url.searchParams.get('q') ?? url.searchParams.get('serial') ?? ''
    const resultado = await buscarParaInspeccion(q, ctx)
    return NextResponse.json(resultado)
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireRole('inspector', 'aliado', 'admin')(req)
    // Deliberado: SIN verComoAliado acá. Aprobar/reportar discrepancia firma
    // un acta real -- un admin en "ver como" nunca puede atribuirle una
    // accion a un aliado que no es el suyo.
    const ctx = await cargarInspectorContexto(user.id)
    const { body, fotosPorPunto } = await parseBody(req)
    const accion = typeof body.accion === 'string' ? body.accion : ''

    // Verificacion de firma: no requiere wallet ni alcance sobre un CIT.
    if (accion === 'verificar') {
      const actaId = optionalText(body.actaId)
      if (!actaId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Indica el actaId a verificar.')
      }
      const verificacion = await verificarActaPorId(actaId, ctx)
      return NextResponse.json(verificacion)
    }

    const citId = optionalText(body.citId)
    if (!citId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Indica el citId a inspeccionar.')
    }

    // Identidad digital obligatoria para firmar (aprobar o reportar).
    if (!ctx.walletAddress) {
      throw new ApiError(
        409,
        'WALLET_REQUERIDA',
        'Necesitas una wallet_address en tu perfil para firmar el acta.'
      )
    }

    const { aliadoId } = await autorizarCitParaInspeccion(ctx, citId)

    if (accion === 'aprobar') {
      const resultado = await aprobarInspeccionFisica({
        citId,
        inspector: ctx,
        aliadoId,
        notas: optionalText(body.notas),
        checklist: parseChecklist(body),
        fotosPorPunto,
      })
      return NextResponse.json(resultado, { status: 201 })
    }

    if (accion === 'discrepancia') {
      const motivo = optionalText(body.motivo)
      if (!motivo) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Indica el motivo de la discrepancia.')
      }
      // URGENTE (fix 2026-07-18): preserva el checklist de 20 puntos cuando
      // la discrepancia se reporta desde ese flujo (calcularResultadoChecklist
      // dio aprobada=false) -- antes se perdia por completo. Deliberadamente
      // sin fotosPorPunto acá: ver el comentario junto al INSERT en
      // reportarDiscrepancia() sobre por que tampoco se tokenizan componentes.
      const resultado = await reportarDiscrepancia({
        citId,
        inspector: ctx,
        aliadoId,
        motivo,
        checklist: parseChecklist(body),
      })
      return NextResponse.json(resultado, { status: 201 })
    }

    throw new ApiError(
      400,
      'ACCION_INVALIDA',
      "Accion no soportada. Usa 'aprobar', 'discrepancia' o 'verificar'."
    )
  } catch (error) {
    return jsonError(error)
  }
}
