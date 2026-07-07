'use client'
import { useState, useEffect } from 'react'
import { Bell, BellOff, CheckCircle } from 'lucide-react'
import { authedFetch } from '@/lib/session'

export function PushNotificaciones() {
  const [estado, setEstado] = useState<'idle' | 'activando' | 'activo' | 'error' | 'noSoportado'>('idle')

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setEstado('noSoportado')
      return
    }
    if (Notification.permission === 'granted') setEstado('activo')
  }, [])

  const activarNotificaciones = async () => {
    if (!('Notification' in window)) return
    setEstado('activando')
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') { setEstado('idle'); return }

      // En producción con service worker, obtener el token FCM real
      // Por ahora registramos un token de prueba
      const tokenDemo = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`
      
      const res = await authedFetch('/api/v1/auth/fcm-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fcmToken: tokenDemo })
      })

      if (res.ok) {
        setEstado('activo')
      } else {
        setEstado('error')
      }
    } catch {
      setEstado('error')
    }
  }

  const desactivar = async () => {
    try {
      await authedFetch('/api/v1/auth/fcm-token', { method: 'DELETE' })
      setEstado('idle')
    } catch { /* silencioso */ }
  }

  if (estado === 'noSoportado') return null

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 mt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex size-10 items-center justify-center rounded-xl ${estado === 'activo' ? 'bg-green-100' : 'bg-slate-100'}`}>
            {estado === 'activo'
              ? <Bell className="size-5 text-green-600" />
              : <BellOff className="size-5 text-slate-400" />
            }
          </div>
          <div>
            <p className="text-sm font-semibold text-[#0F1E35]">Notificaciones RODAID</p>
            <p className="text-xs text-slate-warm">
              {estado === 'activo' ? 'Activadas — te avisamos si tu bici es denunciada' : 'Recibí alertas de tu bicicleta en tiempo real'}
            </p>
          </div>
        </div>
        {estado === 'activo' ? (
          <div className="flex items-center gap-2">
            <CheckCircle className="size-4 text-green-500" />
            <button type="button" onClick={desactivar}
              className="text-xs text-slate-warm hover:text-red-500 underline">
              Desactivar
            </button>
          </div>
        ) : (
          <button type="button" onClick={activarNotificaciones} disabled={estado === 'activando'}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1E35] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0F1E35]/80 disabled:opacity-50">
            <Bell className="size-3.5" />
            {estado === 'activando' ? 'Activando...' : 'Activar'}
          </button>
        )}
      </div>
    </div>
  )
}
