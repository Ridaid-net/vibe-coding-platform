import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import { cifrarBytesImpugnacion, descifrarBytesImpugnacion } from '@/src/services/cifrado.service'
import { withTx } from '@/src/services/escrow.service'
import { sumarDiasHabiles } from '@/lib/dias-habiles'
import {
  notificarImpugnacionDenunciaResuelta,
  notificarImpugnacionConfirmadaContraDenunciante,
} from '@/src/services/notif.service'

/**
 * RODAID — Esquema 4: impugnación de denuncia falsa.
 *
 * Caso de negocio: un vendedor deshonesto vende su bici por fuera de RODAID,
 * cobra, entrega -- y DESPUÉS registra una denuncia de robo/hurto sobre esa
 * misma bici acá, bloqueándola para el comprador real e inocente. Este
 * archivo le da al comprador un mecanismo para impugnar esa denuncia con
 * evidencia de su propia compra.
 *
 * Flujo:
 *   iniciarImpugnacion() -> exige un vínculo previo con la bici (no
 *     verificable por SQL -- la venta fue por fuera de RODAID -- se valida
 *     por revisión humana de la evidencia, jerarquizada: factura de compra >
 *     recibo de escribano > fotos de posesión > otro medio fehaciente >
 *     testimonio de testigo, nunca determinante solo). Plazo: 15 días
 *     hábiles desde que la denuncia se activó. SIEMPRE dispara revisión
 *     humana -- a diferencia del Esquema 3, no hay una parte que responda
 *     primero, así que no hace falta estado intermedio ni worker.
 *   confirmarDenunciaFalsa() / desestimarImpugnacion() -> resolución de un
 *     admin (llamadas desde lib/admin-panel.ts, que tiene el
 *     AdminContext/auditoria -- este archivo deliberadamente no depende de
 *     lib/admin-panel.ts para evitar un import circular).
 *
 * LÍMITE DELIBERADO, confirmado con Federico 2026-07-23: no existe en este
 * repo ningún mecanismo real de consulta de estado judicial contra el MPF
 * (el único artefacto es un string sin usar, 'CONSULTAR_DENUNCIA', dentro
 * del X-Road/EDI ya documentado como código muerto). Por eso confirmar una
 * denuncia como falsa NO levanta el bloqueo real -- deja el caso en
 * 'CONFIRMADA_FALSA_PENDIENTE_LEVANTAMIENTO_MANUAL', visible para un admin
 * con toda la decisión y evidencia ya tomadas, pero sin tocar
 * denuncias_mpf/cits. Levantar el bloqueo de verdad queda para cuando exista
 * una integración real con el MPF, en una pasada aparte.
 */

const STORE_IMPUGNACIONES = 'rodaid-impugnaciones-denuncia'
const PLAZO_IMPUGNACION_DIAS_HABILES = 15

export type MedioPruebaImpugnacion =
  | 'factura_compra'
  | 'recibo_escribano'
  | 'fotos_posesion'
  | 'otro_fehaciente'
  | 'testimonio_testigo'

export type ImpugnacionDenunciaEstado =
  | 'EN_REVISION_HUMANA'
  | 'CONFIRMADA_FALSA_PENDIENTE_LEVANTAMIENTO_MANUAL'
  | 'DESESTIMADA'

export interface ImpugnacionDenuncia {
  id: string
  denunciaId: string
  bicicletaId: string
  denuncianteId: string
  impugnanteId: string
  estado: ImpugnacionDenunciaEstado
  motivo: string
  medioPruebaPrincipal: MedioPruebaImpugnacion
  revisorId: string | null
  resolucionNota: string | null
  abiertaEn: string
  resueltaEn: string | null
}

interface ImpugnacionRow {
  id: string
  denuncia_id: string
  bicicleta_id: string
  denunciante_id: string
  impugnante_id: string
  estado: ImpugnacionDenunciaEstado
  motivo: string
  medio_prueba_principal: MedioPruebaImpugnacion
  revisor_id: string | null
  resolucion_nota: string | null
  abierta_en: string
  resuelta_en: string | null
}

function mapImpugnacion(row: ImpugnacionRow): ImpugnacionDenuncia {
  return {
    id: row.id,
    denunciaId: row.denuncia_id,
    bicicletaId: row.bicicleta_id,
    denuncianteId: row.denunciante_id,
    impugnanteId: row.impugnante_id,
    estado: row.estado,
    motivo: row.motivo,
    medioPruebaPrincipal: row.medio_prueba_principal,
    revisorId: row.revisor_id,
    resolucionNota: row.resolucion_nota,
    abiertaEn: row.abierta_en,
    resueltaEn: row.resuelta_en,
  }
}

