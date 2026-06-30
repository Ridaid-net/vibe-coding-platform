import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker del Pipeline de Validacion de 72hs (Hito 5).
 *
 * Netlify Scheduled Function que corre cada minuto y dispara el barrido de la
 * cola de validaciones. Es el equivalente serverless al worker de Bull: en
 * lugar de un proceso vivo, una funcion programada invoca el endpoint del worker
 * (`POST /api/v1/admin/validaciones/procesar`), que procesa los jobs cuya
 * ventana de 72hs ya vencio.
 *
 * No procesa nada por si misma: delega en la ruta Next.js, que tiene acceso a la
 * base y a la logica de `validation.service.ts`. Requiere:
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
      '[validacion-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el barrido.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/validaciones/procesar`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[validacion-worker] barrido', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[validacion-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  // Cada minuto: la granularidad del barrido (el delay real lo fija `ejecutar_en`).
  schedule: '* * * * *',
}
