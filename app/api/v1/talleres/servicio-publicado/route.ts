export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireRole } from '@/lib/marketplace'
import { resolverAliadoDeUsuario } from '@/src/services/inspeccion.service'
import {
  obtenerEstadoPublicacionTaller,
  publicarServicioTaller,
} from '@/src/services/talleres-desempeno.service'

/**
 * /api/v1/talleres/servicio-publicado — el propio Taller Aliado consulta y
 * publica su servicio. Fuera de /api/v1/admin/* a proposito: el rol `aliado`
 * no esta en STAFF_ROLES del borde (netlify/edge-functions/auth-admin.ts),
 * asi que un aliado real quedaria bloqueado con 403 si esto viviera ahi.
 * Mismo patron que /api/inspector/cit (requireRole en el origen, sin gate de
 * borde).
 */

async function resolverAliadoIdDelUsuario(usuarioId: string): Promise<string> {
  const aliado = await resolverAliadoDeUsuario(usuarioId)
  if (!aliado) {
    throw new ApiError(
      404,
      'ALIADO_NO_ENCONTRADO',
      'No encontramos un perfil de aliado aprobado vinculado a tu cuenta.'
    )
  }
  return aliado.id
}

export async function GET(req: Request) {
  try {
    const user = await requireRole('aliado', 'admin')(req)
    const aliadoId = await resolverAliadoIdDelUsuario(user.id)
    return NextResponse.json(await obtenerEstadoPublicacionTaller(aliadoId))
  } catch (error) {
    return jsonError(error)
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireRole('aliado', 'admin')(req)
    const aliadoId = await resolverAliadoIdDelUsuario(user.id)

    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      throw new ApiError(400, 'CONTENT_TYPE_INVALIDO', 'Envia el formulario como multipart/form-data.')
    }
    const form = await req.formData()
    const servicio = String(form.get('servicio') ?? '')
    const precioArs = Number(form.get('precio_ars'))
    const linkTiendaRaw = form.get('link_tienda')
    const linkTienda =
      typeof linkTiendaRaw === 'string' && linkTiendaRaw.trim() ? linkTiendaRaw.trim() : null
    const whatsappRaw = form.get('whatsapp_numero')
    const whatsappNumero =
      typeof whatsappRaw === 'string' && whatsappRaw.trim() ? whatsappRaw.trim() : null
    const logoEntry = form.get('logo')
    const logoFile = logoEntry instanceof File && logoEntry.size > 0 ? logoEntry : null

    await publicarServicioTaller({ aliadoId, servicio, precioArs, logoFile, linkTienda, whatsappNumero })
    return NextResponse.json(await obtenerEstadoPublicacionTaller(aliadoId))
  } catch (error) {
    return jsonError(error)
  }
}
