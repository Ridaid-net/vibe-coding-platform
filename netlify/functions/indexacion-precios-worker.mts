import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker diario del mecanismo de indexacion de precios al dolar
 * oficial BNA (ver diseno completo en CLAUDE.md).
 *
 * Corre todos los dias y delega en
 * POST /api/v1/admin/pricing/evaluar-indexacion, que decide -- segun los
 * datos, no segun el cron -- si corresponde ajustar algun precio (>=90 dias
 * desde el ultimo ajuste real Y >=1,2% de variacion acumulada) o si solo
 * registra la lectura del dia para el chequeo de anomalia dia-a-dia.
 *
 * Requiere URL base (`URL`/`DEPLOY_PRIME_URL`/`RODAID_BASE_URL`) y
 * `RODAID_ADMIN_TOKEN`. Si falta alguno, no-opera (aviso en logs).
 */
export default async () => {
  const base =
    process.env.URL ??
    process.env.DEPLOY_PRIME_URL ??
    process.env.RODAID_BASE_URL
  const token = process.env.RODAID_ADMIN_TOKEN

  if (!base || !token) {
    console.warn(
      '[indexacion-precios-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el ciclo.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/pricing/evaluar-indexacion`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[indexacion-precios-worker] ciclo', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[indexacion-precios-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  schedule: '0 8 * * *',
}
