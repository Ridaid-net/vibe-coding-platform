import { NextResponse } from 'next/server'
import { ApiError, jsonError, requireUser } from '@/lib/marketplace'
import { guardarSuscripcion } from '@/src/services/notification.service'

export const runtime = 'nodejs'

interface SuscribirBody {
  // Acepta tanto el objeto PushSubscription serializado (con `keys`) como el
  // formato plano (endpoint + p256dh + auth).
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
  p256dh?: unknown
  auth?: unknown
  subscription?: {
    endpoint?: unknown
    keys?: { p256dh?: unknown; auth?: unknown }
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * POST /api/v1/notificaciones/suscribir
 *
 * Registra (opt-in) la suscripcion de Web Push del navegador del usuario
 * autenticado. Idempotente por endpoint: re-suscribir el mismo navegador
 * actualiza las claves en lugar de duplicar.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as SuscribirBody
    const sub = body.subscription ?? body

    const endpoint = str(sub.endpoint)
    const p256dh = str(sub.keys?.p256dh ?? (body as SuscribirBody).p256dh)
    const auth = str(sub.keys?.auth ?? (body as SuscribirBody).auth)

    if (!endpoint || !p256dh || !auth) {
      throw new ApiError(
        400,
        'SUSCRIPCION_INVALIDA',
        'Faltan datos de la suscripción (endpoint, p256dh, auth).'
      )
    }

    await guardarSuscripcion(user.id, {
      endpoint,
      p256dh,
      auth,
      userAgent: req.headers.get('user-agent'),
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
