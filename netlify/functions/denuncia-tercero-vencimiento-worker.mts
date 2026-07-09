import type { Config } from '@netlify/functions'

/**
 * RODAID — Worker del Timeout de 3hs de la Denuncia de Terceros (Fase 7,
 * caso 3: tercero denuncia una bici ajena que sospecha robada).
 *
 * Netlify Scheduled Function que corre cada hora y dispara el barrido de
 * `procesarVencimientosDenunciaTercero()`: avanza (o resuelve por defecto a
 * favor del denunciante) las denuncias cuya ventana de confirmacion de la
 * Policia o del propietario vencio sin respuesta.
 *
 * Calco exacto de `reserva-vencimiento-worker.mts`: el timer (3hs) es corto
 * en comparacion, pero no hace falta sondear cada minuto -- una hora de
 * margen sobre un plazo de horas es aceptable en la practica. Requiere:
 *   - URL del sitio (`URL` / `DEPLOY_PRIME_URL` / `RODAID_BASE_URL`)
 *   - `RODAID_ADMIN_TOKEN` (autentica la invocacion del worker)
 * Si falta alguno, no-opera (deja un aviso en los logs) en vez de fallar.
 *
 * Nota: mientras `iniciarDenunciaTercero()` siga deshabilitado (ver el TODO
 * fechado en `denuncia-tercero.service.ts`), esta funcion corre pero no
 * encuentra nada que procesar -- ninguna fila de `denuncias_terceros` puede
 * existir todavia.
 */
export default async () => {
  const base =
    process.env.URL ??
    process.env.DEPLOY_PRIME_URL ??
    process.env.RODAID_BASE_URL
  const token = process.env.RODAID_ADMIN_TOKEN

  if (!base || !token) {
    console.warn(
      '[denuncia-tercero-vencimiento-worker] falta URL base o RODAID_ADMIN_TOKEN; se omite el barrido.'
    )
    return
  }

  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/v1/admin/denuncias-terceros/procesar-vencimientos`,
      { method: 'POST', headers: { 'x-admin-token': token } }
    )
    const cuerpo = await res.json().catch(() => ({}))
    console.info('[denuncia-tercero-vencimiento-worker] barrido', res.status, JSON.stringify(cuerpo))
  } catch (error) {
    console.error('[denuncia-tercero-vencimiento-worker] error al invocar el worker', error)
  }
}

export const config: Config = {
  // Cada hora, en punto: el delay real lo fijan policia_vence_en/propietario_vence_en.
  schedule: '0 * * * *',
}
