import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireAdmin } from '@/lib/marketplace'
import { listarInspectores, registrarInspector } from '@/src/services/roles.service'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface CrearInspectorBody {
  usuarioId?: unknown
  tallerAliadoId?: unknown
  certificacion?: unknown
  notas?: unknown
}

/**
 * GET /api/v1/admin/inspectores?taller=<uuid> — lista inspectores activos.
 * Requiere x-admin-token.
 */
export async function GET(req: Request) {
  try {
    requireAdmin(req)
    const taller = new URL(req.url).searchParams.get('taller')
    if (taller && !UUID_RE.test(taller)) {
      throw new ApiError(400, 'TALLER_INVALIDO', 'taller debe ser un UUID válido.')
    }
    const data = await listarInspectores(taller ?? undefined)
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return jsonError(error)
  }
}

/**
 * POST /api/v1/admin/inspectores — registra (o reactiva) un inspector vinculado a
 * un taller. Queda pendiente de certificación. Requiere x-admin-token.
 */
export async function POST(req: Request) {
  try {
    const admin = requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as CrearInspectorBody

    if (typeof body.usuarioId !== 'string' || !UUID_RE.test(body.usuarioId)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'usuarioId debe ser un UUID válido.')
    }
    if (typeof body.tallerAliadoId !== 'string' || !UUID_RE.test(body.tallerAliadoId)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'tallerAliadoId debe ser un UUID válido.')
    }

    const profile = await registrarInspector({
      usuarioId: body.usuarioId,
      tallerAliadoId: body.tallerAliadoId,
      adminId: admin.id,
      certificacion: typeof body.certificacion === 'string' ? body.certificacion : null,
      notas: typeof body.notas === 'string' ? body.notas : null,
    })

    return NextResponse.json(
      { ok: true, data: { ...profile, mensaje: 'Inspector registrado. Pendiente de certificación.' } },
      { status: 201 }
    )
  } catch (error) {
    return jsonError(error)
  }
}
