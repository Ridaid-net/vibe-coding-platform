'use client'

/**
 * RODAID — Hito 10: cliente de notificaciones push (opt-in).
 *
 * Encapsula el flujo del navegador para activar/desactivar Web Push:
 *   1. registra el service worker (`/sw.js`),
 *   2. pide permiso explicito al usuario (opt-in),
 *   3. se suscribe contra la clave publica VAPID del backend,
 *   4. envia la suscripcion a `/api/v1/notificaciones/suscribir`.
 *
 * Todo es best-effort y degrada con gracia en navegadores sin soporte.
 */

import { authedFetch } from '@/lib/session'

export type EstadoNotificaciones =
  | 'no-soportado'
  | 'denegado'
  | 'activadas'
  | 'desactivadas'

/** `true` si el navegador soporta Service Workers + Push + Notifications. */
export function notificacionesSoportadas(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

async function registrarSW(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/sw.js')
  if (existing) {
    await navigator.serviceWorker.ready
    return existing
  }
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  return reg
}

/** Devuelve el estado actual sin pedir permisos ni suscribir. */
export async function estadoNotificaciones(): Promise<EstadoNotificaciones> {
  if (!notificacionesSoportadas()) return 'no-soportado'
  if (Notification.permission === 'denied') return 'denegado'
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    return sub ? 'activadas' : 'desactivadas'
  } catch {
    return 'desactivadas'
  }
}

/**
 * Activa las notificaciones: registra el SW, pide permiso y suscribe el
 * navegador. Devuelve el estado resultante. Lanza si el backend rechaza el alta.
 */
export async function activarNotificaciones(): Promise<EstadoNotificaciones> {
  if (!notificacionesSoportadas()) return 'no-soportado'

  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') {
    return permiso === 'denied' ? 'denegado' : 'desactivadas'
  }

  const reg = await registrarSW()

  // Clave publica VAPID (applicationServerKey).
  const res = await fetch('/api/v1/notificaciones/clave-publica')
  if (!res.ok) throw new Error('No se pudo obtener la clave de notificaciones.')
  const { vapidPublicKey } = (await res.json()) as { vapidPublicKey: string }

  // Reutiliza la suscripcion existente o crea una nueva.
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    })
  }

  const json = sub.toJSON() as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }

  const guardar = await authedFetch('/api/v1/notificaciones/suscribir', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  })
  if (!guardar.ok) {
    throw new Error('No se pudo registrar la suscripción.')
  }

  return 'activadas'
}

/** Desactiva las notificaciones: da de baja la suscripcion local y en el backend. */
export async function desactivarNotificaciones(): Promise<EstadoNotificaciones> {
  if (!notificacionesSoportadas()) return 'no-soportado'
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      const endpoint = sub.endpoint
      await sub.unsubscribe().catch(() => undefined)
      await authedFetch('/api/v1/notificaciones/desuscribir', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }).catch(() => undefined)
    }
  } catch {
    // best-effort
  }
  return 'desactivadas'
}
