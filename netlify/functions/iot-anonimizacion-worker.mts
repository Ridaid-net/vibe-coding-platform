import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker de Anonimizacion de Telemetria IoT (Hito 17).
 *
 * Netlify Scheduled Function que dispara periodicamente el barrido de
 * anonimizacion de la traza historica de telemetria: a los 30 dias se borra la
 * posicion PRECISA cifrada y queda solo el geo recortado a barrio, exactamente
 * como el mapa de calor (Hito 14). No procesa por si misma: invoca el endpoint de
 * sistema `POST /api/v1/admin/iot/anonimizar`, que tiene acceso a la base.
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
      '[iot-anonimizacion-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el barrido.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/iot/anonimizar`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[iot-anonimizacion-worker] barrido', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[iot-anonimizacion-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  // Una vez por dia (03:17): la retencion es de 30 dias, no necesita mas frecuencia.
  schedule: '17 3 * * *',
}
