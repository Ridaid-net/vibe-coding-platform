import { NextResponse } from 'next/server'
import { getPool } from '@/lib/marketplace'
import { verifyPassword, hashPassword } from '@/lib/auth'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const { email, passwordActual, passwordNuevo } = await req.json()
    const pool = getPool()
    const res = await pool.query('SELECT id, password_hash FROM usuarios WHERE lower(email) = lower($1)', [email])
    const row = res.rows[0]
    if (!row) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    const ok = await verifyPassword(passwordActual, row.password_hash)
    if (!ok) return NextResponse.json({ error: 'Contraseña actual incorrecta' }, { status: 401 })
    const nuevoHash = await hashPassword(passwordNuevo)
    await pool.query('UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2', [nuevoHash, row.id])
    return NextResponse.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
