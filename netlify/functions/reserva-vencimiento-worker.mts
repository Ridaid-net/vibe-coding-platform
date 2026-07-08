import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker del Timeout de 48hs de la Reserva (Fase 5, CIT Completo).
 *
 * Netlify Scheduled Function que corre cada hora y dispara el barrido de
 * `procesarReservasVencidas()`: revierte a PUBLICADO_CERTIFICADO o
 * PUBLICADO_PENDIENTE_CERTIFICACION las publicaciones cuya reserva vencio sin
 * que el comprador confirmara el pago.
 *
 * Igual que `escrow-auto-release-worker.mts`: el timer (`reserva_vence_en`) es
 * de horas, sin ningun acelerador que lo adelante, asi que no hace falta
 * sondear cada minuto como `validacion-worker.mts`. No procesa nada por si
 * misma, delega en la ruta Next.js. Requiere:
 *   - URL del sitio (`URL` / `DEPLOY_PRIME_URL` / `RODAID_BASE_URL`)
 *   - `RODAID_ADMIN_TOKEN` (autentica la invocacion del worker)
 * Si falta alguno, no-opera (deja un aviso en los logs) en vez de fallar.
 *
 * Nota: hasta que existan los endpoints de reserva (Fase 6), esta funcion
 * corre pero no encuentra nada que procesar (reserva_vence_en nunca se
 * puebla todavia).
 */
export default async () => {
  const base =
    process.env.URL ??
    process.env.DEPLOY_PRIME_URL ??
    process.env.RODAID_BASE_URL
  const token = process.env.RODAID_ADMIN_TOKEN

  if (!base || !token) {
    console.warn(
      '[reserva-vencimiento-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el barrido.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/escrow/reservas-vencidas`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[reserva-vencimiento-worker] barrido', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[reserva-vencimiento-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  // Cada hora, en punto: el delay real lo fija `reserva_vence_en`.
  schedule: '0 * * * *',
}
