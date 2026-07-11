import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker de reintento de notificacion al Ministerio de Seguridad.
 *
 * Netlify Scheduled Function que reintenta periodicamente la notificacion de
 * DENUNCIA JUDICIAL ACTIVA al Ministerio cuando el aviso inicial fallo o se
 * colgo. Igual que el worker de anclaje BFA, no procesa por si misma: invoca
 * el endpoint de sistema `POST /api/v1/admin/ministerio/notificar-pendientes`,
 * que tiene acceso a la base y a la logica de denuncia-mpf.service.ts.
 *
 * Requiere URL del sitio y `RODAID_ADMIN_TOKEN`. Si falta alguno, no-opera.
 */
export default async () => {
  const base =
    process.env.URL ??
    process.env.DEPLOY_PRIME_URL ??
    process.env.RODAID_BASE_URL
  const token = process.env.RODAID_ADMIN_TOKEN

  if (!base || !token) {
    console.warn(
      '[ministerio-notificacion-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el barrido.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/ministerio/notificar-pendientes`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[ministerio-notificacion-worker] barrido', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[ministerio-notificacion-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  // Cada 5 minutos, misma cadencia que bfa-anclaje-worker.mts.
  schedule: '*/5 * * * *',
}
