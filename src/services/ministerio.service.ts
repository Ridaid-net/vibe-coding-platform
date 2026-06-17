import { getPool } from '@/lib/marketplace'
import {
  evaluarCrossReference,
  type CrossReferenceInput,
} from '@/src/services/seguridad.mock'
import { emitirEvento } from '@/src/services/notification.service'
import {
  cifrarOpcional,
  descifrar,
  hashSensible,
} from '@/src/services/cifrado.service'
import type { ClienteMtls } from '@/src/services/mtls.service'
import type {
  MinisterioTipoAlerta,
  SeguridadAlertaCacheRow,
} from '@/src/types/database'

/**
 * RODAID — Hito 12: Integracion Institucional con el Ministerio de Seguridad.
 *
 * Concentra la logica del intercambio seguro de datos:
 *
 *   crossReference()  — responde si una bici (por serial + DNI del propietario)
 *                       tiene una ALERTA ACTIVA en RODAID y de que TIPO (robo /
 *                       discrepancia / normal), con el expediente si existe.
 *                       Cumple el SLA < 2 s apoyandose en una cache read-through
 *                       de denuncias activas (`seguridad_alertas_cache` + una capa
 *                       en memoria de instancia caliente).
 *
 *   procesarRecupero()— webhook inverso: ante un aviso de recupero del Ministerio
 *                       localiza el CIT, lo DESBLOQUEA y dispara la notificacion
 *                       push al propietario (Hito 10). Idempotente.
 *
 *   auditar()         — deja en `ministerio_auditoria` (INMUTABLE) el rastro de
 *                       quien / cuando / que serial, con el DNI CIFRADO en reposo.
 *
 * Privacidad: el DNI nunca se persiste en claro (solo cifrado AES-256 + hash no
 * reversible). No se guardan datos personales fuera de la relacion con la bici.
 */

// ── Normalizacion / validacion estricta ───────────────────────────────────────

/** Normaliza el numero de serie: mayusculas, solo [A-Z0-9]. */
export function normalizarSerie(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Validacion ESTRICTA del DNI del propietario (restriccion del hito). Acepta un
 * DNI argentino de 7 u 8 digitos (admite puntos como separador de miles, que se
 * descartan). Devuelve el DNI normalizado (solo digitos) o lanza.
 */
export function validarDni(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new DniInvalidoError()
  }
  const limpio = raw.replace(/[.\s]/g, '')
  if (!/^\d{7,8}$/.test(limpio)) {
    throw new DniInvalidoError()
  }
  return limpio
}

export class DniInvalidoError extends Error {
  constructor() {
    super('El DNI del propietario es invalido (se esperan 7 u 8 digitos).')
    this.name = 'DniInvalidoError'
  }
}

// ── Veredicto + cache (SLA < 2 s) ──────────────────────────────────────────────

export interface CrossReferenceRespuesta {
  alerta_activa: boolean
  tipo_alerta: MinisterioTipoAlerta
  expediente: string | null
}

interface VeredictoInterno extends CrossReferenceRespuesta {
  bicicletaId: string | null
  citId: string | null
}

/** TTL de la cache de denuncias activas (segundos). Configurable por entorno. */
function cacheTtlSeg(): number {
  const raw = process.env.RODAID_MINISTERIO_CACHE_TTL_SEG
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 60
}

// Capa en memoria (instancia caliente): evita pegarle a la base en rafagas de
// consultas del mismo serial. Se respeta el mismo TTL que la cache persistida.
const memoria = new Map<string, { v: VeredictoInterno; expira: number }>()

function leerMemoria(serial: string): VeredictoInterno | null {
  const hit = memoria.get(serial)
  if (hit && hit.expira > Date.now()) return hit.v
  if (hit) memoria.delete(serial)
  return null
}

function guardarMemoria(serial: string, v: VeredictoInterno): void {
  memoria.set(serial, { v, expira: Date.now() + cacheTtlSeg() * 1000 })
}

/** Invalida la cache (memoria + persistida) de un serial. */
export async function invalidarCache(serial: string): Promise<void> {
  const norm = normalizarSerie(serial)
  memoria.delete(norm)
  await getPool()
    .query(`DELETE FROM seguridad_alertas_cache WHERE serial_normalizado = $1`, [norm])
    .catch(() => undefined)
}

/** Deriva el expediente segun el tipo de alerta y el contexto disponible. */
function derivarExpediente(
  tipo: MinisterioTipoAlerta,
  serial: string,
  metadata: Record<string, unknown> | null
): string | null {
  if (tipo === 'normal') return null
  const sufijo = serial.slice(0, 8) || 'SN'
  if (tipo === 'robo') {
    // Reutiliza el expediente de la denuncia si quedo en la metadata del CIT.
    const validacion = (metadata?.validacion ?? null) as { motivo?: unknown } | null
    const motivo = typeof validacion?.motivo === 'string' ? validacion.motivo : ''
    const match = motivo.match(/([A-Z]{2,}-[A-Z0-9]+)/)
    if (match) return match[1]
    return `DEN-${sufijo}`
  }
  return `DISC-${sufijo}`
}

