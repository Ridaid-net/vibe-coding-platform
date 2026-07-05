import { NextResponse } from 'next/server'

export async function GET() {
  const loginRes = await fetch('https://rodaid.net/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'federico2@rodaid.net', password: 'Rodaid2026' })
  })
  const data = await loginRes.json()
  
  if (!data.accessToken) {
    return NextResponse.json({ error: 'Login failed', data }, { status: 401 })
  }

  const res = NextResponse.redirect(new URL('/admin', 'https://rodaid.net'))
  res.cookies.set('nf_jwt', data.accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 86400,
    path: '/',
  })
  return res
}