export interface EvidenciaArchivo {
  bytes: Buffer
  nombreArchivo: string
  contentType: string
}

export interface EvidenciaImpugnacion {
  id: string
  subidoPorId: string
  nombreArchivo: string | null
  contentType: string | null
  createdAt: string
}

async function subirEvidencia(
  client: DbClient,
  impugnacionId: string,
  subidoPorId: string,
  archivos: EvidenciaArchivo[]
): Promise<void> {
  for (const archivo of archivos) {
    const key = `${impugnacionId}/${randomUUID()}`
    const cifrado = cifrarBytesImpugnacion(archivo.bytes)
    const ab = cifrado.buffer.slice(cifrado.byteOffset, cifrado.byteOffset + cifrado.byteLength) as ArrayBuffer
    await getStore(STORE_IMPUGNACIONES).set(key, ab)
    await client.query(
      `
        INSERT INTO impugnacion_denuncia_evidencias
          (impugnacion_id, subido_por_id, blob_key, nombre_archivo, content_type)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [impugnacionId, subidoPorId, key, archivo.nombreArchivo.slice(0, 200), archivo.contentType.slice(0, 80)]
    )
  }
}

/** Lee y descifra un archivo de evidencia. Null si la key no existe. */
export async function leerEvidencia(blobKey: string): Promise<Buffer | null> {
  const data = await getStore(STORE_IMPUGNACIONES).get(blobKey, { type: 'arrayBuffer' })
  if (data === null) return null
  return descifrarBytesImpugnacion(Buffer.from(data as ArrayBuffer))
}

// ── 1. Apertura (quien impugna) ─────────────────────────────────────────────

export interface IniciarImpugnacionInput {
  bicicletaId: string
  impugnanteId: string
  motivo: string
  medioPruebaPrincipal: MedioPruebaImpugnacion
  evidencia: EvidenciaArchivo[]
}

export async function iniciarImpugnacion(input: IniciarImpugnacionInput): Promise<ImpugnacionDenuncia> {
  if (input.evidencia.length === 0) {
    throw new ApiError(400, 'EVIDENCIA_REQUERIDA', 'Subí al menos un archivo de evidencia.')
  }

  const impugnacion = await withTx(async (client) => {
    const denunciaRes = await client.query<{ id: string; usuario_id: string; creado_en: string }>(
      `SELECT id, usuario_id, creado_en FROM denuncias_mpf WHERE bicicleta_id = $1 AND estado = 'DENUNCIA_JUDICIAL_ACTIVA' ORDER BY creado_en DESC LIMIT 1`,
      [input.bicicletaId]
    )
    const denuncia = denunciaRes.rows[0]
    if (!denuncia) {
      throw new ApiError(404, 'DENUNCIA_NOT_FOUND', 'Esta bicicleta no tiene una denuncia activa para impugnar.')
    }

    const plazoVenceEn = sumarDiasHabiles(new Date(denuncia.creado_en), PLAZO_IMPUGNACION_DIAS_HABILES)
    if (new Date() > plazoVenceEn) {
      throw new ApiError(
        409,
        'PLAZO_VENCIDO',
        'El plazo de 15 días hábiles para impugnar esta denuncia ya venció.'
      )
    }

    const yaViva = await client.query(
      `SELECT id FROM impugnaciones_denuncia WHERE denuncia_id = $1 AND estado = 'EN_REVISION_HUMANA'`,
      [denuncia.id]
    )
    if (yaViva.rows[0]) {
      throw new ApiError(409, 'IMPUGNACION_YA_EXISTE', 'Ya hay una impugnación en curso para esta denuncia.')
    }

    const impugnacionRes = await client.query<ImpugnacionRow>(
      `
        INSERT INTO impugnaciones_denuncia
          (denuncia_id, bicicleta_id, denunciante_id, impugnante_id, motivo, medio_prueba_principal)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [
        denuncia.id,
        input.bicicletaId,
        denuncia.usuario_id,
        input.impugnanteId,
        input.motivo,
        input.medioPruebaPrincipal,
      ]
    )
    const row = impugnacionRes.rows[0]

    await subirEvidencia(client, row.id, input.impugnanteId, input.evidencia)

    return mapImpugnacion(row)
  })

  return impugnacion
}

