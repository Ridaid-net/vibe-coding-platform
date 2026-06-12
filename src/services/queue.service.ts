// ─── RODAID · Servicio de Cola de Trabajos · Netlify Database ──────────────
//
// Equivalente Netlify-nativo del queue.service del backend de referencia
// (Bull + Redis). En lugar de Redis, la cola vive en Postgres (tabla
// `trabajos`) y conserva el mismo ciclo de vida de Bull:
//
//   waiting   — encolado, listo para ejecutarse
//   delayed   — programado para mas adelante (o esperando un reintento)
//   active    — reclamado por el procesador, en ejecucion
//   completed — finalizado con exito
//   failed    — agoto los reintentos
//
// Colas:
//   notif          — notificaciones de eventos del escrow (compra, envio, etc.)
//   escrow-release — auto-release de fondos retenidos a los 5 dias
//   cit-expirar    — expiracion diaria de CITs vencidos
//
// La administracion (estado por cola y limpieza de fallidos) se expone en
// /api/v1/admin/queue/*.

import { getPool } from '@/lib/marketplace'

export const COLAS = ['notif', 'escrow-release', 'cit-expirar'] as const
export type Cola = (typeof COLAS)[number]

export type EstadoTrabajo =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'

export function esColaValida(value: string): value is Cola {
  return (COLAS as readonly string[]).includes(value)
}

interface TrabajoRow {
  id: string
  cola: string
  estado: EstadoTrabajo
  payload: Record<string, unknown>
  intentos: number
  max_intentos: number
}

interface EncolarOpciones {
  /** Momento a partir del cual el trabajo puede ejecutarse (lo deja en `delayed`). */
  disponibleEn?: Date
  /** Reintentos antes de marcarlo `failed`. Por defecto 3. */
  maxIntentos?: number
}

/** Encola un trabajo. Devuelve el id generado. */
export async function encolarTrabajo(
  cola: Cola,
  payload: Record<string, unknown> = {},
  opciones: EncolarOpciones = {}
): Promise<string> {
  const disponibleEn = opciones.disponibleEn ?? new Date()
  const estado: EstadoTrabajo =
    disponibleEn.getTime() > Date.now() ? 'delayed' : 'waiting'

  const res = await getPool().query<{ id: string }>(
    `
      INSERT INTO trabajos (cola, estado, payload, max_intentos, disponible_en)
      VALUES ($1, $2, $3::jsonb, $4, $5)
      RETURNING id
    `,
    [cola, estado, JSON.stringify(payload), opciones.maxIntentos ?? 3, disponibleEn]
  )
  return res.rows[0].id
}

/**
 * Encola sin propagar errores. Pensado para los productores del escrow: una
 * notificacion que no se pudo encolar nunca debe romper el flujo de pago.
 */
export async function encolarSeguro(
  cola: Cola,
  payload: Record<string, unknown> = {},
  opciones: EncolarOpciones = {}
): Promise<void> {
  try {
    await encolarTrabajo(cola, payload, opciones)
  } catch (error) {
    console.error('[queue] no se pudo encolar', cola, error)
  }
}

/**
 * Encola un trabajo solo si no hay ya uno pendiente para esa cola. Evita
 * duplicar los barridos de mantenimiento (p. ej. `cit-expirar`) cada vez que
 * corre el procesador.
 */
