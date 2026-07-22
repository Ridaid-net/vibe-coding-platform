import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker del vencimiento de Préstamos de Bici (gratuitos, stock
 * propio del Taller Aliado).
 *
 * Netlify Scheduled Function que corre cada 30 minutos y dispara
 * `procesarPrestamosVencidos()`: para cada préstamo vencido crea una alerta
 * SOLO interna (iot_alertas, visible en el panel del taller) -- nunca Modo
 * Robo, nunca notifica a RODAID o autoridades. Deliberadamente periódico y
 * no un chequeo al cargar el panel (decisión de Federico): deja la puerta
 * abierta a sumar push/email más adelante sin rehacer esto.
 *
 * Mismo patrón que reserva-vencimiento-worker.mts: no procesa nada por si
 * mismo, delega en la ruta Next.js. Requiere:
 *   - URL del sitio (`URL` / `DEPLOY_PRIME_URL` / `RODAID_BASE_URL`)
 *   - `RODAID_ADMIN_TOKEN` (autentica la invocacion del worker)
 * Si falta alguno, no-opera (deja un aviso en los logs) en vez de fallar.
 */
export default async () => {
  const base =
    process.env.URL ??
    process.env.DEPLOY_PRIME_URL ??
    process.env.RODAID_BASE_URL
  const token = process.env.RODAID_ADMIN_TOKEN

  if (!base || !token) {
    console.warn(
      '[prestamo-vencimiento-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el barrido.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/prestamos/procesar-vencidos`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[prestamo-vencimiento-worker] barrido', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[prestamo-vencimiento-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  // Cada 30 minutos.
  schedule: '*/30 * * * *',
}
