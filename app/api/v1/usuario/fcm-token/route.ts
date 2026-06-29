import { NextResponse } from 'next/server'
import { jsonError, parseText, requireUser } from '@/lib/marketplace'
import { registrarFcmToken } from '@/src/services/notif.service'

export const runtime = 'nodejs'

interface FcmBody {
  token?: unknown
  fcmToken?: unknown
}

/**
 * POST /api/v1/usuario/fcm-token — registra el token de Firebase Cloud Messaging del
 * dispositivo del usuario autenticado para habilitar las notificaciones push. El token
 * se agrega sin duplicar a las preferencias del usuario.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as FcmBody
    const token = parseText(body.token ?? body.fcmToken, 'token', 4096)
    const preferencias = await registrarFcmToken(user.id, token)
    return NextResponse.json({ preferencias })
  } catch (error) {
    return jsonError(error)
  }
}
