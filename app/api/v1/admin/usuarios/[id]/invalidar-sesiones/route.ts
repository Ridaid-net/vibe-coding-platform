import { NextResponse } from 'next/server'
import { jsonError, optionalText, requireStaff } from '@/lib/marketplace'
import { invalidarSesionesUsuario } from '@/lib/auth'

export const runtime = 'nodejs'

interface Body {
  motivo?: unknown
}

/**
 * POST /api/v1/admin/usuarios/[id]/invalidar-sesiones — robo de dispositivo.
 *
 * Invalida de inmediato TODAS las sesiones del usuario: setea el watermark
 * `sesion_invalidada_desde` (mata cualquier AccessToken ya emitido, en hasta
 * 30s por el cache de requireAuth) y revoca todos sus RefreshToken vivos (no
 * puede sacar un AccessToken nuevo). Pensado para que un admin lo dispare
 * apenas se reporta un dispositivo robado, sin depender de que el propio
 * usuario (que ya no tiene el telefono) haga nada.
 *
 * Restringido a rol admin (via panel humano) o al token de sistema.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const actor = await requireStaff(req, 'admin')
    const body = (await req.json().catch(() => ({}))) as Body
    const motivoBody = optionalText(body.motivo)

    // El token de sistema (x-admin-token) no tiene un usuario real detras:
    // requireAdmin() devuelve el sentinel { id: 'admin' }, no un UUID. Se
    // guarda NULL en sesion_invalidada_por, pero se deja constancia
    // automatica en el motivo para no perder ese contexto.
    const esTokenSistema = actor.id === 'admin'
    const invalidadoPor = esTokenSistema ? null : actor.id
    const motivo = esTokenSistema
      ? `(via token de sistema)${motivoBody ? ` ${motivoBody}` : ''}`
      : motivoBody

    await invalidarSesionesUsuario({
      usuarioId: id,
      invalidadoPor,
      motivo,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
