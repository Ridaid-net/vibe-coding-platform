import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker de recordatorios del Remito de Embalaje y Despacho (Fase 6b).
 *
 * Netlify Scheduled Function que corre cada 30 minutos y dispara el barrido
 * de `procesarRecordatoriosRemito()`: recuerda al VENDEDOR (nunca al Taller)
 * que todavia no genero el Remito de una venta de CIT Completo con el saldo
 * ya confirmado. Dos relojes independientes por transaccion (in-app cada
 * 2hs, email cada 8hs) -- 30 minutos alcanza para cumplir la ventana de 2hs
 * del in-app sin sondear con la misma urgencia que los workers de BFA/
 * Ministerio (cada 5 minutos). Igual que el resto: no procesa nada por si
 * misma, delega en la ruta Next.js. Requiere URL del sitio y
 * `RODAID_ADMIN_TOKEN`. Si falta alguno, no-opera.
 */
export default async () => {
  const base =
    process.env.URL ??
    process.env.DEPLOY_PRIME_URL ??
    process.env.RODAID_BASE_URL
  const token = process.env.RODAID_ADMIN_TOKEN

  if (!base || !token) {
    console.warn(
      '[remito-recordatorio-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el barrido.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/remitos/recordatorios-pendientes`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[remito-recordatorio-worker] barrido', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[remito-recordatorio-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  // Cada 30 minutos: suficiente para la ventana de 2hs del in-app.
  schedule: '*/30 * * * *',
}
