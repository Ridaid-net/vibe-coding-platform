import { NextResponse } from 'next/server'
import { ApiError, jsonError, optionalText } from '@/lib/marketplace'
import { accionApiKey, requireAdminPanel, type AccionApiKey } from '@/lib/admin-panel'

export const runtime = 'nodejs'

const ACCIONES: AccionApiKey[] = ['revocar', 'habilitar']

interface Body {
  accion?: unknown
  motivo?: unknown
}

/**
 * POST /api/v1/admin/panel/identidades/api-keys/:id — habilita o revoca la API
 * Key de un tercero. Al revocar se anulan sus tokens vivos. Auditado.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAdminPanel(req, 'identidades:accion')
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Body
    const accion = optionalText(body.accion) as AccionApiKey | null
    if (!accion || !ACCIONES.includes(accion)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `accion debe ser una de: ${ACCIONES.join(', ')}.`)
    }
    return NextResponse.json(await accionApiKey(ctx, id, accion, { motivo: optionalText(body.motivo) }))
  } catch (error) {
    return jsonError(error)
  }
}