interface FilaVeredicto {
  bicicleta_id: string
  numero_serie: string
  cit_id: string | null
  cit_estado: string | null
  metadata_json: Record<string, unknown> | null
  discrepancias: string
}

/**
 * Recomputa el veredicto desde la fuente (cits + discrepancias + el evaluador
 * deterministico del registro de denuncias) para un serial dado. No usa cache.
 */
async function computarVeredicto(serialNorm: string): Promise<VeredictoInterno> {
  const res = await getPool().query<FilaVeredicto>(
    `
      SELECT
        b.id AS bicicleta_id, b.numero_serie,
        c.id AS cit_id, c.estado AS cit_estado, c.metadata_json,
        (SELECT COUNT(*) FROM discrepancias_reportadas d
          WHERE d.bicicleta_id = b.id AND d.tipo = 'discrepancia') AS discrepancias
      FROM bicicletas b
      LEFT JOIN LATERAL (
        SELECT * FROM cits c
        WHERE c.bicicleta_id = b.id
        ORDER BY
          CASE c.estado
            WHEN 'bloqueado' THEN 0
            WHEN 'activo' THEN 1
            WHEN 'pendiente' THEN 2
            ELSE 3
          END,
          c.creado_en DESC
        LIMIT 1
      ) c ON TRUE
      WHERE UPPER(REGEXP_REPLACE(b.numero_serie, '[^A-Za-z0-9]', '', 'g')) = $1
      LIMIT 1
    `,
    [serialNorm]
  )

  const fila = res.rows[0] ?? null
  const bicicletaId = fila?.bicicleta_id ?? null
  const citId = fila?.cit_id ?? null
  const metadata = fila?.metadata_json ?? null

  // Decision de seguridad. Prioridad: robo > discrepancia > normal.
  let tipo: MinisterioTipoAlerta = 'normal'
  if (fila?.cit_estado === 'bloqueado') {
    tipo = 'robo'
  } else {
    // Cruce contra el registro de denuncias (deterministico): cubre seriales
    // marcados como robados aunque el CIT todavia no figure bloqueado.
    const mockInput: CrossReferenceInput = { numeroSerie: serialNorm }
    const cross = evaluarCrossReference(mockInput, new Date(0).toISOString())
    if (!cross.limpio) {
      tipo = 'robo'
    } else if (fila && Number(fila.discrepancias) > 0) {
      tipo = 'discrepancia'
    }
  }

  const expediente = derivarExpediente(tipo, serialNorm, metadata)

  return {
    alerta_activa: tipo !== 'normal',
    tipo_alerta: tipo,
    expediente,
    bicicletaId,
    citId,
  }
}

/** Upsert del veredicto en la cache persistida. */
async function escribirCache(serial: string, v: VeredictoInterno): Promise<void> {
  await getPool()
    .query(
      `
        INSERT INTO seguridad_alertas_cache
          (serial_normalizado, bicicleta_id, cit_id, alerta_activa, tipo_alerta, expediente, refrescado_en)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (serial_normalizado) DO UPDATE
          SET bicicleta_id = EXCLUDED.bicicleta_id,
              cit_id = EXCLUDED.cit_id,
              alerta_activa = EXCLUDED.alerta_activa,
              tipo_alerta = EXCLUDED.tipo_alerta,
              expediente = EXCLUDED.expediente,
              refrescado_en = NOW()
      `,
      [serial, v.bicicletaId, v.citId, v.alerta_activa, v.tipo_alerta, v.expediente]
    )
    .catch((err: unknown) =>
      console.error('[ministerio] no se pudo escribir la cache de alertas', err)
    )
}

/**
 * Resuelve el veredicto de un serial usando la cache read-through:
 *   1. memoria de instancia caliente,
 *   2. cache persistida si esta fresca (dentro del TTL),
 *   3. recomputo desde la fuente + upsert.
 */
async function resolverVeredicto(serialNorm: string): Promise<VeredictoInterno> {
  const enMemoria = leerMemoria(serialNorm)
  if (enMemoria) return enMemoria

  const cacheRes = await getPool()
    .query<SeguridadAlertaCacheRow>(
      `SELECT * FROM seguridad_alertas_cache WHERE serial_normalizado = $1`,
      [serialNorm]
    )
    .catch(() => null)

  const fila = cacheRes?.rows[0]
  if (fila) {
    const frescaHasta = new Date(fila.refrescado_en).getTime() + cacheTtlSeg() * 1000
    if (frescaHasta > Date.now()) {
      const v: VeredictoInterno = {
        alerta_activa: fila.alerta_activa,
        tipo_alerta: fila.tipo_alerta,
        expediente: fila.expediente,
        bicicletaId: fila.bicicleta_id,
        citId: fila.cit_id,
      }
      guardarMemoria(serialNorm, v)
      return v
    }
  }

  const v = await computarVeredicto(serialNorm)
  guardarMemoria(serialNorm, v)
  await escribirCache(serialNorm, v)
  return v
}

