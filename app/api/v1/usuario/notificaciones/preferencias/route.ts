import { NextResponse } from 'next/server'
import { jsonError, optionalText, requireUser } from '@/lib/marketplace'
import {
  actualizarPreferencias,
  obtenerPreferencias,
} from '@/src/services/notif.service'

export const runtime = 'nodejs'

/**
 * GET  /api/v1/usuario/notificaciones/preferencias — preferencias de notificacion del
 *      usuario autenticado (se crean por defecto si no existen).
 * PUT  /api/v1/usuario/notificaciones/preferencias — actualiza el on/off de cada canal
 *      (in-app, email, push) y la direccion de email de contacto.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const preferencias = await obtenerPreferencias(user.id)
    return NextResponse.json({ preferencias })
  } catch (error) {
    return jsonError(error)
  }
}

interface PreferenciasBody {
  inAppHabilitado?: unknown
  emailHabilitado?: unknown
  pushHabilitado?: unknown
  email?: unknown
}

function parseBoolOpcional(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined
  return value === true || value === 'true' || value === 1 || value === '1'
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as PreferenciasBody
    const preferencias = await actualizarPreferencias(user.id, {
      inAppHabilitado: parseBoolOpcional(body.inAppHabilitado),
      emailHabilitado: parseBoolOpcional(body.emailHabilitado),
      pushHabilitado: parseBoolOpcional(body.pushHabilitado),
      email: optionalText(body.email),
    })
    return NextResponse.json({ preferencias })
  } catch (error) {
    return jsonError(error)
  }
}
