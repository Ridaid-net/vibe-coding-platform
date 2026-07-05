'use client'
import { useEffect } from 'react'

export default function AdminAccessPage() {
  useEffect(() => {
    async function initAdminSession() {
      try {
        const res = await fetch('/api/v1/auth/demo-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rol: 'admin' })
        })
        const data = await res.json()
        if (data.accessToken) {
          localStorage.setItem('rodaid.session.v2', JSON.stringify({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken ?? null,
            userId: data.userId,
            nombre: 'Federico De Gea',
            rol: 'admin'
          }))
          window.location.href = '/admin'
        }
      } catch (e) {
        document.body.innerHTML = 'Error: ' + String(e)
      }
    }
    initAdminSession()
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <p>Iniciando sesión de administración...</p>
    </div>
  )
}
