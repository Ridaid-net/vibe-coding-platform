import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, jsonError } from '@/lib/marketplace'
import {
  invitarInspector,
  listarInspectores,
  listarTalleresAprobados,
  requireAdminPanel,
} from '@/lib/admin-panel'

export const runtime = 'nodejs'

/**
 * GET /api/v1/admin/panel/identidades/inspectores — inspectores (Hito 11) con su
 * licencia, talleres autorizados y volumen de inspecciones, mas el catalogo de
 * talleres aprobados disponibles para asignar. Sin datos personales en claro.
 */
export async function GET(req: Request) {
  try {
    await requireAdminPanel(req, 'identidades:ver')
    const [inspectores, talleres] = await Promise.all([
      listarInspectores(),
      listarTalleresAprobados(),
    ])
    return NextResponse.json({ inspectores, talleres })
  } catch (error) {
    return jsonError(error)
  }
}

const invitarSchema = z.object({
  nombre: z.string({ required_error: 'El nombre es obligatorio.' }).trim().min(1).max(120),
  email: z.string({ required_error: 'El email es obligatorio.' }).trim().email('Email invalido.'),
})

/**
 * POST /api/v1/admin/panel/identidades/inspectores — invita a un inspector real
 * (personal de fuerzas de seguridad). Solo `roles:gestionar` (superadmin).
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireAdminPanel(req, 'roles:gestionar')
    const body = (await req.json().catch(() => {
      throw new ApiError(400, 'INVALID_BODY', 'El cuerpo debe ser JSON valido.')
    })) as Record<string, unknown>
    const parsed = invitarSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ApiError(400, 'VALIDATION_ERROR', issue?.message ?? 'Datos invalidos.')
    }
    const resultado = await invitarInspector(ctx, parsed.data)
    return NextResponse.json(resultado, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
