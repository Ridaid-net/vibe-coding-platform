import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import { cifrarBytesReclamo, descifrarBytesReclamo } from '@/src/services/cifrado.service'
import { withTx } from '@/src/services/escrow.service'
import {
  transferirTitularidadBicicleta,
  anclarTransferenciaEnBFA,
  invalidarCachePorTransferencia,
} from '@/src/services/transferencia-dominio.service'
import { clasificarNivelCIT } from '@/src/services/cit-express.service'
import {
  notificarReclamoTitularidadAbierto,
  notificarReclamoTitularidadRechazado,
  notificarReclamoTitularidadAprobado,
  notificarReclamoTitularidadDesestimado,
} from '@/src/services/notif.service'

/**
 * RODAID — Esquema 3: reclamo de titularidad (venta fuera de la plataforma,
 * sin usar /transferir ni el Marketplace).
 *
 * Caso de negocio: un comprador adquirió una bici ya registrada en RODAID a
 * nombre de otra persona, pero la venta se hizo por afuera -- el dueño
 * anterior nunca confirmó nada acá. No puede resolverse solo con la palabra
 * del comprador (vector de fraude directo), así que el flujo SIEMPRE incluye
 * al dueño actual registrado:
 *
 *   iniciarReclamoTitularidad() -> el reclamante sube evidencia. Se notifica
 *     AUTOMATICAMENTE al dueño actual, con 48hs para responder.
 *   responderComoDuenoActual() -> el dueño responde:
 *     'niega'    -> RECHAZADO_DUENO_NIEGA automático, sin revisión humana.
 *                   Antecedente grave para el reclamante.
 *     'confirma' -> APROBADO_DUENO_CONFIRMA, transferencia real EJECUTADA
 *                   ahí mismo -- el interesado real ya lo avaló, no hace
 *                   falta revisión humana adicional.
 *   procesarReclamosVencidos() (worker, cada 30min) -> si el dueño no
 *     respondió en 48hs, corre clasificarNivelCIT() sobre la bici (mismo
 *     mecanismo que CIT Express -- se trata como si el reclamante pidiera un
 *     CIT Express nuevo) y pasa a EN_REVISION_HUMANA. El nivel AMARILLO/ROJO
 *     queda como CONTEXTO para el admin -- ROJO nunca aprueba ni rechaza
 *     solo, solo prioriza/marca el caso como crítico en la cola.
 *   aprobarReclamoHumano() / desestimarReclamoHumano() -> resolución de un
 *     admin (llamadas desde lib/admin-panel.ts, que tiene el
 *     AdminContext/auditoria -- este archivo deliberadamente no depende de
 *     lib/admin-panel.ts para evitar un import circular).
 *
 * El CIT nunca se toca (misma identidad técnica, mismo criterio que las
 * otras dos transferencias) -- transferirTitularidadBicicleta() ya lo
 * garantiza, reusado tal cual con motivo='reclamo_con_evidencia'.
 */

const STORE_RECLAMOS = 'rodaid-reclamos-titularidad'
const PLAZO_RESPUESTA_HORAS = 48

export type ReclamoTitularidadEstado =
  | 'ESPERANDO_DUENO'
  | 'RECHAZADO_DUENO_NIEGA'
  | 'EN_REVISION_HUMANA'
  | 'APROBADO_DUENO_CONFIRMA'
  | 'APROBADO_HUMANO'
  | 'DESESTIMADO_HUMANO'

export interface ReclamoTitularidad {
  id: string
  bicicletaId: string
  citId: string
  reclamanteId: string
  propietarioActualId: string
  estado: ReclamoTitularidadEstado
  motivo: string
  respondeAntesDe: string
  duenoRespuesta: 'niega' | 'confirma' | null
  duenoRespondioEn: string | null
  crossReferenceNivel: 'AMARILLO' | 'ROJO' | null
  crossReferenceMotivo: string | null
  revisorId: string | null
  resolucionNota: string | null
  transferenciaId: string | null
  abiertoEn: string
  resueltoEn: string | null
}

