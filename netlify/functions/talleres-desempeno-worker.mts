import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker diario de desempeño de Talleres Aliados (ver diseño en
 * CLAUDE.md). Recalcula el promedio de CITs/dia (30 dias) y sincroniza quien
 * puede publicar servicios en el footer, despublicando automaticamente a
 * quien haya caido por debajo del umbral.
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
      '[talleres-desempeno-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el ciclo.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/talleres/recalcular-desempeno`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[talleres-desempeno-worker] ciclo', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[talleres-desempeno-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  schedule: '0 9 * * *',
}
