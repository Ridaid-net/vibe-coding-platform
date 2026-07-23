import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker del vencimiento de Reclamos de Titularidad (Esquema 3).
 *
 * Netlify Scheduled Function que corre cada 30 minutos y dispara
 * `procesarReclamosVencidos()`: para cada reclamo ESPERANDO_DUENO cuyo plazo
 * de 48hs ya venció sin respuesta, corre el cruce contra la base de robadas
 * del Ministerio (clasificarNivelCIT(), mismo mecanismo que CIT Express) y
 * pasa el caso a EN_REVISION_HUMANA -- el nivel AMARILLO/ROJO queda como
 * contexto para el admin, nunca decide solo.
 *
 * Mismo patrón que prestamo-vencimiento-worker.mts/reserva-vencimiento-worker.mts:
 * no procesa nada por si mismo, delega en la ruta Next.js. Requiere:
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
      '[reclamo-titularidad-vencimiento-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el barrido.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/reclamos-titularidad/procesar-vencidos`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[reclamo-titularidad-vencimiento-worker] barrido', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[reclamo-titularidad-vencimiento-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  // Cada 30 minutos.
  schedule: '*/30 * * * *',
}
