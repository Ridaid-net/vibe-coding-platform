import { createHash } from 'node:crypto'
import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import {
  evaluarCrossReference,
  type CrossReferenceInput,
  type CrossReferenceResultado,
} from '@/src/services/seguridad.mock'
import {
  enviarNotificacion,
  type NotificacionValidacion,
} from '@/src/services/notification.service'
import { anclarCIT, type AnclajeResultado } from '@/src/services/blockchain.service'
import { registrarRetribucionAliado } from '@/src/services/compensaciones.service'

/**
 * RODAID — Hito 5: Pipeline de Validacion de 72hs.
 *
 * Motor de verificacion automatica de la identidad de la bicicleta (CIT).
 *
 *   encolarValidacion(citId)        -> crea el job PENDIENTE (ejecutar_en = +72hs)
 *   procesarValidacionesPendientes()-> worker: barre los jobs vencidos
 *   procesarJob(jobId)              -> 1 job: cross-reference -> decision -> hash -> notifica
 *
 * Decision:
 *   cross-reference LIMPIO  -> CIT 'activo'     (APROBADO) + hash SHA-256 del payload
 *   cross-reference ALERTA  -> CIT 'bloqueado'  (BLOQUEADO)
 *
 * Plataforma: como Netlify es serverless no hay un proceso Bull/Redis vivo. La
 * "cola" es la tabla `cola_validaciones` y el worker corre como Netlify
 * Scheduled Function que invoca `procesarValidacionesPendientes()`. El delay de
 * Bull se modela con `ejecutar_en`; los attempts/backoff con
 * `intentos`/`proximo_intento_en`; el dead-letter con el estado 'ERROR'.
 *
 * Idempotencia:
 *   - Encolar dos veces el mismo CIT no duplica el job (indice unico parcial).
 *   - El procesamiento corre en una unica transaccion con lock `FOR UPDATE`:
 *     o completa entero (CIT + job + auditoria) o no deja rastro y queda
 *     PENDIENTE para reintentar. Un job ya resuelto se saltea.
 */

// Ventana de espera antes de ejecutar la validacion. Configurable por entorno
// (en horas) para poder ejercitar el pipeline en preview; por defecto 72hs.
const VENTANA_HORAS_DEFAULT = 72

// Backoff entre reintentos de un job que fallo (minutos), por numero de intento.
const BACKOFF_MINUTOS = [1, 5, 15, 60, 180]

export type ValidacionEstado =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'APROBADO'
  | 'BLOQUEADO'
  | 'ERROR'

export type ResultadoValidacion = 'APROBADO' | 'BLOQUEADO'

export interface ColaValidacionRow {
  id: string
  cit_id: string
  bicicleta_id: string
  estado: ValidacionEstado
  inicio_en: string
  ejecutar_en: string
  intentos: number
  max_intentos: number
  proximo_intento_en: string | null
  ultimo_error: string | null
  resultado: ResultadoValidacion | null
  hash_sha256: string | null
  cross_reference_json: CrossReferenceResultado | null
  procesado_en: string | null
  created_at: string
  updated_at: string
}

export interface LogValidacionRow {
  id: string
  cola_id: string
  cit_id: string
  paso: string
  detalle: string | null
  metadata: Record<string, unknown>
  created_at: string
}