interface ReclamoRow {
  id: string
  bicicleta_id: string
  cit_id: string
  reclamante_id: string
  propietario_actual_id: string
  estado: ReclamoTitularidadEstado
  motivo: string
  responde_antes_de: string
  dueno_respuesta: 'niega' | 'confirma' | null
  dueno_respondio_en: string | null
  cross_reference_nivel: 'AMARILLO' | 'ROJO' | null
  cross_reference_motivo: string | null
  revisor_id: string | null
  resolucion_nota: string | null
  transferencia_id: string | null
  abierto_en: string
  resuelto_en: string | null
}

function mapReclamo(row: ReclamoRow): ReclamoTitularidad {
  return {
    id: row.id,
    bicicletaId: row.bicicleta_id,
    citId: row.cit_id,
    reclamanteId: row.reclamante_id,
    propietarioActualId: row.propietario_actual_id,
    estado: row.estado,
    motivo: row.motivo,
    respondeAntesDe: row.responde_antes_de,
    duenoRespuesta: row.dueno_respuesta,
    duenoRespondioEn: row.dueno_respondio_en,
    crossReferenceNivel: row.cross_reference_nivel,
    crossReferenceMotivo: row.cross_reference_motivo,
    revisorId: row.revisor_id,
    resolucionNota: row.resolucion_nota,
    transferenciaId: row.transferencia_id,
    abiertoEn: row.abierto_en,
    resueltoEn: row.resuelto_en,
  }
}

export interface EvidenciaArchivo {
  bytes: Buffer
  nombreArchivo: string
  contentType: string
}

export interface EvidenciaReclamo {
  id: string
  subidoPorId: string
  subidoPorRol: 'reclamante' | 'dueno_actual'
  nombreArchivo: string | null
  contentType: string | null
  createdAt: string
}

async function subirEvidencia(
  client: DbClient,
  reclamoId: string,
  subidoPorId: string,
  subidoPorRol: 'reclamante' | 'dueno_actual',
  archivos: EvidenciaArchivo[]
): Promise<void> {
  for (const archivo of archivos) {
    const key = `${reclamoId}/${randomUUID()}`
    const cifrado = cifrarBytesReclamo(archivo.bytes)
    const ab = cifrado.buffer.slice(cifrado.byteOffset, cifrado.byteOffset + cifrado.byteLength) as ArrayBuffer
    await getStore(STORE_RECLAMOS).set(key, ab)
    await client.query(
      `
        INSERT INTO reclamo_titularidad_evidencias
          (reclamo_id, subido_por_id, subido_por_rol, blob_key, nombre_archivo, content_type)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [reclamoId, subidoPorId, subidoPorRol, key, archivo.nombreArchivo.slice(0, 200), archivo.contentType.slice(0, 80)]
    )
  }
}

/** Lee y descifra un archivo de evidencia. Null si la key no existe. */
export async function leerEvidencia(blobKey: string): Promise<Buffer | null> {
  const data = await getStore(STORE_RECLAMOS).get(blobKey, { type: 'arrayBuffer' })
  if (data === null) return null
  return descifrarBytesReclamo(Buffer.from(data as ArrayBuffer))
}

// ── 1. Apertura (reclamante) ────────────────────────────────────────────────

export interface IniciarReclamoInput {
  bicicletaId: string
  reclamanteId: string
  motivo: string
  evidencia: EvidenciaArchivo[]
}

export async function iniciarReclamoTitularidad(input: IniciarReclamoInput): Promise<ReclamoTitularidad> {
  if (input.evidencia.length === 0) {
    throw new ApiError(400, 'EVIDENCIA_REQUERIDA', 'Subí al menos un archivo de evidencia.')
  }

  const resultado = await withTx(async (client) => {
    const biciRes = await client.query<{ id: string; propietario_id: string }>(
      `SELECT id, propietario_id FROM bicicletas WHERE id = $1`,
      [input.bicicletaId]
    )
    const bici = biciRes.rows[0]
    if (!bici) throw new ApiError(404, 'BICICLETA_NOT_FOUND', 'La bicicleta no existe.')
    if (bici.propietario_id === input.reclamanteId) {
      throw new ApiError(409, 'ES_TU_BICI', 'Ya sos el dueño registrado de esta bicicleta.')
    }

    const citRes = await client.query<{ id: string }>(
      `SELECT id FROM cits WHERE bicicleta_id = $1 AND estado = 'activo' ORDER BY acunado_en DESC LIMIT 1`,
      [input.bicicletaId]
    )
    const cit = citRes.rows[0]
    if (!cit) {
      throw new ApiError(
        409,
        'SIN_CIT_ACTIVO',
        'Esta bicicleta no tiene un CIT activo -- no se puede iniciar un reclamo de titularidad todavía.'
      )
    }

    const yaViva = await client.query(
      `SELECT id FROM reclamos_titularidad WHERE bicicleta_id = $1 AND estado IN ('ESPERANDO_DUENO', 'EN_REVISION_HUMANA')`,
      [input.bicicletaId]
    )
    if (yaViva.rows[0]) {
      throw new ApiError(409, 'RECLAMO_YA_EXISTE', 'Ya hay un reclamo de titularidad en curso para esta bicicleta.')
    }

    const respondeAntesDe = new Date(Date.now() + PLAZO_RESPUESTA_HORAS * 60 * 60 * 1000).toISOString()

    const reclamoRes = await client.query<ReclamoRow>(
      `
        INSERT INTO reclamos_titularidad
          (bicicleta_id, cit_id, reclamante_id, propietario_actual_id, motivo, responde_antes_de)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [input.bicicletaId, cit.id, input.reclamanteId, bici.propietario_id, input.motivo, respondeAntesDe]
    )
    const reclamo = reclamoRes.rows[0]

    await subirEvidencia(client, reclamo.id, input.reclamanteId, 'reclamante', input.evidencia)

    return { reclamo: mapReclamo(reclamo), propietarioActualId: bici.propietario_id }
  })

  await notificarReclamoTitularidadAbierto(resultado.propietarioActualId, {
    reclamoId: resultado.reclamo.id,
    respondeAntesDe: resultado.reclamo.respondeAntesDe,
  }).catch((err) => console.error('[reclamos-titularidad] error notificando al dueño actual', err))

  return resultado.reclamo
}

