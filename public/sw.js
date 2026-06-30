/*
 * RODAID — Service Worker de notificaciones (Hito 10).
 *
 * Maneja la recepcion de mensajes de Web Push mientras la app esta en segundo
 * plano (o cerrada) y muestra la notificacion nativa. Al hacer click, enfoca una
 * pestania abierta de RODAID o abre la URL indicada por el evento.
 */

self.addEventListener('install', () => {
  // Activa esta version sin esperar a que se cierren las pestanias viejas.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (_) {
    payload = { title: 'RODAID', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'RODAID'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || 'rodaid',
    data: { url: payload.url || '/garaje', evento: payload.evento || null },
    renotify: true,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/garaje'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus()
            if ('navigate' in client) {
              client.navigate(targetUrl).catch(() => {})
            }
            return
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
      })
  )
})