// ── 2. Evidencia adicional (quien impugna) ──────────────────────────────────

export async function agregarEvidenciaImpugnacion(input: {
  impugnacionId: string
  usuarioId: string
  evidencia: EvidenciaArchivo[]
}): Promise<void> {
  if (input.evidencia.length === 0) {
    throw new ApiError(400, 'EVIDENCIA_REQUERIDA', 'Subí al menos un archivo.')
  }
  const pool = getPool()
  const res = await pool.query<{ impugnante_id: string; estado: ImpugnacionDenunciaEstado }>(
    `SELECT impugnante_id, estado FROM impugnaciones_denuncia WHERE id = $1`,
    [input.impugnacionId]
  )
  const impugnacion = res.rows[0]
  if (!impugnacion) {
    throw new ApiError(404, 'IMPUGNACION_NOT_FOUND', 'La impugnación no existe.')
  }
  if (impugnacion.impugnante_id !== input.usuarioId) {
    throw new ApiError(403, 'NOT_PARTICIPANT', 'No sos quien inició esta impugnación.')
  }
  if (impugnacion.estado !== 'EN_REVISION_HUMANA') {
    throw new ApiError(409, 'IMPUGNACION_YA_RESUELTA', 'Esta impugnación ya fue resuelta -- no se puede subir más evidencia.')
  }

  await withTx(async (client) => {
    await subirEvidencia(client, input.impugnacionId, input.usuarioId, input.evidencia)
  })
}

// ── 3. Lectura (quien impugna o admin) ──────────────────────────────────────

export async function obtenerImpugnacionConEvidencia(
  impugnacionId: string,
  usuarioId: string | null
): Promise<{ impugnacion: ImpugnacionDenuncia; evidencia: EvidenciaImpugnacion[] }> {
  const pool = getPool()
  const res = await pool.query<ImpugnacionRow>(`SELECT * FROM impugnaciones_denuncia WHERE id = $1`, [impugnacionId])
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'IMPUGNACION_NOT_FOUND', 'La impugnación no existe.')
  }
  if (usuarioId !== null && row.impugnante_id !== usuarioId) {
    throw new ApiError(403, 'NOT_PARTICIPANT', 'No sos quien inició esta impugnación.')
  }

  const evRes = await pool.query<{
    id: string
    subido_por_id: string
    nombre_archivo: string | null
    content_type: string | null
    created_at: string
  }>(
    `
      SELECT id, subido_por_id, nombre_archivo, content_type, created_at
      FROM impugnacion_denuncia_evidencias
      WHERE impugnacion_id = $1
      ORDER BY created_at ASC
    `,
    [impugnacionId]
  )

  return {
    impugnacion: mapImpugnacion(row),
    evidencia: evRes.rows.map(
      (r: { id: string; subido_por_id: string; nombre_archivo: string | null; content_type: string | null; created_at: string }) => ({
        id: r.id,
        subidoPorId: r.subido_por_id,
        nombreArchivo: r.nombre_archivo,
        contentType: r.content_type,
        createdAt: r.created_at,
      })
    ),
  }
}

/** Resuelve la blob_key de una evidencia, validando que sea de esa impugnación. */
export async function resolverEvidenciaBlobKey(impugnacionId: string, evidenciaId: string): Promise<string | null> {
  const res = await getPool().query<{ blob_key: string }>(
    `SELECT blob_key FROM impugnacion_denuncia_evidencias WHERE id = $1 AND impugnacion_id = $2`,
    [evidenciaId, impugnacionId]
  )
  return res.rows[0]?.blob_key ?? null
}