// ── 2. Evidencia adicional (reclamante o dueño actual) ──────────────────────

export async function agregarEvidenciaReclamo(input: {
  reclamoId: string
  usuarioId: string
  evidencia: EvidenciaArchivo[]
}): Promise<void> {
  if (input.evidencia.length === 0) {
    throw new ApiError(400, 'EVIDENCIA_REQUERIDA', 'Subí al menos un archivo.')
  }
  const pool = getPool()
  const res = await pool.query<{ reclamante_id: string; propietario_actual_id: string; estado: ReclamoTitularidadEstado }>(
    `SELECT reclamante_id, propietario_actual_id, estado FROM reclamos_titularidad WHERE id = $1`,
    [input.reclamoId]
  )
  const reclamo = res.rows[0]
  if (!reclamo) {
    throw new ApiError(404, 'RECLAMO_NOT_FOUND', 'El reclamo no existe.')
  }
  if (!['ESPERANDO_DUENO', 'EN_REVISION_HUMANA'].includes(reclamo.estado)) {
    throw new ApiError(409, 'RECLAMO_YA_RESUELTO', 'Este reclamo ya fue resuelto -- no se puede subir más evidencia.')
  }
  let rol: 'reclamante' | 'dueno_actual'
  if (reclamo.reclamante_id === input.usuarioId) rol = 'reclamante'
  else if (reclamo.propietario_actual_id === input.usuarioId) rol = 'dueno_actual'
  else throw new ApiError(403, 'NOT_PARTICIPANT', 'No participás de este reclamo.')

  await withTx(async (client) => {
    await subirEvidencia(client, input.reclamoId, input.usuarioId, rol, input.evidencia)
  })
}

// ── 3. Lectura (reclamante, dueño actual o admin) ───────────────────────────

