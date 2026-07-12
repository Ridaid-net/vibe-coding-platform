import { NextResponse } from 'next/server'
import { ApiError, getPool, jsonError, requireRole } from '@/lib/marketplace'
import { cargarInspectorContexto } from '@/src/services/inspeccion.service'

export const runtime = 'nodejs'

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/

interface Body {
  walletAddress?: unknown
}

/**
 * GET /api/v1/inspecciones/contexto — Contexto del inspector autenticado.
 * PUT /api/v1/inspecciones/contexto — Configura la wallet_address (identidad
 *     digital) del inspector, requisito para firmar aprobaciones.
 *
 * Restringido a inspector / aliado / admin.
 */
export async function GET(req: Request) {
  try {
    const user = await requireRole('inspector', 'aliado', 'admin')(req)
    const verComoAliado = new URL(req.url).searchParams.get('verComoAliado')
    const ctx = await cargarInspectorContexto(user.id, verComoAliado)
    return NextResponse.json(serializar(ctx))
  } catch (error) {
    return jsonError(error)
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireRole('inspector', 'aliado', 'admin')(req)
    const body = (await req.json().catch(() => ({}))) as Body
    const wallet =
      typeof body.walletAddress === 'string' ? body.walletAddress.trim() : ''
    if (!WALLET_RE.test(wallet)) {
      throw new ApiError(
        400,
        'WALLET_INVALIDA',
        'La wallet_address debe tener el formato 0x seguido de 40 caracteres hexadecimales.'
      )
    }

    await getPool().query(
      `UPDATE usuarios SET wallet_address = $2, updated_at = NOW() WHERE id = $1`,
      [user.id, wallet.toLowerCase()]
    )

    const ctx = await cargarInspectorContexto(user.id)
    return NextResponse.json(serializar(ctx))
  } catch (error) {
    return jsonError(error)
  }
}

function serializar(ctx: Awaited<ReturnType<typeof cargarInspectorContexto>>) {
  return {
    id: ctx.id,
    rol: ctx.rol,
    nombre: ctx.nombre,
    walletAddress: ctx.walletAddress,
    aliado: ctx.aliado,
    modoVista: ctx.modoVista,
  }
}
