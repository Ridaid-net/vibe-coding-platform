'use client'
import { useEffect, useState } from 'react'

export default function AdminAccessPage() {
  const [status, setStatus] = useState('Iniciando sesion de administracion...')

  useEffect(() => {
    // Limpiar cualquier sesion anterior
    localStorage.removeItem('rodaid.session.v2')
    localStorage.removeItem('rodaid.admin.mfa.v1')
    
    fetch('/api/v1/auth/demo-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: 'admin' })
    })
    .then(r => r.json())
    .then(data => {
      if (data.accessToken) {
        localStorage.setItem('rodaid.session.v2', JSON.stringify({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? null,
          userId: data.userId,
          nombre: 'Federico De Gea',
          rol: 'admin'
        }))
        setStatus('Sesion iniciada. Redirigiendo...')
        setTimeout(() => {
          window.location.replace('/admin')
        }, 1000)
      } else {
        setStatus('Error: ' + JSON.stringify(data))
      }
    })
    .catch(e => setStatus('Error: ' + String(e)))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', gap: '1rem' }}>
      <p style={{ fontSize: '1.2rem', color: '#0F1E35' }}>{status}</p>
      <a href="/admin" style={{ color: '#2BBCB8', textDecoration: 'underline' }}>Ir al Admin manualmente</a>
    </div>
  )
}