export async function obtenerReclamoConEvidencia(
  reclamoId: string,
  usuarioId: string | null
): Promise<{ reclamo: ReclamoTitularidad; evidencia: EvidenciaReclamo[] }> {
  const pool = getPool()
  const res = await pool.query<ReclamoRow>(`SELECT * FROM reclamos_titularidad WHERE id = $1`, [reclamoId])
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'RECLAMO_NOT_FOUND', 'El reclamo no existe.')
  }
  if (usuarioId !== null && row.reclamante_id !== usuarioId && row.propietario_actual_id !== usuarioId) {
    throw new ApiError(403, 'NOT_PARTICIPANT', 'No participás de este reclamo.')
  }

  const evRes = await pool.query<{
    id: string
    subido_por_id: string
    subido_por_rol: 'reclamante' | 'dueno_actual'
    nombre_archivo: string | null
    content_type: string | null
    created_at: string
  }>(
    `
      SELECT id, subido_por_id, subido_por_rol, nombre_archivo, content_type, created_at
      FROM reclamo_titularidad_evidencias
      WHERE reclamo_id = $1
      ORDER BY created_at ASC
    `,
    [reclamoId]
  )

  return {
    reclamo: mapReclamo(row),
    evidencia: evRes.rows.map(
      (r: {
        id: string
        subido_por_id: string
        subido_por_rol: 'reclamante' | 'dueno_actual'
        nombre_archivo: string | null
        content_type: string | null
        created_at: string
      }) => ({
        id: r.id,
        subidoPorId: r.subido_por_id,
        subidoPorRol: r.subido_por_rol,
        nombreArchivo: r.nombre_archivo,
        contentType: r.content_type,
        createdAt: r.created_at,
      })
    ),
  }
}

/** Resuelve la blob_key de una evidencia, validando que sea de ese reclamo. */
export async function resolverEvidenciaBlobKey(reclamoId: string, evidenciaId: string): Promise<string | null> {
  const res = await getPool().query<{ blob_key: string }>(
    `SELECT blob_key FROM reclamo_titularidad_evidencias WHERE id = $1 AND reclamo_id = $2`,
    [evidenciaId, reclamoId]
  )
  return res.rows[0]?.blob_key ?? null
}

/** Reclamos donde el usuario participa, como reclamante o como dueño actual. */
export interface ReclamoConMiRol extends ReclamoTitularidad {
  miRol: 'reclamante' | 'dueno_actual'
}

export async function listarReclamosPorUsuario(usuarioId: string): Promise<ReclamoConMiRol[]> {
  const res = await getPool().query<ReclamoRow>(
    `
      SELECT * FROM reclamos_titularidad
      WHERE reclamante_id = $1 OR propietario_actual_id = $1
      ORDER BY created_at DESC LIMIT 50
    `,
    [usuarioId]
  )
  return res.rows.map((row: ReclamoRow) => ({
    ...mapReclamo(row),
    miRol: row.reclamante_id === usuarioId ? ('reclamante' as const) : ('dueno_actual' as const),
  }))
}

// ── 4. Respuesta del dueño actual (niega / confirma) ────────────────────────