export interface CrossReferenceInputInstitucional {
  serial: string
  dni: string
  cliente: ClienteMtls
}

export interface CrossReferenceSalida {
  respuesta: CrossReferenceRespuesta
  interno: VeredictoInterno
  serialNorm: string
  dniNorm: string
}

/**
 * Ejecuta el cross-reference institucional. Valida estrictamente el DNI, resuelve
 * el veredicto via cache (SLA < 2 s) y devuelve la respuesta acotada al contrato
 * (alerta_activa / tipo_alerta / expediente).
 */
export async function crossReference(
  input: CrossReferenceInputInstitucional
): Promise<CrossReferenceSalida> {
  const serialNorm = normalizarSerie(input.serial)
  if (serialNorm.length < 3) {
    throw new SerialInvalidoError()
  }
  const dniNorm = validarDni(input.dni)

  const interno = await resolverVeredicto(serialNorm)
  return {
    respuesta: {
      alerta_activa: interno.alerta_activa,
      tipo_alerta: interno.tipo_alerta,
      expediente: interno.expediente,
    },
    interno,
    serialNorm,
    dniNorm,
  }
}

export class SerialInvalidoError extends Error {
  constructor() {
    super('El numero de serie es invalido.')
    this.name = 'SerialInvalidoError'
  }
}

// ── Auditoria inmutable ────────────────────────────────────────────────────────