function ventanaHoras(): number {
  const raw = process.env.RODAID_VALIDACION_HORAS
  if (raw === undefined || raw.trim() === '') {
    return VENTANA_HORAS_DEFAULT
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : VENTANA_HORAS_DEFAULT
}

// ── Helpers internos ────────────────────────────────────────────────────────

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

async function logPaso(
  client: DbClient,
  entry: {
    colaId: string
    citId: string
    paso: string
    detalle?: string | null
    metadata?: Record<string, unknown>
  }
) {
  await client.query(
    `
      INSERT INTO log_validaciones (cola_id, cit_id, paso, detalle, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      entry.colaId,
      entry.citId,
      entry.paso,
      entry.detalle ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ]
  )
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}

// ── 1. encolarValidacion ─────────────────────────────────────────────────────

export interface EncolarOpciones {
  /** Ventana de espera (horas) hasta `ejecutar_en`. Default: env o 72. */
  ventanaHoras?: number
}

/**
 * Encola el CIT recien solicitado para su validacion de 72hs. Idempotente: si
 * ya existe un job vivo (PENDIENTE/EN_PROCESO) para ese CIT, devuelve ese mismo
 * job sin crear uno nuevo.
 */
export async function encolarValidacion(
  citId: string,
  opciones: EncolarOpciones = {}
): Promise<ColaValidacionRow> {
  const horas = opciones.ventanaHoras ?? ventanaHoras()

  return withTx(async (client) => {
    // El CIT debe existir; tomamos su bicicleta para el cross-reference.
    const citRes = await client.query<{ id: string; bicicleta_id: string }>(
      `SELECT id, bicicleta_id FROM cits WHERE id = $1`,
      [citId]
    )
    const cit = citRes.rows[0]
    if (!cit) {
      throw new ApiError(404, 'CIT_NOT_FOUND', 'El CIT indicado no existe.')
    }

    try {
      const insert = await client.query<ColaValidacionRow>(
        `
          INSERT INTO cola_validaciones
            (cit_id, bicicleta_id, estado, inicio_en, ejecutar_en)
          VALUES ($1, $2, 'PENDIENTE', NOW(), NOW() + ($3 || ' hours')::interval)
          RETURNING *
        `,
        [cit.id, cit.bicicleta_id, String(horas)]
      )
      const job = insert.rows[0]

      await logPaso(client, {
        colaId: job.id,
        citId: cit.id,
        paso: 'ENCOLADO',
        detalle: `Validacion encolada; se ejecutara a partir de ${job.ejecutar_en}.`,
        metadata: { ventanaHoras: horas, ejecutarEn: job.ejecutar_en },
      })

      return job
    } catch (error) {
      // Ya hay un job vivo para este CIT (indice unico parcial): devolverlo.
      if (isUniqueViolation(error)) {
        const existente = await client.query<ColaValidacionRow>(
          `
            SELECT * FROM cola_validaciones
            WHERE cit_id = $1 AND estado IN ('PENDIENTE', 'EN_PROCESO')
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [citId]
        )
        if (existente.rows[0]) {
          return existente.rows[0]
        }
      }
      throw error
    }
  })
}

// ── 2. procesarJob ───────────────────────────────────────────────────────────

interface CitConBici {
  cit_id: string
  codigo_cit: string
  cit_estado: string
  metadata_json: Record<string, unknown>
  inicio_en: string
  bicicleta_id: string
  numero_serie: string
  marca: string
  modelo: string
  anio: number | null
  propietario_id: string
}

/** Construye el payload canonico del CIT que se hashea (SHA-256). */
function construirPayloadCit(
  datos: CitConBici,
  cross: CrossReferenceResultado
): Record<string, unknown> {
  return {
    citId: datos.cit_id,
    codigoCit: datos.codigo_cit,
    bicicletaId: datos.bicicleta_id,
    numeroSerie: datos.numero_serie,
    marca: datos.marca,
    modelo: datos.modelo,
    anio: datos.anio,
    propietarioId: datos.propietario_id,
    resultado: 'APROBADO',
    crossReference: {
      fuente: cross.fuente,
      limpio: cross.limpio,
      consultadoEn: cross.consultadoEn,
    },
    // Marca temporal estable del job (no NOW()) para que el hash sea reproducible.
    emitidoEn: datos.inicio_en,
  }
}

