/**
 * RODAID · Registro de token FCM para push notifications Android
 * POST /api/v1/auth/fcm-token
 */
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getPool, requireUser } from '@/lib/marketplace'

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const { fcmToken } = await req.json()

    if (!fcmToken || typeof fcmToken !== 'string') {
      return NextResponse.json({ error: 'fcmToken es obligatorio.' }, { status: 400 })
    }

    const pool = getPool()
    await pool.query(
      `UPDATE usuarios 
       SET fcm_token = $1, fcm_token_updated_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [fcmToken, user.id]
    )

    return NextResponse.json({ ok: true, mensaje: 'Token FCM registrado correctamente.' })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req)
    const pool = getPool()
    await pool.query(
      'UPDATE usuarios SET fcm_token = NULL, fcm_token_updated_at = NULL, updated_at = NOW() WHERE id = $1',
      [user.id]
    )
    return NextResponse.json({ ok: true, mensaje: 'Token FCM eliminado.' })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