export async function responderComoDuenoActual(
  reclamoId: string,
  duenoId: string,
  respuesta: 'niega' | 'confirma'
): Promise<{ estado: ReclamoTitularidadEstado; transferenciaId: string | null }> {
  const resultado = await withTx(async (client) => {
    const res = await client.query<ReclamoRow>(`SELECT * FROM reclamos_titularidad WHERE id = $1 FOR UPDATE`, [
      reclamoId,
    ])
    const reclamo = res.rows[0]
    if (!reclamo) throw new ApiError(404, 'RECLAMO_NOT_FOUND', 'El reclamo no existe.')
    if (reclamo.propietario_actual_id !== duenoId) {
      throw new ApiError(403, 'NOT_PARTICIPANT', 'No sos el dueño registrado de esta bicicleta.')
    }
    if (reclamo.estado !== 'ESPERANDO_DUENO') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'Este reclamo ya no está esperando tu respuesta.')
    }

    if (respuesta === 'niega') {
      await client.query(
        `
          UPDATE reclamos_titularidad
          SET estado = 'RECHAZADO_DUENO_NIEGA', dueno_respuesta = 'niega', dueno_respondio_en = NOW(),
              resuelto_en = NOW(), updated_at = NOW()
          WHERE id = $1
        `,
        [reclamoId]
      )
      return {
        estado: 'RECHAZADO_DUENO_NIEGA' as const,
        transferenciaId: null,
        numeroSerie: null,
        reclamanteId: reclamo.reclamante_id,
      }
    }

    const transferencia = await transferirTitularidadBicicleta(client, {
      citId: reclamo.cit_id,
      bicicletaId: reclamo.bicicleta_id,
      propietarioAnteriorId: reclamo.propietario_actual_id,
      propietarioNuevoId: reclamo.reclamante_id,
      motivo: 'reclamo_con_evidencia',
      actorId: duenoId,
      actorRol: 'ciclista',
    })

    await client.query(
      `
        UPDATE reclamos_titularidad
        SET estado = 'APROBADO_DUENO_CONFIRMA', dueno_respuesta = 'confirma', dueno_respondio_en = NOW(),
            transferencia_id = $2, resuelto_en = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [reclamoId, transferencia.transferenciaId]
    )

    return {
      estado: 'APROBADO_DUENO_CONFIRMA' as const,
      transferenciaId: transferencia.transferenciaId,
      numeroSerie: transferencia.numeroSerie,
      reclamanteId: reclamo.reclamante_id,
    }
  })

  if (resultado.estado === 'RECHAZADO_DUENO_NIEGA') {
    await notificarReclamoTitularidadRechazado(resultado.reclamanteId, { reclamoId }).catch((err) =>
      console.error('[reclamos-titularidad] error notificando rechazo', err)
    )
  } else {
    await Promise.allSettled([
      anclarTransferenciaEnBFA(resultado.transferenciaId as string),
      invalidarCachePorTransferencia(resultado.numeroSerie),
    ])
    await notificarReclamoTitularidadAprobado(resultado.reclamanteId, { reclamoId }).catch((err) =>
      console.error('[reclamos-titularidad] error notificando aprobación', err)
    )
  }

  return { estado: resultado.estado, transferenciaId: resultado.transferenciaId }
}

// ── 5. Vencimiento (worker) — cruce con el MPF antes de escalar ─────────────

async function escalarReclamoVencido(reclamoId: string): Promise<void> {
  const pool = getPool()
  const res = await pool.query<{
    bicicleta_id: string
    cit_id: string
    numero_serie: string
    marca: string | null
    modelo: string | null
  }>(
    `
      SELECT r.bicicleta_id, r.cit_id, b.numero_serie, b.marca, b.modelo
      FROM reclamos_titularidad r
      JOIN bicicletas b ON b.id = r.bicicleta_id
      WHERE r.id = $1 AND r.estado = 'ESPERANDO_DUENO'
    `,
    [reclamoId]
  )
  const row = res.rows[0]
  // Ya se resolvió (el dueño respondió en el medio) o no existe -- no-op.
  if (!row) return

  const clasificacion = await clasificarNivelCIT({
    numeroSerie: row.numero_serie,
    marca: row.marca,
    modelo: row.modelo,
    bicicletaId: row.bicicleta_id,
    citId: row.cit_id,
  })

  // UPDATE condicional (no un lock explícito durante la llamada al cruce): si
  // el dueño respondió entre el SELECT y acá, esta fila ya no matchea
  // WHERE estado='ESPERANDO_DUENO' y no hace nada.
  await pool.query(
    `
      UPDATE reclamos_titularidad
      SET estado = 'EN_REVISION_HUMANA', cross_reference_nivel = $2, cross_reference_motivo = $3, updated_at = NOW()
      WHERE id = $1 AND estado = 'ESPERANDO_DUENO'
    `,
    [reclamoId, clasificacion.nivel, clasificacion.motivo]
  )
}

/** Barrido del worker (cada 30min) — reclamos vencidos sin respuesta del dueño. */
export async function procesarReclamosVencidos(): Promise<{ encontrados: number; escalados: number }> {
  const res = await getPool().query<{ id: string }>(
    `SELECT id FROM reclamos_titularidad WHERE estado = 'ESPERANDO_DUENO' AND responde_antes_de < NOW()`
  )
  for (const row of res.rows) {
    await escalarReclamoVencido(row.id)
  }
  return { encontrados: res.rows.length, escalados: res.rows.length }
}

// ── 6. Cola de revisión humana (lectura, sin AdminContext) ──────────────────

export interface ReclamoEnCola extends ReclamoTitularidad {
  reclamanteAntecedentesNegados: number
}

export async function listarColaRevisionReclamos(): Promise<ReclamoEnCola[]> {
  const res = await getPool().query<ReclamoRow>(
    `SELECT * FROM reclamos_titularidad WHERE estado = 'EN_REVISION_HUMANA' ORDER BY created_at ASC`
  )
  const conContexto: ReclamoEnCola[] = await Promise.all(
    res.rows.map(async (row: ReclamoRow) => ({
      ...mapReclamo(row),
      reclamanteAntecedentesNegados: await contarReclamosNegados(row.reclamante_id),
    }))
  )
  // Prioriza (no filtra) los casos con cruce ROJO -- nunca decide solo, solo
  // marca el caso como crítico para que el revisor lo vea primero.
  return conContexto.sort(
    (a: ReclamoEnCola, b: ReclamoEnCola) =>
      Number(b.crossReferenceNivel === 'ROJO') - Number(a.crossReferenceNivel === 'ROJO')
  )
}

/** Reclamos que el dueño actual negó, sin ventana de tiempo -- mismo criterio que cancelaciones_confirmadas del Esquema 1. */
export async function contarReclamosNegados(reclamanteId: string): Promise<number> {
  const res = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) FROM reclamos_titularidad WHERE reclamante_id = $1 AND estado = 'RECHAZADO_DUENO_NIEGA'`,
    [reclamanteId]
  )
  return Number(res.rows[0]?.count ?? 0)
}