export interface AuditoriaInput {
  evento: string
  cliente: ClienteMtls | null
  serial: string | null
  dni?: string | null
  alertaActiva?: boolean | null
  tipoAlerta?: MinisterioTipoAlerta | null
  expediente?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Registra un evento en `ministerio_auditoria` (append-only). El DNI se guarda
 * CIFRADO (AES-256) y como hash no reversible; nunca en claro. Best-effort: no
 * tira abajo la respuesta, pero deja rastro en consola si falla.
 */
export async function auditar(a: AuditoriaInput): Promise<void> {
  const dniCifrado = cifrarOpcional(a.dni ?? null)
  const dniHash = a.dni ? hashSensible(a.dni) : null
  await getPool()
    .query(
      `
        INSERT INTO ministerio_auditoria
          (evento, cliente_cn, cliente_serie, cliente_fingerprint,
           serial_consultado, dni_cifrado, dni_hash,
           alerta_activa, tipo_alerta, expediente, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      `,
      [
        a.evento,
        a.cliente?.commonName ?? null,
        a.cliente?.serie ?? null,
        a.cliente?.fingerprint ?? null,
        a.serial,
        dniCifrado,
        dniHash,
        a.alertaActiva ?? null,
        a.tipoAlerta ?? null,
        a.expediente ?? null,
        JSON.stringify(a.metadata ?? {}),
      ]
    )
    .catch((err: unknown) =>
      console.error('[ministerio] no se pudo registrar la auditoria', err)
    )
}

// ── Webhook inverso de recupero ────────────────────────────────────────────────

export interface RecuperoInput {
  serial: string
  expediente?: string | null
  /** Identificador unico del evento del Ministerio (idempotencia). */
  eventoUid?: string | null
  /** Payload original del Ministerio (se guarda CIFRADO en reposo). */
  payloadOriginal?: unknown
  cliente: ClienteMtls
}

export interface RecuperoResultado {
  estado: 'PROCESADO' | 'SIN_COINCIDENCIA' | 'YA_PROCESADO'
  desbloqueada: boolean
  notificado: boolean
  citId: string | null
  bicicletaId: string | null
}

interface CitRecupero {
  cit_id: string
  bicicleta_id: string
  codigo_cit: string
  cit_estado: string
  propietario_id: string
}

/**
 * Procesa un aviso de recupero del Ministerio:
 *   a. localiza el CIT de la bici (por numero de serie),
 *   b. DESBLOQUEA su estado (bloqueado -> activo),
 *   c. dispara el evento de notificacion push al propietario (Hito 10).
 *
 * Idempotente por `evento_uid`: un reintento del webhook no reprocesa ni
 * re-notifica. La notificacion al propietario se emite por el bus de eventos
 * (best-effort), desacoplada del acuse al Ministerio.
 */
export async function procesarRecupero(
  input: RecuperoInput
): Promise<RecuperoResultado> {
  const serialNorm = normalizarSerie(input.serial)
  const eventoUid =
    (input.eventoUid && input.eventoUid.trim()) ||
    `recupero:${serialNorm}:${input.expediente?.trim() || 'sn'}`
  const payloadCifrado = cifrarOpcional(
    input.payloadOriginal !== undefined ? JSON.stringify(input.payloadOriginal) : null
  )

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Idempotencia: reserva el evento. Si ya existia, no se reprocesa.
    const reserva = await client.query<{ id: string }>(
      `
        INSERT INTO recuperos_ministerio
          (evento_uid, serial_normalizado, expediente, payload_cifrado,
           cliente_cn, cliente_fingerprint, estado)
        VALUES ($1, $2, $3, $4, $5, $6, 'PROCESADO')
        ON CONFLICT (evento_uid) DO NOTHING
        RETURNING id
      `,
      [
        eventoUid,
        serialNorm,
        input.expediente?.trim() || null,
        payloadCifrado,
        input.cliente.commonName,
        input.cliente.fingerprint,
      ]
    )
    if (reserva.rowCount === 0) {
      await client.query('ROLLBACK')
      return {
        estado: 'YA_PROCESADO',
        desbloqueada: false,
        notificado: false,
        citId: null,
        bicicletaId: null,
      }
    }
    const recuperoId = reserva.rows[0].id

    // a. Localizar el CIT mas relevante de la bici (prioriza el bloqueado).
    const citRes = await client.query<CitRecupero>(
      `
        SELECT c.id AS cit_id, c.bicicleta_id, c.codigo_cit, c.estado AS cit_estado,
               b.propietario_id
        FROM bicicletas b
        JOIN LATERAL (
          SELECT * FROM cits c
          WHERE c.bicicleta_id = b.id
          ORDER BY
            CASE c.estado WHEN 'bloqueado' THEN 0 WHEN 'activo' THEN 1 ELSE 2 END,
            c.creado_en DESC
          LIMIT 1
        ) c ON TRUE
        WHERE UPPER(REGEXP_REPLACE(b.numero_serie, '[^A-Za-z0-9]', '', 'g')) = $1
        LIMIT 1
      `,
      [serialNorm]
    )
    const cit = citRes.rows[0] ?? null

    if (!cit) {
      await client.query(
        `UPDATE recuperos_ministerio SET estado = 'SIN_COINCIDENCIA' WHERE id = $1`,
        [recuperoId]
      )
      await client.query('COMMIT')
      return {
        estado: 'SIN_COINCIDENCIA',
        desbloqueada: false,
        notificado: false,
        citId: null,
        bicicletaId: null,
      }
    }

    // b. Desbloquear: bloqueado -> activo (solo si estaba bloqueado).
    const desbloqueo = await client.query<{ id: string }>(
      `
        UPDATE cits
        SET estado = 'activo',
            metadata_json = metadata_json || $2::jsonb,
            actualizado_en = NOW()
        WHERE bicicleta_id = $3 AND estado = 'bloqueado'
        RETURNING id
      `,
      [
        cit.cit_id,
        JSON.stringify({
          recupero: {
            origen: 'Ministerio de Seguridad',
            expediente: input.expediente?.trim() || null,
            eventoUid,
            recuperadoEn: new Date().toISOString(),
          },
        }),
        cit.bicicleta_id,
      ]
    )
    const desbloqueada = (desbloqueo.rowCount ?? 0) > 0

    await client.query(
      `
        UPDATE recuperos_ministerio
        SET bicicleta_id = $2, cit_id = $3, desbloqueada = $4
        WHERE id = $1
      `,
      [recuperoId, cit.bicicleta_id, cit.cit_id, desbloqueada]
    )

    await client.query('COMMIT')

    // c. Notificar al propietario (Hito 10). Best-effort, desacoplado del acuse.
    let notificado = false
    if (desbloqueada) {
      const acuse = await emitirEvento({
        tipo: 'cit.recuperada',
        usuarioId: cit.propietario_id,
        data: { codigoCit: cit.codigo_cit, citId: cit.cit_id },
      }).catch(() => null)
      notificado = acuse?.enviada ?? false
      // Marca de notificacion (no critica para el acuse al Ministerio).
      await pool
        .query(`UPDATE recuperos_ministerio SET notificado = $2 WHERE id = $1`, [
          recuperoId,
          notificado,
        ])
        .catch(() => undefined)
    }

    // La bici dejo de tener alerta: invalidar la cache para reflejarlo de inmediato.
    await invalidarCache(serialNorm)

    return {
      estado: 'PROCESADO',
      desbloqueada,
      notificado,
      citId: cit.cit_id,
      bicicletaId: cit.bicicleta_id,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// Re-export utilitario para pruebas/diagnostico del cifrado de payloads.
export { descifrar as descifrarPayload }