async function encolarSiAusente(
  cola: Cola,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const res = await getPool().query<{ existe: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM trabajos
        WHERE cola = $1 AND estado IN ('waiting', 'delayed', 'active')
      ) AS existe
    `,
    [cola]
  )
  if (!res.rows[0]?.existe) {
    await encolarTrabajo(cola, payload)
  }
}

export interface ColaStats {
  name: string
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

/** Conteos por cola y estado (waiting/active/completed/failed/delayed). */
export async function queueStats(): Promise<{
  status: 'operativa'
  queues: ColaStats[]
}> {
  const res = await getPool().query<{
    cola: string
    estado: EstadoTrabajo
    n: number
  }>(
    `SELECT cola, estado, COUNT(*)::int AS n FROM trabajos GROUP BY cola, estado`
  )

  const base = (name: string): ColaStats => ({
    name,
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
  })

  const mapa = new Map<string, ColaStats>()
  for (const cola of COLAS) {
    mapa.set(cola, base(cola))
  }
  for (const row of res.rows) {
    const stats = mapa.get(row.cola) ?? base(row.cola)
    const estado = row.estado as EstadoTrabajo
    ;(stats as Record<EstadoTrabajo, number>)[estado] = row.n
    mapa.set(row.cola, stats)
  }

  return { status: 'operativa', queues: [...mapa.values()] }
}

/** Elimina los trabajos fallidos de una cola. Devuelve cuantos se borraron. */
export async function limpiarFallidos(cola: Cola): Promise<number> {
  const res = await getPool().query(
    `DELETE FROM trabajos WHERE cola = $1 AND estado = 'failed'`,
    [cola]
  )
  return res.rowCount ?? 0
}

/** Ejecuta el trabajo segun su cola. Devuelve el resultado a persistir. */
async function ejecutar(job: TrabajoRow): Promise<Record<string, unknown>> {
  switch (job.cola) {
    case 'notif':
      // No hay proveedor de push/email configurado: el registro del evento ya
      // ocurrio en el escrow, asi que aqui solo se acusa recibo.
      return { ok: true, entregado: false }
    case 'escrow-release': {
      const { procesarAutoReleases } = await import(
        '@/src/services/escrow.service'
      )
      return { ...(await procesarAutoReleases()) }
    }
    case 'cit-expirar':
      return expirarCits()
    default:
      throw new Error(`Cola desconocida: ${job.cola}`)
  }
}

/** Marca como EXPIRADO todo CIT activo cuyo vencimiento ya paso. */
async function expirarCits(): Promise<{ expirados: number }> {
  const res = await getPool().query<{ n: number }>(
    `
      WITH expirados AS (
        UPDATE cits
        SET estado = 'EXPIRADO', updated_at = NOW()
        WHERE estado = 'ACTIVO' AND fecha_vencimiento < NOW()
        RETURNING id
      )
      SELECT COUNT(*)::int AS n FROM expirados
    `
  )
  return { expirados: res.rows[0]?.n ?? 0 }
}

export interface ResultadoProcesamiento {
  reclamados: number
  procesados: Array<{ id: string; cola: string; estado: EstadoTrabajo }>
}

/**
 * Drena la cola: promociona los demorados que ya vencieron, reclama hasta
 * `limite` trabajos listos y los ejecuta. El reclamo usa `FOR UPDATE SKIP
 * LOCKED` para que varias invocaciones concurrentes no tomen el mismo trabajo.
 * Un fallo reprograma el trabajo (backoff) hasta agotar `max_intentos`.
 */
export async function procesarPendientes(
  limite = 25
): Promise<ResultadoProcesamiento> {
  const pool = getPool()

  // Mantenimiento recurrente: garantizar un barrido de expiracion de CITs.
  await encolarSiAusente('cit-expirar')

  // Los demorados cuyo momento ya llego vuelven a estar disponibles.
  await pool.query(
    `
      UPDATE trabajos
      SET estado = 'waiting', actualizado_en = NOW()
      WHERE estado = 'delayed' AND disponible_en <= NOW()
    `
  )

  // Reclamo atomico de trabajos listos.
  const claimed = await pool.query<TrabajoRow>(
    `
      UPDATE trabajos
      SET estado = 'active', intentos = intentos + 1, actualizado_en = NOW()
      WHERE id IN (
        SELECT id FROM trabajos
        WHERE estado = 'waiting' AND disponible_en <= NOW()
        ORDER BY creado_en ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, cola, estado, payload, intentos, max_intentos
    `,
    [limite]
  )

  const procesados: ResultadoProcesamiento['procesados'] = []

  for (const job of claimed.rows) {
    try {
      const resultado = await ejecutar(job)
      await pool.query(
        `
          UPDATE trabajos
          SET estado = 'completed', resultado = $2::jsonb, error = NULL,
              procesado_en = NOW(), actualizado_en = NOW()
          WHERE id = $1
        `,
        [job.id, JSON.stringify(resultado)]
      )
      procesados.push({ id: job.id, cola: job.cola, estado: 'completed' })
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      const agotado = job.intentos >= job.max_intentos

      if (agotado) {
        await pool.query(
          `
            UPDATE trabajos
            SET estado = 'failed', error = $2, actualizado_en = NOW()
            WHERE id = $1
          `,
          [job.id, mensaje]
        )
        procesados.push({ id: job.id, cola: job.cola, estado: 'failed' })
      } else {
        // Backoff lineal: 1 min × numero de intento.
        const backoffMs = 60_000 * job.intentos
        await pool.query(
          `
            UPDATE trabajos
            SET estado = 'delayed', error = $2,
                disponible_en = NOW() + ($3 || ' milliseconds')::interval,
                actualizado_en = NOW()
            WHERE id = $1
          `,
          [job.id, mensaje, String(backoffMs)]
        )
        procesados.push({ id: job.id, cola: job.cola, estado: 'delayed' })
      }
    }
  }

  return { reclamados: claimed.rows.length, procesados }
}