// ── 7. Resolución humana (helpers de bajo nivel, sin AdminContext) ──────────

export async function aprobarReclamoHumano(
  reclamoId: string,
  revisorId: string,
  nota: string | null
): Promise<{ reclamanteId: string; transferenciaId: string }> {
  const resultado = await withTx(async (client) => {
    const res = await client.query<ReclamoRow>(`SELECT * FROM reclamos_titularidad WHERE id = $1 FOR UPDATE`, [
      reclamoId,
    ])
    const reclamo = res.rows[0]
    if (!reclamo) throw new ApiError(404, 'RECLAMO_NOT_FOUND', 'El reclamo no existe.')
    if (reclamo.estado !== 'EN_REVISION_HUMANA') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'Este reclamo no está en revisión humana.')
    }

    const transferencia = await transferirTitularidadBicicleta(client, {
      citId: reclamo.cit_id,
      bicicletaId: reclamo.bicicleta_id,
      propietarioAnteriorId: reclamo.propietario_actual_id,
      propietarioNuevoId: reclamo.reclamante_id,
      motivo: 'reclamo_con_evidencia',
      actorId: revisorId,
      actorRol: 'admin',
    })

    await client.query(
      `
        UPDATE reclamos_titularidad
        SET estado = 'APROBADO_HUMANO', revisor_id = $2, resolucion_nota = $3, transferencia_id = $4,
            resuelto_en = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [reclamoId, revisorId, nota, transferencia.transferenciaId]
    )

    return {
      reclamanteId: reclamo.reclamante_id,
      transferenciaId: transferencia.transferenciaId,
      numeroSerie: transferencia.numeroSerie,
    }
  })

  await Promise.allSettled([
    anclarTransferenciaEnBFA(resultado.transferenciaId),
    invalidarCachePorTransferencia(resultado.numeroSerie),
  ])
  await notificarReclamoTitularidadAprobado(resultado.reclamanteId, { reclamoId }).catch((err) =>
    console.error('[reclamos-titularidad] error notificando aprobación humana', err)
  )

  return { reclamanteId: resultado.reclamanteId, transferenciaId: resultado.transferenciaId }
}

export async function desestimarReclamoHumano(
  reclamoId: string,
  revisorId: string,
  nota: string | null
): Promise<{ reclamanteId: string }> {
  const reclamanteId = await withTx(async (client) => {
    const res = await client.query<ReclamoRow>(`SELECT * FROM reclamos_titularidad WHERE id = $1 FOR UPDATE`, [
      reclamoId,
    ])
    const reclamo = res.rows[0]
    if (!reclamo) throw new ApiError(404, 'RECLAMO_NOT_FOUND', 'El reclamo no existe.')
    if (reclamo.estado !== 'EN_REVISION_HUMANA') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'Este reclamo no está en revisión humana.')
    }

    await client.query(
      `
        UPDATE reclamos_titularidad
        SET estado = 'DESESTIMADO_HUMANO', revisor_id = $2, resolucion_nota = $3, resuelto_en = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [reclamoId, revisorId, nota]
    )
    return reclamo.reclamante_id
  })

  await notificarReclamoTitularidadDesestimado(reclamanteId, { reclamoId, nota }).catch((err) =>
    console.error('[reclamos-titularidad] error notificando desestimación', err)
  )

  return { reclamanteId }
}
