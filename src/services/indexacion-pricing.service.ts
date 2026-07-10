import { getPool, type DbClient } from '@/lib/marketplace'
import { enviarEmail } from '@/lib/email'
import {
  obtenerCotizacionParaIndexacion,
  obtenerCorroboracionBcra,
} from '@/src/services/cotizacion.service'

/**
 * RODAID — Indexacion automatica de precios CIT al dolar oficial BNA.
 *
 * Corre TODOS los dias (ver indexacion-precios-worker.mts), pero solo AJUSTA
 * precios cuando se cumplen las dos condiciones que definio Federico
 * (2026-07-10): >=90 dias desde el ultimo ajuste real Y >=1,2% de variacion
 * acumulada del dolar BNA venta desde ese ultimo ajuste. Fuera de eso, cada
 * corrida diaria solo lee la cotizacion, la compara contra la lectura del
 * dia anterior (umbral de anomalia del 8%) y contra el rango de cordura
 * ($800-$1.800, banda cambiaria oficial del BCRA), y deja registro en
 * parametros_pricing_ajustes_log -- sea cual sea el resultado.
 *
 * Ninguna transaccion en curso (escrow_transacciones) se ve afectada nunca:
 * cada venta ya congela sus propios montos al crearse (Fase 3/6).
 */

const UMBRAL_INDEXACION_PCT = 0.012
const DIAS_MINIMOS_ENTRE_AJUSTES = 90
const UMBRAL_ANOMALIA_DIARIA_PCT = 0.08
const COTIZACION_PISO = 800
const COTIZACION_TECHO = 1800

const EMAIL_ALERTA_DEFAULT = 'contactoarribaeleste@gmail.com'

function emailAlerta(): string {
  return process.env.RODAID_PRICING_ALERTA_EMAIL ?? EMAIL_ALERTA_DEFAULT
}

export type AccionIndexacion =
  | 'AJUSTADO'
  | 'SIN_CAMBIOS'
  | 'ABORTADO_ANOMALIA'
  | 'ABORTADO_FUENTE_CAIDA'

export interface ResultadoIndexacion {
  accion: AccionIndexacion
  detalle: Record<string, unknown>
}

async function withTx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function ultimaLecturaLoggeada(): Promise<number | null> {
  const res = await getPool().query<{ cotizacion_nueva: string }>(
    `SELECT cotizacion_nueva FROM parametros_pricing_ajustes_log
     ORDER BY ejecutado_en DESC LIMIT 1`
  )
  const row = res.rows[0]
  return row ? Number(row.cotizacion_nueva) : null
}

