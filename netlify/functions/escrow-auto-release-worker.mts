import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker de Auto-Release del Escrow (Hito 13).
 *
 * Netlify Scheduled Function que corre cada hora y dispara el barrido de
 * `procesarAutoReleases()`: libera automaticamente las transacciones EN_CAMINO
 * cuyo plazo de confirmacion del comprador vencio (5 dias sin accion).
 *
 * El endpoint (`POST /api/v1/admin/escrow/auto-release`) y la logica
 * (`escrow.service.ts`) ya existian, pero no tenian ninguna funcion programada
 * que los invocara — este archivo cierra ese gap.
 *
 * A diferencia de `validacion-worker.mts` (que corre cada minuto porque el
 * "acelerador" de `aprobarInspeccionFisica` pone `ejecutar_en = NOW()` y
 * necesita reaccionar rapido tras una aprobacion manual), `auto_release_en`
 * es un timer fijo de 5 dias sin ningun evento que lo acorte — sondear cada
 * minuto no gana nada. Una hora de margen sobre un plazo de dias es
 * irrelevante en la practica.
 *
 * Requiere:
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
      '[escrow-auto-release-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el barrido.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/escrow/auto-release`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[escrow-auto-release-worker] barrido', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[escrow-auto-release-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  // Cada hora, en punto: el delay real lo fija `auto_release_en` (dias).
  schedule: '0 * * * *',
}
