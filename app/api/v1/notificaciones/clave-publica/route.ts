import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/marketplace'
import { getVapidPublicKey } from '@/src/services/notification.service'

export const runtime = 'nodejs'

/**
 * GET /api/v1/notificaciones/clave-publica
 *
 * Devuelve la clave publica VAPID (applicationServerKey) que el navegador
 * necesita para suscribirse a Web Push. Es publica por definicion; no expone
 * ningun secreto.
 */
export async function GET() {
  try {
    return NextResponse.json({ vapidPublicKey: getVapidPublicKey() })
  } catch (error) {
    return jsonError(error)
  }
}