/** Impugnaciones donde el usuario es quien impugnó. */
export async function listarImpugnacionesPorUsuario(usuarioId: string): Promise<ImpugnacionDenuncia[]> {
  const res = await getPool().query<ImpugnacionRow>(
    `SELECT * FROM impugnaciones_denuncia WHERE impugnante_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [usuarioId]
  )
  return res.rows.map(mapImpugnacion)
}

// ── 4. Cola de revisión humana (lectura, sin AdminContext) ──────────────────

export interface ImpugnacionEnCola extends ImpugnacionDenuncia {
  denuncianteAntecedentes: number
}

export async function listarColaRevisionImpugnaciones(): Promise<ImpugnacionEnCola[]> {
  const res = await getPool().query<ImpugnacionRow>(
    `SELECT * FROM impugnaciones_denuncia WHERE estado = 'EN_REVISION_HUMANA' ORDER BY created_at ASC`
  )
  return Promise.all(
    res.rows.map(async (row: ImpugnacionRow) => ({
      ...mapImpugnacion(row),
      denuncianteAntecedentes: await contarDenunciasFalsasConfirmadas(row.denunciante_id),
    }))
  )
}

/** Denuncias de un usuario ya confirmadas como falsas, sin ventana de tiempo -- mismo criterio que el resto del backlog de disputas. */
export async function contarDenunciasFalsasConfirmadas(denuncianteId: string): Promise<number> {
  const res = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) FROM impugnaciones_denuncia WHERE denunciante_id = $1 AND estado = 'CONFIRMADA_FALSA_PENDIENTE_LEVANTAMIENTO_MANUAL'`,
    [denuncianteId]
  )
  return Number(res.rows[0]?.count ?? 0)
}

// ── 5. Resolución humana (helpers de bajo nivel, sin AdminContext) ──────────

/**
 * Confirma que la denuncia fue falsa/de mala fe. DELIBERADAMENTE no toca
 * denuncias_mpf ni cits -- no existe forma de confirmar que la causa
 * judicial también se resolvió (ver nota del archivo). Deja el caso
 * terminado y visible, con toda la evidencia y la decisión, para que un
 * admin lo retome a mano cuando haya confirmación judicial real.
 */
export async function confirmarDenunciaFalsa(
  impugnacionId: string,
  revisorId: string,
  nota: string | null
): Promise<{ impugnanteId: string; denuncianteId: string }> {
  const resultado = await withTx(async (client) => {
    const res = await client.query<ImpugnacionRow>(
      `SELECT * FROM impugnaciones_denuncia WHERE id = $1 FOR UPDATE`,
      [impugnacionId]
    )
    const impugnacion = res.rows[0]
    if (!impugnacion) throw new ApiError(404, 'IMPUGNACION_NOT_FOUND', 'La impugnación no existe.')
    if (impugnacion.estado !== 'EN_REVISION_HUMANA') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'Esta impugnación no está en revisión humana.')
    }

    await client.query(
      `
        UPDATE impugnaciones_denuncia
        SET estado = 'CONFIRMADA_FALSA_PENDIENTE_LEVANTAMIENTO_MANUAL', revisor_id = $2, resolucion_nota = $3,
            resuelta_en = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [impugnacionId, revisorId, nota]
    )

    return { impugnanteId: impugnacion.impugnante_id, denuncianteId: impugnacion.denunciante_id }
  })

  await Promise.all([
    notificarImpugnacionDenunciaResuelta(resultado.impugnanteId, { impugnacionId, confirmada: true, nota }).catch((err) =>
      console.error('[impugnaciones-denuncia] error notificando al impugnante', err)
    ),
    notificarImpugnacionConfirmadaContraDenunciante(resultado.denuncianteId, { impugnacionId, nota }).catch((err) =>
      console.error('[impugnaciones-denuncia] error notificando al denunciante', err)
    ),
  ])

  return resultado
}

export async function desestimarImpugnacion(
  impugnacionId: string,
  revisorId: string,
  nota: string | null
): Promise<{ impugnanteId: string }> {
  const impugnanteId = await withTx(async (client) => {
    const res = await client.query<ImpugnacionRow>(
      `SELECT * FROM impugnaciones_denuncia WHERE id = $1 FOR UPDATE`,
      [impugnacionId]
    )
    const impugnacion = res.rows[0]
    if (!impugnacion) throw new ApiError(404, 'IMPUGNACION_NOT_FOUND', 'La impugnación no existe.')
    if (impugnacion.estado !== 'EN_REVISION_HUMANA') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'Esta impugnación no está en revisión humana.')
    }

    await client.query(
      `
        UPDATE impugnaciones_denuncia
        SET estado = 'DESESTIMADA', revisor_id = $2, resolucion_nota = $3, resuelta_en = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [impugnacionId, revisorId, nota]
    )
    return impugnacion.impugnante_id
  })

  await notificarImpugnacionDenunciaResuelta(impugnanteId, { impugnacionId, confirmada: false, nota }).catch((err) =>
    console.error('[impugnaciones-denuncia] error notificando desestimación', err)
  )

  return { impugnanteId }
}