async function registrarCiclo(
  client: DbClient,
  input: {
    accion: AccionIndexacion
    cotizacionAnterior: number
    cotizacionNueva: number
    variacionPct: number
    detalle: Record<string, unknown>
  }
): Promise<void> {
  await client.query(
    `INSERT INTO parametros_pricing_ajustes_log
       (cotizacion_anterior, cotizacion_nueva, variacion_pct, umbral_pct, accion, detalle)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.cotizacionAnterior,
      input.cotizacionNueva,
      input.variacionPct,
      UMBRAL_INDEXACION_PCT,
      input.accion,
      JSON.stringify(input.detalle),
    ]
  )
}

/**
 * Notifica un ciclo abortado a la cuenta de alerta (Federico, por defecto).
 * Best-effort: nunca lanza -- un email que falla no debe hacer que el ciclo
 * de indexacion se caiga ni que el log de auditoria deje de escribirse.
 */
async function notificarAborto(
  accion: 'ABORTADO_ANOMALIA' | 'ABORTADO_FUENTE_CAIDA',
  detalle: Record<string, unknown>
): Promise<void> {
  try {
    await enviarEmail({
      to: emailAlerta(),
      subject: `RODAID — Indexación de precios abortada (${accion})`,
      html: `
        <p><strong>El ciclo diario de indexación de precios al dólar BNA se abortó sin tocar ningún precio.</strong></p>
        <p><strong>Motivo:</strong> ${accion}</p>
        <pre style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:13px;">${JSON.stringify(detalle, null, 2)}</pre>
        <p>Este email es solo informativo — ningún precio cambió. Revisá <code>parametros_pricing_ajustes_log</code> para el historial completo.</p>
      `,
    })
  } catch (err) {
    console.error('[indexacion-precios] no se pudo enviar el email de alerta', err)
  }
}

/**
 * Corre el ciclo diario. Nunca lanza -- cualquier fallo termina en un
 * resultado ABORTADO_*, nunca en una excepcion sin manejar (el worker que la
 * invoca no debe caerse por esto).
 */
export async function evaluarIndexacionPrecios(): Promise<ResultadoIndexacion> {
  const cotizacionAyer = await ultimaLecturaLoggeada()

  // 1. Fuente primaria. Si falla, abortar sin tocar nada.
  let cotizacionHoy: number
  try {
    const c = await obtenerCotizacionParaIndexacion()
    cotizacionHoy = c.venta
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err)
    console.error('[indexacion-precios] fuente primaria (dolarapi) fallo:', mensaje)
    const detalle = { error: mensaje }
    if (cotizacionAyer !== null) {
      await withTx((client) =>
        registrarCiclo(client, {
          accion: 'ABORTADO_FUENTE_CAIDA',
          cotizacionAnterior: cotizacionAyer,
          cotizacionNueva: cotizacionAyer,
          variacionPct: 0,
          detalle,
        })
      )
    }
    await notificarAborto('ABORTADO_FUENTE_CAIDA', detalle)
    return { accion: 'ABORTADO_FUENTE_CAIDA', detalle }
  }

  // 2. Corroboracion BCRA -- informativa, nunca bloquea (ver rezago confirmado).
  const bcra = await obtenerCorroboracionBcra()

  // 3. Rango de cordura absoluto.
  if (cotizacionHoy < COTIZACION_PISO || cotizacionHoy > COTIZACION_TECHO) {
    const detalle = {
      motivo: `cotizacion ${cotizacionHoy} fuera del rango de cordura [$${COTIZACION_PISO}, $${COTIZACION_TECHO}]`,
      bcra,
    }
    console.error('[indexacion-precios] cotizacion fuera de rango de cordura:', detalle)
    await withTx((client) =>
      registrarCiclo(client, {
        accion: 'ABORTADO_ANOMALIA',
        cotizacionAnterior: cotizacionAyer ?? cotizacionHoy,
        cotizacionNueva: cotizacionHoy,
        variacionPct: 0,
        detalle,
      })
    )
    await notificarAborto('ABORTADO_ANOMALIA', detalle)
    return { accion: 'ABORTADO_ANOMALIA', detalle }
  }

  // 4. Anomalia dia-a-dia contra la ultima lectura registrada (si existe).
  if (cotizacionAyer !== null) {
    const variacionDiaria = Math.abs(cotizacionHoy - cotizacionAyer) / cotizacionAyer
    if (variacionDiaria > UMBRAL_ANOMALIA_DIARIA_PCT) {
      const detalle = {
        motivo: `variacion diaria ${(variacionDiaria * 100).toFixed(2)}% supera el umbral de anomalia (${UMBRAL_ANOMALIA_DIARIA_PCT * 100}%)`,
        cotizacionAyer,
        cotizacionHoy,
        bcra,
      }
      console.error('[indexacion-precios] variacion diaria anomala:', detalle)
      await withTx((client) =>
        registrarCiclo(client, {
          accion: 'ABORTADO_ANOMALIA',
          cotizacionAnterior: cotizacionAyer,
          cotizacionNueva: cotizacionHoy,
          variacionPct: variacionDiaria,
          detalle,
        })
      )
      await notificarAborto('ABORTADO_ANOMALIA', detalle)
      return { accion: 'ABORTADO_ANOMALIA', detalle }
    }
  }

  // 5. Filas indexadas + su ancla compartida. Si desincronizaron, abortar en
  // vez de adivinar cual cotizacion_ancla es la correcta.
  const filas = await getPool().query<{
    clave: string
    valor: string
    usd_ancla: string
    cotizacion_ancla: string
    ultimo_ajuste_en: string | null
  }>(
    `SELECT clave, valor, usd_ancla, cotizacion_ancla, ultimo_ajuste_en
     FROM parametros_pricing_cit WHERE indexado = TRUE`
  )
  if (filas.rows.length === 0) {
    return { accion: 'SIN_CAMBIOS', detalle: { motivo: 'no hay parametros marcados indexado = TRUE' } }
  }
  const anclas = new Set(filas.rows.map((r: { cotizacion_ancla: string }) => r.cotizacion_ancla))
  if (anclas.size > 1) {
    const detalle = {
      motivo: 'las filas indexadas tienen cotizacion_ancla desincronizadas',
      anclas: [...anclas],
    }
    console.error('[indexacion-precios] anclas desincronizadas:', detalle)
    await withTx((client) =>
      registrarCiclo(client, {
        accion: 'ABORTADO_ANOMALIA',
        cotizacionAnterior: cotizacionAyer ?? cotizacionHoy,
        cotizacionNueva: cotizacionHoy,
        variacionPct: 0,
        detalle,
      })
    )
    await notificarAborto('ABORTADO_ANOMALIA', detalle)
    return { accion: 'ABORTADO_ANOMALIA', detalle }
  }

  const cotizacionAncla = Number(filas.rows[0].cotizacion_ancla)
  const ultimoAjuste = filas.rows[0].ultimo_ajuste_en ? new Date(filas.rows[0].ultimo_ajuste_en) : null
  const variacionAcumulada = Math.abs(cotizacionHoy - cotizacionAncla) / cotizacionAncla
  const diasDesdeUltimoAjuste = ultimoAjuste
    ? (Date.now() - ultimoAjuste.getTime()) / (1000 * 60 * 60 * 24)
    : Infinity // nunca se ajusto: no hay piso de dias que cumplir.

  const cumpleVentana = diasDesdeUltimoAjuste >= DIAS_MINIMOS_ENTRE_AJUSTES
  const cumpleUmbral = variacionAcumulada >= UMBRAL_INDEXACION_PCT

  if (!cumpleVentana || !cumpleUmbral) {
    const detalle = {
      cotizacionAncla,
      cotizacionHoy,
      variacionAcumulada,
      diasDesdeUltimoAjuste: Number.isFinite(diasDesdeUltimoAjuste) ? Math.floor(diasDesdeUltimoAjuste) : null,
      cumpleVentana,
      cumpleUmbral,
      bcra,
    }
    await withTx((client) =>
      registrarCiclo(client, {
        accion: 'SIN_CAMBIOS',
        cotizacionAnterior: cotizacionAncla,
        cotizacionNueva: cotizacionHoy,
        variacionPct: variacionAcumulada,
        detalle,
      })
    )
    return { accion: 'SIN_CAMBIOS', detalle }
  }

  // 6. Ajustar: ARS = usd_ancla * cotizacionHoy, exacto al peso (sin
  // redondeo adicional, confirmado por Federico). Todo en una transaccion.
  const cambios: { clave: string; valorAnterior: number; valorNuevo: number; usdAncla: number }[] = []
  await withTx(async (client) => {
    for (const fila of filas.rows) {
      const usdAncla = Number(fila.usd_ancla)
      const valorAnterior = Number(fila.valor)
      const valorNuevo = Math.round(usdAncla * cotizacionHoy)
      cambios.push({ clave: fila.clave, valorAnterior, valorNuevo, usdAncla })
      await client.query(
        `UPDATE parametros_pricing_cit
         SET valor = $2, cotizacion_ancla = $3, ultimo_ajuste_en = NOW()
         WHERE clave = $1`,
        [fila.clave, valorNuevo, cotizacionHoy]
      )
    }
    await registrarCiclo(client, {
      accion: 'AJUSTADO',
      cotizacionAnterior: cotizacionAncla,
      cotizacionNueva: cotizacionHoy,
      variacionPct: variacionAcumulada,
      detalle: { cambios, bcra },
    })
  })

  console.info('[indexacion-precios] precios ajustados', JSON.stringify({ cotizacionAncla, cotizacionHoy, cambios }))
  return {
    accion: 'AJUSTADO',
    detalle: { cotizacionAncla, cotizacionHoy, variacionAcumulada, cambios, bcra },
  }
}
