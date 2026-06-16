import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker de reintento de Anclaje en la BFA (Hito 4).
 *
 * Netlify Scheduled Function que reintenta periódicamente el anclaje on-chain de
 * los CITs aprobados cuyo minteo quedó pendiente (la red BFA estaba caída o con
 * latencia al momento de aprobar). Igual que el worker de validación, no procesa
 * por sí misma: invoca el endpoint de sistema
 * `POST /api/v1/admin/blockchain/anclar`, que tiene acceso a la base y a ethers.
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
      '[bfa-anclaje-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el barrido.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/blockchain/anclar`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[bfa-anclaje-worker] barrido', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[bfa-anclaje-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  // Cada 5 minutos: reintenta anclajes pendientes sin saturar el nodo RPC.
  schedule: '*/5 * * * *',
}