/** Serializa un objeto con claves ordenadas, de forma estable y recursiva. */
function jsonCanonico(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(jsonCanonico).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const claves = Object.keys(obj).sort()
  return `{${claves
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`)
    .join(',')}}`
}

/** Hash SHA-256 (hex) del payload canonico del CIT. Prepara el Hito 4 (Blockchain). */
export function calcularHashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(jsonCanonico(payload)).digest('hex')
}

/**
 * Timeout del fetch de cross-reference contra el Ministerio, en ms. Configurable
 * via RODAID_CROSSREF_TIMEOUT_MS, mismo patron que BFA_TIMEOUT_MS (lib/bfa.ts).
 * Es la fuente de verdad del timeout "de mecanismo" (el fetch en si) --
 * cit-express.service.ts deriva de esta funcion el timeout "de politica" (el
 * presupuesto total del Promise.race externo, mayor que este con margen) para
 * que el invariante "el timeout interno dispara antes que el externo" no
 * dependa de mantener dos numeros sincronizados a mano.
 */
export function crossReferenceTimeoutMs(): number {
  const raw = Number(process.env.RODAID_CROSSREF_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 4000
}

function resolverBaseUrl(): string | null {
  const base =
    process.env.RODAID_BASE_URL ??
    process.env.URL ??
    process.env.DEPLOY_PRIME_URL ??
    null
  if (!base) {
    return null
  }
  const trimmed = base.trim().replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Ejecuta el cross-reference contra el Ministerio de Seguridad. Primero intenta
 * el endpoint mock `POST /api/seguridad/cross-reference`; si no hay URL base o
 * el fetch falla, usa el mismo evaluador en proceso (resultado equivalente).
 */
export async function ejecutarCrossReference(
  input: CrossReferenceInput,
  ahoraISO: string
): Promise<{ resultado: CrossReferenceResultado; via: 'http' | 'inproc' }> {
  const base = resolverBaseUrl()
  if (base) {
    const controlador = new AbortController()
    const timer = setTimeout(() => controlador.abort(), crossReferenceTimeoutMs())
    try {
      const res = await fetch(`${base}/api/seguridad/cross-reference`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: controlador.signal,
      })
      if (res.ok) {
        const resultado = (await res.json()) as CrossReferenceResultado
        return { resultado, via: 'http' }
      }
    } catch {
      // Cae al evaluador en proceso (timeout, abort o error de red incluidos).
    } finally {
      clearTimeout(timer)
    }
  }
  return { resultado: evaluarCrossReference(input, ahoraISO), via: 'inproc' }
}

export interface ProcesarJobOpciones {
  /** Procesa aunque la ventana de 72hs no haya vencido (uso en demo/preview). */
  ignorarVentana?: boolean
}

export interface ProcesarJobResultado {
  jobId: string
  citId: string
  estado: 'APROBADO' | 'BLOQUEADO' | 'SALTEADO' | 'NO_VENCIDO' | 'ERROR'
  resultado?: ResultadoValidacion
  hash?: string | null
}

/**
 * Procesa un job de validacion: cross-reference -> decision -> (hash) ->
 * auditoria, todo en una transaccion. Idempotente y con reintentos.
 */
export async function procesarJob(
  jobId: string,
  opciones: ProcesarJobOpciones = {}
): Promise<ProcesarJobResultado> {
  // El payload de notificacion se devuelve desde la transaccion (no se muta una
  // variable externa) para que el control de flujo de tipos sea correcto.
  type Interno = ProcesarJobResultado & {
    notificar?: NotificacionValidacion
    // Datos para anclar el CIT en la BFA (Hito 4) tras aprobar, fuera de la tx.
    anclar?: { hash: string; serial: string }
  }

  try {
    const full = await withTx<Interno>(async (client) => {
      // Lock del job: evita que dos worker corran el mismo job a la vez.
      const jobRes = await client.query<ColaValidacionRow>(
        `SELECT * FROM cola_validaciones WHERE id = $1 FOR UPDATE`,
        [jobId]
      )
      const job = jobRes.rows[0]
      if (!job) {
        throw new ApiError(404, 'JOB_NOT_FOUND', 'El job de validacion no existe.')
      }

      // Idempotencia: si ya no esta pendiente, otro intento lo resolvio.
      if (job.estado !== 'PENDIENTE') {
        return { jobId, citId: job.cit_id, estado: 'SALTEADO' }
      }

      // Respetar la ventana de 72hs salvo que se pida ignorarla (demo).
      const vencido = new Date(job.ejecutar_en).getTime() <= Date.now()
      if (!vencido && !opciones.ignorarVentana) {
        return { jobId, citId: job.cit_id, estado: 'NO_VENCIDO' }
      }

      // Datos del CIT + bicicleta para el cross-reference y el payload.
      const datosRes = await client.query<CitConBici>(
        `
          SELECT
            c.id AS cit_id, c.codigo_cit, c.estado AS cit_estado,
            c.metadata_json,
            cv.inicio_en,
            b.id AS bicicleta_id, b.numero_serie, b.marca, b.modelo, b.anio,
            b.propietario_id
          FROM cola_validaciones cv
          JOIN cits c ON c.id = cv.cit_id
          JOIN bicicletas b ON b.id = cv.bicicleta_id
          WHERE cv.id = $1
        `,
        [jobId]
      )
      const datos = datosRes.rows[0]
      if (!datos) {
        throw new ApiError(404, 'CIT_NOT_FOUND', 'No se encontro el CIT del job.')
      }

      await client.query(
        `UPDATE cola_validaciones SET estado = 'EN_PROCESO', intentos = intentos + 1, updated_at = NOW() WHERE id = $1`,
        [jobId]
      )
      await logPaso(client, {
        colaId: jobId,
        citId: datos.cit_id,
        paso: 'INICIO_PROCESAMIENTO',
        detalle: `Intento ${job.intentos + 1} de ${job.max_intentos}.`,
        metadata: { intento: job.intentos + 1 },
      })

      // Cross-reference contra el Ministerio de Seguridad (mock).
      const ahoraISO = new Date().toISOString()
      const { resultado: cross, via } = await ejecutarCrossReference(
        {
          citId: datos.cit_id,
          codigoCit: datos.codigo_cit,
          bicicletaId: datos.bicicleta_id,
          numeroSerie: datos.numero_serie,
          marca: datos.marca,
          modelo: datos.modelo,
        },
        ahoraISO
      )
      await logPaso(client, {
        colaId: jobId,
        citId: datos.cit_id,
        paso: 'CROSS_REFERENCE_CONSULTADO',
        detalle: `Fuente: ${cross.fuente} (${via}). Limpio: ${cross.limpio}.`,
        metadata: {
          limpio: cross.limpio,
          riesgo: cross.riesgo,
          denuncias: cross.denuncias,
          via,
        },
      })

      const crossJson = JSON.stringify(cross)

      if (cross.limpio) {
        // APROBADO: hash SHA-256 del payload + CIT 'activo'.
        const payload = construirPayloadCit(datos, cross)
        const hash = calcularHashPayload(payload)

        await client.query(
          `
            UPDATE cits
            SET estado = 'activo',
                hash_sha256 = $2,
                metadata_json = metadata_json || $3::jsonb,
                actualizado_en = NOW()
            WHERE id = $1
          `,
          [
            datos.cit_id,
            hash,
            JSON.stringify({
              validacion: {
                resultado: 'APROBADO',
                hashSha256: hash,
                validadoEn: ahoraISO,
                fuente: cross.fuente,
              },
            }),
          ]
        )

        await client.query(
          `
            UPDATE cola_validaciones
            SET estado = 'APROBADO', resultado = 'APROBADO', hash_sha256 = $2,
                cross_reference_json = $3::jsonb, ultimo_error = NULL,
                proximo_intento_en = NULL, procesado_en = NOW(), updated_at = NOW()
            WHERE id = $1
          `,
          [jobId, hash, crossJson]
        )

        await logPaso(client, {
          colaId: jobId,
          citId: datos.cit_id,
          paso: 'DECISION_APROBADO',
          detalle: 'Cross-reference limpio: CIT aprobado y activado.',
        })
        await logPaso(client, {
          colaId: jobId,
          citId: datos.cit_id,
          paso: 'HASH_CALCULADO',
          detalle: 'SHA-256 del payload del CIT calculado y guardado (Hito 4).',
          metadata: { hashSha256: hash },
        })

        // Hito 13 (RODAID PAY): el CIT se emitio y valido con exito. Si la bici
        // esta vinculada a un Taller Aliado, se registra (de forma atomica con la
        // aprobacion) la retribucion proporcional que le corresponde al taller.
        const retribucion = await registrarRetribucionAliado(client, {
          citId: datos.cit_id,
          bicicletaId: datos.bicicleta_id,
        })
        if (retribucion.registrada) {
          await logPaso(client, {
            colaId: jobId,
            citId: datos.cit_id,
            paso: 'RETRIBUCION_ALIADO_REGISTRADA',
            detalle: `Retribucion al Taller Aliado registrada: $${retribucion.monto}.`,
            metadata: {
              aliadoId: retribucion.aliadoId,
              monto: retribucion.monto,
              liquidacionId: retribucion.liquidacionId,
            },
          })
        }

        return {
          jobId,
          citId: datos.cit_id,
          estado: 'APROBADO',
          resultado: 'APROBADO',
          hash,
          anclar: { hash, serial: datos.numero_serie },
          notificar: {
            destinatario: null,
            propietarioId: datos.propietario_id,
            citId: datos.cit_id,
            codigoCit: datos.codigo_cit,
            resultado: 'APROBADO',
          },
        }
      }

      // BLOQUEADO: hay denuncia -> CIT 'bloqueado'.
      const motivo = cross.denuncias[0]
        ? `Denuncia ${cross.denuncias[0].tipo} (${cross.denuncias[0].expediente})`
        : 'Coincidencia en el registro de seguridad'

      await client.query(
        `
          UPDATE cits
          SET estado = 'bloqueado',
              metadata_json = metadata_json || $2::jsonb,
              actualizado_en = NOW()
          WHERE id = $1
        `,
        [
          datos.cit_id,
          JSON.stringify({
            validacion: {
              resultado: 'BLOQUEADO',
              motivo,
              validadoEn: ahoraISO,
              fuente: cross.fuente,
            },
          }),
        ]
      )

      await client.query(
        `
          UPDATE cola_validaciones
          SET estado = 'BLOQUEADO', resultado = 'BLOQUEADO',
              cross_reference_json = $2::jsonb, ultimo_error = NULL,
              proximo_intento_en = NULL, procesado_en = NOW(), updated_at = NOW()
          WHERE id = $1
        `,
        [jobId, crossJson]
      )

      await logPaso(client, {
        colaId: jobId,
        citId: datos.cit_id,
        paso: 'DECISION_BLOQUEADO',
        detalle: `Cross-reference con alerta: CIT bloqueado. ${motivo}.`,
        metadata: { motivo, denuncias: cross.denuncias },
      })

      return {
        jobId,
        citId: datos.cit_id,
        estado: 'BLOQUEADO',
        resultado: 'BLOQUEADO',
        notificar: {
          destinatario: null,
          propietarioId: datos.propietario_id,
          citId: datos.cit_id,
          codigoCit: datos.codigo_cit,
          resultado: 'BLOQUEADO',
          motivo,
        },
      }
    })

    // Notificacion fuera de la transaccion (side-effect best-effort). Se hace
    // solo si el pipeline llego a una decision en este intento.
    const { notificar, anclar, ...out } = full
    if (notificar) {
      const acuse = await enviarNotificacion(notificar)
      await registrarNotificacion(out.jobId, out.citId, notificar.resultado, acuse)
    }

    // Hito 4: anclar el CIT aprobado en la BFA (mint del NFT de identidad).
    // Fuera de la transaccion y best-effort: si la red BFA falla o tiene
    // latencia, el CIT ya quedo 'activo' y el anclaje se reintenta despues.
    if (anclar) {
      const anclaje = await anclarCIT(out.citId, anclar.hash, anclar.serial)
      await registrarAnclaje(out.jobId, out.citId, anclaje).catch((err) =>
        console.error('[validacion] no se pudo auditar el anclaje BFA', err)
      )
    }

    return out
  } catch (error) {
    // Reintento idempotente: el job quedo PENDIENTE (rollback). Registramos el
    // fallo con backoff y, si se agotaron los intentos, lo mandamos a 'ERROR'.
    await registrarFallo(jobId, error)
    return { jobId, citId: '', estado: 'ERROR' }
  }
}

async function registrarNotificacion(
  jobId: string,
  citId: string,
  resultado: ResultadoValidacion,
  acuse: { enviada: boolean; canal: string; asunto: string }
) {
  await withTx(async (client) => {
    await logPaso(client, {
      colaId: jobId,
      citId,
      paso: 'NOTIFICACION_ENVIADA',
      detalle: `${acuse.asunto} (canal: ${acuse.canal}).`,
      metadata: { resultado, enviada: acuse.enviada, canal: acuse.canal },
    })
  }).catch((err) => console.error('[validacion] no se pudo auditar la notificacion', err))
}

/** Audita el resultado del anclaje del CIT en la BFA (Hito 4). */
async function registrarAnclaje(
  jobId: string,
  citId: string,
  anclaje: AnclajeResultado
) {
  await withTx(async (client) => {
    await logPaso(client, {
      colaId: jobId,
      citId,
      paso: anclaje.estado === 'anclado' ? 'BFA_ANCLADO' : 'BFA_ANCLAJE_PENDIENTE',
      detalle:
        anclaje.estado === 'anclado'
          ? `CIT anclado en la BFA (${anclaje.modo}). tx=${anclaje.txHash}`
          : `Anclaje BFA ${anclaje.estado} (${anclaje.modo}).${anclaje.motivo ? ' ' + anclaje.motivo : ''}`,
      metadata: {
        modo: anclaje.modo,
        estado: anclaje.estado,
        txHash: anclaje.txHash,
        tokenId: anclaje.tokenId,
      },
    })
  })
}

/** Registra un fallo de procesamiento y programa el backoff o el dead-letter. */
async function registrarFallo(jobId: string, error: unknown) {
  const mensaje = error instanceof Error ? error.message : String(error)
  try {
    await withTx(async (client) => {
      const res = await client.query<ColaValidacionRow>(
        `SELECT * FROM cola_validaciones WHERE id = $1 FOR UPDATE`,
        [jobId]
      )
      const job = res.rows[0]
      if (!job) {
        return
      }
      // El claim EN_PROCESO se revirtio con el rollback; el job sigue PENDIENTE.
      // `intentos` ya refleja el intento consumido si llego a actualizarse; si no,
      // se incrementa aqui para no reintentar en bucle sin backoff.
      const intentos = job.intentos
      if (intentos >= job.max_intentos) {
        await client.query(
          `UPDATE cola_validaciones SET estado = 'ERROR', ultimo_error = $2, updated_at = NOW() WHERE id = $1`,
          [jobId, mensaje]
        )
        await logPaso(client, {
          colaId: jobId,
          citId: job.cit_id,
          paso: 'ERROR_FATAL',
          detalle: `Se agotaron los ${job.max_intentos} intentos.`,
          metadata: { error: mensaje },
        })
        return
      }
      const backoffMin =
        BACKOFF_MINUTOS[Math.min(intentos, BACKOFF_MINUTOS.length - 1)]
      await client.query(
        `
          UPDATE cola_validaciones
          SET estado = 'PENDIENTE', intentos = $2, ultimo_error = $3,
              proximo_intento_en = NOW() + ($4 || ' minutes')::interval,
              updated_at = NOW()
          WHERE id = $1
        `,
        [jobId, intentos + 1, mensaje, String(backoffMin)]
      )
      await logPaso(client, {
        colaId: jobId,
        citId: job.cit_id,
        paso: 'REINTENTO_PROGRAMADO',
        detalle: `Reintento en ${backoffMin} min.`,
        metadata: { error: mensaje, backoffMin, intento: intentos + 1 },
      })
    })
  } catch (err) {
    console.error('[validacion] no se pudo registrar el fallo del job', jobId, err)
  }
}

// ── 3. procesarValidacionesPendientes (worker sweep) ─────────────────────────

/**
 * Worker: barre los jobs PENDIENTE cuya ventana de 72hs vencio (y sin backoff
 * activo) y los procesa uno por uno. Pensado para una Netlify Scheduled
 * Function. Idempotente: cada job se aisla en su propia transaccion y un fallo
 * no detiene al resto.
 */
export async function procesarValidacionesPendientes(limite = 50) {
  const pendientes = await getPool().query<{ id: string }>(
    `
      SELECT id FROM cola_validaciones
      WHERE estado = 'PENDIENTE'
        AND ejecutar_en <= NOW()
        AND (proximo_intento_en IS NULL OR proximo_intento_en <= NOW())
      ORDER BY ejecutar_en ASC
      LIMIT $1
    `,
    [limite]
  )

  const resultados: ProcesarJobResultado[] = []
  for (const { id } of pendientes.rows) {
    resultados.push(await procesarJob(id))
  }

  return {
    encontrados: pendientes.rows.length,
    aprobados: resultados.filter((r) => r.estado === 'APROBADO').length,
    bloqueados: resultados.filter((r) => r.estado === 'BLOQUEADO').length,
    errores: resultados.filter((r) => r.estado === 'ERROR').length,
    resultados,
  }
}

// ── Consultas de lectura / auditoria ─────────────────────────────────────────

export async function getValidacionPorCit(citId: string) {
  const jobRes = await getPool().query<ColaValidacionRow>(
    `
      SELECT * FROM cola_validaciones
      WHERE cit_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [citId]
  )
  const job = jobRes.rows[0]
  if (!job) {
    return null
  }
  const logsRes = await getPool().query<LogValidacionRow>(
    `SELECT * FROM log_validaciones WHERE cola_id = $1 ORDER BY created_at ASC, id ASC`,
    [job.id]
  )
  return { job, logs: logsRes.rows }
}
