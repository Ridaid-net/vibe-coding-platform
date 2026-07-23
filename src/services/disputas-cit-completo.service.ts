import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import { cifrarBytesDisputa, descifrarBytesDisputa } from '@/src/services/cifrado.service'
import {
  withTx,
  lockTransaccion,
  cancelarPorDisputaCitCompleto,
} from '@/src/services/escrow.service'
import {
  notificarDisputaCitAbierta,
  notificarDisputaCitAmarilla,
  notificarDisputaCitEnRevision,
  notificarDisputaCitResuelta,
} from '@/src/services/notif.service'

/**
 * RODAID — Esquema 1 Caso B: disputa comprador/vendedor de CIT Completo.
 *
 * El mecanismo generico existente (abrirDisputa()/resolverDisputa() en
 * escrow.service.ts) NO sirve para esto -- confirmado que reactiva la
 * publicacion a 'ACTIVA'/'PAUSADA', estados que una publicacion CIT Completo
 * nunca alcanza. Este archivo es un mecanismo nuevo e independiente.
 *
 * Flujo:
 *   abrirDisputaCitCompleto()  -> el comprador reclama con evidencia. Se
 *     reembolsa TODA la plata retenida de inmediato (proteccion del dinero
 *     primero, sin esperar a que se resuelva la reputacion) y la venta se
 *     cancela -- el CIT nunca se toca, sigue siendo un hecho tecnico
 *     verificado. Si es la 1ra cancelacion con evidencia del vendedor:
 *     RESUELTA_AMARILLO automatico (sin humano). 2da+: EN_REVISION_HUMANA.
 *   agregarEvidenciaDisputa()  -> comprador o vendedor suben mas evidencia
 *     mientras el caso sigue abierto.
 *   confirmarNaranja() / desestimarDisputa() -> resolucion de un admin
 *     (llamadas desde lib/admin-panel.ts, que tiene el AdminContext/auditoria
 *     -- este archivo deliberadamente no depende de lib/admin-panel.ts para
 *     evitar un import circular). Ambas aceptan un `sancionarTaller`
 *     independiente de la decision sobre el vendedor -- Esquema 2, parte (a):
 *     el admin puede confirmar que el Taller Aliado de esa transaccion
 *     tambien actuo de mala fe (certifico una inspeccion que nunca hizo, o
 *     coludio con el vendedor), reusando la misma evidencia ya presentada.
 *     No hay canal de denuncia nuevo contra un taller -- eso es la parte (b)
 *     del Esquema 2, documentada en CLAUDE.md y deliberadamente diferida.
 *   calcularRatioVerificacionesSinVenta() -> umbral anti-fraude a escala:
 *     ventana de las ultimas 10 verificaciones RESUELTAS (concretada o no) de
 *     un vendedor, piso de 5 antes de que el ratio aplique, prioriza la cola
 *     de revision si >=50% no se concretaron. Nunca sanciona por si solo.
 *   contarAntecedentesTaller() -> mismo criterio que el umbral de arriba pero
 *     para talleres: cuenta disputas donde ese taller ya fue sancionado en
 *     los ultimos 24 meses. Nunca dispara nada automatico -- solo le da
 *     contexto al admin que revisa un caso nuevo del mismo taller.
 */

const STORE_DISPUTAS = 'rodaid-disputas-cit-completo'
const VENTANA_ANTIFRAUDE = 10
const PISO_ANTIFRAUDE = 5
const RATIO_ANTIFRAUDE = 0.5

export type DisputaCitCompletoEstado =
  | 'ABIERTA'
  | 'RESUELTA_AMARILLO'
  | 'EN_REVISION_HUMANA'
  | 'CONFIRMADA_NARANJA'
  | 'DESESTIMADA'

export interface DisputaCitCompleto {
  id: string
  escrowTransaccionId: string
  publicacionId: string
  compradorId: string
  vendedorId: string
  aliadoId: string | null
  estado: DisputaCitCompletoEstado
  motivo: string
  numeroCancelacionDelVendedor: number
  montoReembolsadoArs: number | null
  revisorId: string | null
  resolucionNota: string | null
  tallerSancionado: boolean
  tallerSancionNota: string | null
  abiertaEn: string
  resueltaEn: string | null
}

interface DisputaRow {
  id: string
  escrow_transaccion_id: string
  publicacion_id: string
  comprador_id: string
  vendedor_id: string
  aliado_id: string | null
  estado: DisputaCitCompletoEstado
  motivo: string
  numero_cancelacion_del_vendedor: number
  monto_reembolsado_ars: string | null
  revisor_id: string | null
  resolucion_nota: string | null
  taller_sancionado: boolean
  taller_sancion_nota: string | null
  abierta_en: string
  resuelta_en: string | null
}

function mapDisputa(row: DisputaRow): DisputaCitCompleto {
  return {
    id: row.id,
    escrowTransaccionId: row.escrow_transaccion_id,
    publicacionId: row.publicacion_id,
    compradorId: row.comprador_id,
    vendedorId: row.vendedor_id,
    aliadoId: row.aliado_id,
    estado: row.estado,
    motivo: row.motivo,
    numeroCancelacionDelVendedor: row.numero_cancelacion_del_vendedor,
    montoReembolsadoArs: row.monto_reembolsado_ars === null ? null : Number(row.monto_reembolsado_ars),
    revisorId: row.revisor_id,
    resolucionNota: row.resolucion_nota,
    tallerSancionado: row.taller_sancionado,
    tallerSancionNota: row.taller_sancion_nota,
    abiertaEn: row.abierta_en,
    resueltaEn: row.resuelta_en,
  }
}

export interface EvidenciaArchivo {
  bytes: Buffer
  nombreArchivo: string
  contentType: string
}

export interface EvidenciaDisputa {
  id: string
  subidoPorId: string
  subidoPorRol: 'comprador' | 'vendedor'
  nombreArchivo: string | null
  contentType: string | null
  createdAt: string
}

async function subirEvidencia(
  client: DbClient,
  disputaId: string,
  subidoPorId: string,
  subidoPorRol: 'comprador' | 'vendedor',
  archivos: EvidenciaArchivo[]
): Promise<void> {
  for (const archivo of archivos) {
    const key = `${disputaId}/${randomUUID()}`
    const cifrado = cifrarBytesDisputa(archivo.bytes)
    const ab = cifrado.buffer.slice(cifrado.byteOffset, cifrado.byteOffset + cifrado.byteLength) as ArrayBuffer
    await getStore(STORE_DISPUTAS).set(key, ab)
    await client.query(
      `
        INSERT INTO disputa_cit_completo_evidencias
          (disputa_id, subido_por_id, subido_por_rol, blob_key, nombre_archivo, content_type)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [disputaId, subidoPorId, subidoPorRol, key, archivo.nombreArchivo.slice(0, 200), archivo.contentType.slice(0, 80)]
    )
  }
}

/** Lee y descifra un archivo de evidencia. Null si la key no existe. */
export async function leerEvidencia(blobKey: string): Promise<Buffer | null> {
  const data = await getStore(STORE_DISPUTAS).get(blobKey, { type: 'arrayBuffer' })
  if (data === null) return null
  return descifrarBytesDisputa(Buffer.from(data as ArrayBuffer))
}

// ── Reputacion ───────────────────────────────────────────────────────────────

async function obtenerONumeroCancelacion(client: DbClient, vendedorId: string): Promise<number> {
  await client.query(
    `INSERT INTO reputacion_vendedores (usuario_id) VALUES ($1) ON CONFLICT (usuario_id) DO NOTHING`,
    [vendedorId]
  )
  const res = await client.query<{ cancelaciones_confirmadas: number }>(
    `SELECT cancelaciones_confirmadas FROM reputacion_vendedores WHERE usuario_id = $1 FOR UPDATE`,
    [vendedorId]
  )
  return (res.rows[0]?.cancelaciones_confirmadas ?? 0) + 1
}

// ── 1. Apertura (comprador) ─────────────────────────────────────────────────

export interface AbrirDisputaInput {
  escrowTransaccionId: string
  compradorId: string
  motivo: string
  evidencia: EvidenciaArchivo[]
}

export async function abrirDisputaCitCompleto(input: AbrirDisputaInput): Promise<DisputaCitCompleto> {
  if (input.evidencia.length === 0) {
    throw new ApiError(400, 'EVIDENCIA_REQUERIDA', 'Subí al menos un archivo de evidencia.')
  }

  const resultado = await withTx(async (client) => {
    const tx = await lockTransaccion(client, input.escrowTransaccionId)
    if (tx.comprador_id !== input.compradorId) {
      throw new ApiError(403, 'NOT_PARTICIPANT', 'No sos el comprador de esta transacción.')
    }

    const { transaccion, montoReembolsadoArs } = await cancelarPorDisputaCitCompleto(
      client,
      tx,
      input.motivo
    )

    const numeroCancelacion = await obtenerONumeroCancelacion(client, tx.vendedor_id)
    const esPrimera = numeroCancelacion === 1
    const estadoDisputa: DisputaCitCompletoEstado = esPrimera ? 'RESUELTA_AMARILLO' : 'EN_REVISION_HUMANA'

    const disputaRes = await client.query<DisputaRow>(
      `
        INSERT INTO disputas_cit_completo
          (escrow_transaccion_id, publicacion_id, comprador_id, vendedor_id, aliado_id, estado,
           motivo, numero_cancelacion_del_vendedor, monto_reembolsado_ars,
           resuelta_en)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        tx.id,
        tx.publicacion_id,
        tx.comprador_id,
        tx.vendedor_id,
        tx.aliado_id,
        estadoDisputa,
        input.motivo,
        numeroCancelacion,
        montoReembolsadoArs,
        esPrimera ? new Date().toISOString() : null,
      ]
    )
    const disputa = disputaRes.rows[0]

    await subirEvidencia(client, disputa.id, input.compradorId, 'comprador', input.evidencia)

    if (esPrimera) {
      await client.query(
        `UPDATE reputacion_vendedores SET cancelaciones_confirmadas = 1, estado = 'amarillo', actualizado_en = NOW() WHERE usuario_id = $1`,
        [tx.vendedor_id]
      )
    }

    return { disputa: mapDisputa(disputa), vendedorId: tx.vendedor_id, compradorId: tx.comprador_id, montoReembolsadoArs, esPrimera }
  })

  // Notificaciones best-effort, despues del commit.
  await notificarDisputaCitAbierta(resultado.compradorId, {
    disputaId: resultado.disputa.id,
    montoReembolsadoArs: resultado.montoReembolsadoArs ?? 0,
  }).catch((err) => console.error('[disputas-cit] error notificando al comprador', err))

  if (resultado.esPrimera) {
    await notificarDisputaCitAmarilla(resultado.vendedorId, { disputaId: resultado.disputa.id }).catch((err) =>
      console.error('[disputas-cit] error notificando amarillo', err)
    )
  } else {
    await notificarDisputaCitEnRevision(resultado.vendedorId, { disputaId: resultado.disputa.id }).catch((err) =>
      console.error('[disputas-cit] error notificando en revision', err)
    )
  }

  return resultado.disputa
}

// ── 2. Evidencia adicional (comprador o vendedor) ───────────────────────────

export async function agregarEvidenciaDisputa(input: {
  disputaId: string
  usuarioId: string
  evidencia: EvidenciaArchivo[]
}): Promise<void> {
  if (input.evidencia.length === 0) {
    throw new ApiError(400, 'EVIDENCIA_REQUERIDA', 'Subí al menos un archivo.')
  }
  const pool = getPool()
  const res = await pool.query<{ comprador_id: string; vendedor_id: string; estado: DisputaCitCompletoEstado }>(
    `SELECT comprador_id, vendedor_id, estado FROM disputas_cit_completo WHERE id = $1`,
    [input.disputaId]
  )
  const disputa = res.rows[0]
  if (!disputa) {
    throw new ApiError(404, 'DISPUTA_NOT_FOUND', 'La disputa no existe.')
  }
  if (!['ABIERTA', 'EN_REVISION_HUMANA'].includes(disputa.estado)) {
    throw new ApiError(409, 'DISPUTA_YA_RESUELTA', 'Esta disputa ya fue resuelta -- no se puede subir más evidencia.')
  }
  let rol: 'comprador' | 'vendedor'
  if (disputa.comprador_id === input.usuarioId) rol = 'comprador'
  else if (disputa.vendedor_id === input.usuarioId) rol = 'vendedor'
  else throw new ApiError(403, 'NOT_PARTICIPANT', 'No participás de esta disputa.')

  await withTx(async (client) => {
    await subirEvidencia(client, input.disputaId, input.usuarioId, rol, input.evidencia)
  })
}

// ── 3. Lectura (comprador, vendedor o admin) ────────────────────────────────

export async function obtenerDisputaConEvidencia(
  disputaId: string,
  usuarioId: string | null
): Promise<{ disputa: DisputaCitCompleto; evidencia: EvidenciaDisputa[] }> {
  const pool = getPool()
  const res = await pool.query<DisputaRow>(`SELECT * FROM disputas_cit_completo WHERE id = $1`, [disputaId])
  const row = res.rows[0]
  if (!row) {
    throw new ApiError(404, 'DISPUTA_NOT_FOUND', 'La disputa no existe.')
  }
  if (usuarioId !== null && row.comprador_id !== usuarioId && row.vendedor_id !== usuarioId) {
    throw new ApiError(403, 'NOT_PARTICIPANT', 'No participás de esta disputa.')
  }

  const evRes = await pool.query<{
    id: string
    subido_por_id: string
    subido_por_rol: 'comprador' | 'vendedor'
    nombre_archivo: string | null
    content_type: string | null
    created_at: string
  }>(
    `
      SELECT id, subido_por_id, subido_por_rol, nombre_archivo, content_type, created_at
      FROM disputa_cit_completo_evidencias
      WHERE disputa_id = $1
      ORDER BY created_at ASC
    `,
    [disputaId]
  )

  return {
    disputa: mapDisputa(row),
    evidencia: evRes.rows.map(
      (r: {
        id: string
        subido_por_id: string
        subido_por_rol: 'comprador' | 'vendedor'
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

/** Resuelve la blob_key de una evidencia, validando que sea de esa disputa. */
export async function resolverEvidenciaBlobKey(disputaId: string, evidenciaId: string): Promise<string | null> {
  const res = await getPool().query<{ blob_key: string }>(
    `SELECT blob_key FROM disputa_cit_completo_evidencias WHERE id = $1 AND disputa_id = $2`,
    [evidenciaId, disputaId]
  )
  return res.rows[0]?.blob_key ?? null
}

/** Disputas donde el usuario es el vendedor (para que suba contra-evidencia). */
export async function listarDisputasComoVendedor(vendedorId: string): Promise<DisputaCitCompleto[]> {
  const res = await getPool().query<DisputaRow>(
    `SELECT * FROM disputas_cit_completo WHERE vendedor_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [vendedorId]
  )
  return res.rows.map(mapDisputa)
}

// ── 4. Cola de revisión humana (lectura, sin AdminContext) ──────────────────

export interface DisputaEnCola extends DisputaCitCompleto {
  vendedorEnUmbralAntifraude: boolean
  tallerAntecedentes24m: number
}

export async function listarColaRevisionHumana(): Promise<DisputaEnCola[]> {
  const pool = getPool()
  const res = await pool.query<DisputaRow>(
    `SELECT * FROM disputas_cit_completo WHERE estado = 'EN_REVISION_HUMANA' ORDER BY created_at ASC`
  )
  const conContexto: DisputaEnCola[] = await Promise.all(
    res.rows.map(async (row: DisputaRow) => {
      const ratio = await calcularRatioVerificacionesSinVenta(row.vendedor_id)
      const tallerAntecedentes24m = row.aliado_id ? await contarAntecedentesTaller(row.aliado_id) : 0
      return {
        ...mapDisputa(row),
        vendedorEnUmbralAntifraude: ratio.aplica && ratio.sobreUmbral,
        tallerAntecedentes24m,
      }
    })
  )
  // Prioriza (no filtra) los casos de vendedores en el umbral anti-fraude.
  return conContexto.sort(
    (a: DisputaEnCola, b: DisputaEnCola) => Number(b.vendedorEnUmbralAntifraude) - Number(a.vendedorEnUmbralAntifraude)
  )
}

// ── 5. Resolución humana (helpers de bajo nivel, sin AdminContext) ──────────

/**
 * Esquema 2, parte (a): sanciona al Taller Aliado de esa transacción --
 * independiente de la decisión sobre el vendedor (confirmar_naranja o
 * desestimar), porque un taller puede haber actuado de mala fe aunque el
 * vendedor no, o viceversa. Reusa la evidencia ya presentada en la disputa
 * -- no sube nada nuevo. Crea una deuda por el monto que el taller cobró en
 * esa transacción específica (Fee de Verificación + Fee de Logística, el
 * "Total garantizado" ya documentado -- no el Fee de Éxito, que es variable
 * y contingente a la venta).
 */
async function aplicarSancionTaller(
  client: DbClient,
  disputa: DisputaRow,
  tallerNota: string | null
): Promise<string | null> {
  if (!disputa.aliado_id) {
    throw new ApiError(409, 'SIN_TALLER_VINCULADO', 'Esta disputa no tiene un Taller Aliado vinculado.')
  }

  const feeRes = await client.query<{ fee_verificacion_ars: string; fee_logistica_pagado_taller_ars: string }>(
    `SELECT fee_verificacion_ars, fee_logistica_pagado_taller_ars FROM escrow_transacciones WHERE id = $1`,
    [disputa.escrow_transaccion_id]
  )
  const fila = feeRes.rows[0]
  const monto = Number(fila?.fee_verificacion_ars ?? 0) + Number(fila?.fee_logistica_pagado_taller_ars ?? 0)

  await client.query(
    `UPDATE disputas_cit_completo SET taller_sancionado = true, taller_sancion_nota = $2, updated_at = NOW() WHERE id = $1`,
    [disputa.id, tallerNota]
  )

  if (monto <= 0) return null

  const deudaRes = await client.query<{ id: string }>(
    `
      INSERT INTO deudas_talleres (aliado_id, monto, motivo, disputa_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [
      disputa.aliado_id,
      monto,
      'Fee de Verificación y Logística de un CIT de Transferencia con fraude confirmado del taller — disputa de CIT Completo.',
      disputa.id,
    ]
  )
  return deudaRes.rows[0]?.id ?? null
}

export async function confirmarNaranja(
  disputaId: string,
  revisorId: string,
  nota: string | null,
  sancionarTaller = false,
  tallerNota: string | null = null
): Promise<{ vendedorId: string; deudaId: string | null; deudaTallerId: string | null }> {
  return withTx(async (client) => {
    const res = await client.query<DisputaRow>(
      `SELECT * FROM disputas_cit_completo WHERE id = $1 FOR UPDATE`,
      [disputaId]
    )
    const disputa = res.rows[0]
    if (!disputa) throw new ApiError(404, 'DISPUTA_NOT_FOUND', 'La disputa no existe.')
    if (disputa.estado !== 'EN_REVISION_HUMANA') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'Esta disputa no está en revisión humana.')
    }

    await client.query(
      `
        UPDATE disputas_cit_completo
        SET estado = 'CONFIRMADA_NARANJA', revisor_id = $2, resolucion_nota = $3, resuelta_en = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [disputaId, revisorId, nota]
    )

    await client.query(
      `
        UPDATE reputacion_vendedores
        SET cancelaciones_confirmadas = cancelaciones_confirmadas + 1, estado = 'naranja', actualizado_en = NOW()
        WHERE usuario_id = $1
      `,
      [disputa.vendedor_id]
    )

    // Monto de la deuda: el fee de verificacion de la transaccion de sena
    // original de esta publicacion (puede no ser la misma fila que la
    // disputa, si la disputa se abrio en la etapa de saldo).
    const feeRes = await client.query<{ fee_verificacion_ars: string }>(
      `
        SELECT fee_verificacion_ars FROM escrow_transacciones
        WHERE publicacion_id = $1 AND disparo_verificacion = true AND fee_verificacion_ars > 0
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [disputa.publicacion_id]
    )
    const monto = Number(feeRes.rows[0]?.fee_verificacion_ars ?? 0)

    let deudaId: string | null = null
    if (monto > 0) {
      const deudaRes = await client.query<{ id: string }>(
        `
          INSERT INTO deudas_vendedores (usuario_id, monto, motivo, disputa_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
        [
          disputa.vendedor_id,
          monto,
          `Costo de verificación ya incurrido — disputa de CIT Completo confirmada (2da+ cancelación con evidencia).`,
          disputaId,
        ]
      )
      deudaId = deudaRes.rows[0]?.id ?? null
    }

    const deudaTallerId = sancionarTaller ? await aplicarSancionTaller(client, disputa, tallerNota) : null

    return { vendedorId: disputa.vendedor_id, deudaId, deudaTallerId }
  }).then(async (r) => {
    await notificarDisputaCitResuelta(r.vendedorId, { disputaId, confirmada: true, nota }).catch((err) =>
      console.error('[disputas-cit] error notificando resolucion', err)
    )
    return r
  })
}

export async function desestimarDisputa(
  disputaId: string,
  revisorId: string,
  nota: string | null,
  sancionarTaller = false,
  tallerNota: string | null = null
): Promise<{ vendedorId: string; deudaTallerId: string | null }> {
  const resultado = await withTx(async (client) => {
    const res = await client.query<DisputaRow>(
      `SELECT * FROM disputas_cit_completo WHERE id = $1 FOR UPDATE`,
      [disputaId]
    )
    const disputa = res.rows[0]
    if (!disputa) throw new ApiError(404, 'DISPUTA_NOT_FOUND', 'La disputa no existe.')
    if (disputa.estado !== 'EN_REVISION_HUMANA') {
      throw new ApiError(409, 'ESTADO_INVALIDO', 'Esta disputa no está en revisión humana.')
    }

    await client.query(
      `
        UPDATE disputas_cit_completo
        SET estado = 'DESESTIMADA', revisor_id = $2, resolucion_nota = $3, resuelta_en = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [disputaId, revisorId, nota]
    )
    // Reputación del vendedor NO se toca: un caso desestimado no cuenta como
    // strike. La sanción al taller es independiente -- puede aplicarse aunque
    // el vendedor haya sido desestimado.
    const deudaTallerId = sancionarTaller ? await aplicarSancionTaller(client, disputa, tallerNota) : null
    return { vendedorId: disputa.vendedor_id, deudaTallerId }
  })

  await notificarDisputaCitResuelta(resultado.vendedorId, { disputaId, confirmada: false, nota }).catch((err) =>
    console.error('[disputas-cit] error notificando resolucion', err)
  )
  return resultado
}

// ── 6. Umbral anti-fraude a escala (ventana 10, piso 5, ratio >=50%) ────────

export interface RatioAntifraude {
  aplica: boolean
  sobreUmbral: boolean
  totalResueltas: number
  sinConcretar: number
}

/**
 * Ratio de "verificaciones financiadas sin venta concretada" sobre las
 * últimas `VENTANA_ANTIFRAUDE` transacciones de seña RESUELTAS (concretada o
 * no) de un vendedor. Las transacciones todavía en curso NO cuentan ni suman
 * ni restan -- no tienen resultado final todavia. Por debajo del piso de
 * `PISO_ANTIFRAUDE` operaciones resueltas, el ratio no aplica (muestra
 * demasiado chica). Nunca sanciona por si solo -- solo prioriza la cola de
 * revisión humana (ver listarColaRevisionHumana).
 */
export async function calcularRatioVerificacionesSinVenta(vendedorId: string): Promise<RatioAntifraude> {
  const res = await getPool().query<{ resultado: 'concretada' | 'sin_concretar' }>(
    `
      SELECT
        CASE
          WHEN mp.estado = 'VENDIDA' THEN 'concretada'
          ELSE 'sin_concretar'
        END AS resultado
      FROM escrow_transacciones et
      JOIN marketplace_publicaciones mp ON mp.id = et.publicacion_id
      WHERE et.vendedor_id = $1
        AND et.disparo_verificacion = true
        AND (
          et.estado IN ('CANCELADA', 'RESERVA_VENCIDA')
          OR mp.estado = 'VENDIDA'
        )
      ORDER BY et.created_at DESC
      LIMIT $2
    `,
    [vendedorId, VENTANA_ANTIFRAUDE]
  )

  const totalResueltas = res.rows.length
  const sinConcretar = res.rows.filter((r: { resultado: 'concretada' | 'sin_concretar' }) => r.resultado === 'sin_concretar').length
  const aplica = totalResueltas >= PISO_ANTIFRAUDE
  const sobreUmbral = aplica && sinConcretar / totalResueltas >= RATIO_ANTIFRAUDE

  return { aplica, sobreUmbral, totalResueltas, sinConcretar }
}

// ── 7. Deuda pendiente (gate de /api/v1/marketplace/publicar) ──────────────

export async function obtenerDeudaPendiente(
  usuarioId: string
): Promise<{ id: string; monto: number; motivo: string } | null> {
  const res = await getPool().query<{ id: string; monto: string; motivo: string }>(
    `SELECT id, monto, motivo FROM deudas_vendedores WHERE usuario_id = $1 AND estado = 'pendiente' ORDER BY creado_en ASC LIMIT 1`,
    [usuarioId]
  )
  const row = res.rows[0]
  return row ? { id: row.id, monto: Number(row.monto), motivo: row.motivo } : null
}

/** Confirma el pago manual de una deuda (mismo criterio que la Cola de Pagos: cobro real fuera del sistema, confirmación manual). */
export async function confirmarPagoDeuda(deudaId: string): Promise<void> {
  const res = await getPool().query(
    `UPDATE deudas_vendedores SET estado = 'pagada', pagada_en = NOW() WHERE id = $1 AND estado = 'pendiente'`,
    [deudaId]
  )
  if (res.rowCount === 0) {
    throw new ApiError(409, 'DEUDA_NO_PENDIENTE', 'La deuda no existe o ya fue resuelta.')
  }
}

// ── 8. Esquema 2 (a): sanción a Talleres Aliados cómplices ─────────────────

const VENTANA_ANTECEDENTES_TALLER_MESES = 24

/**
 * Antecedentes confirmados de un taller en los últimos 24 meses -- nunca
 * dispara nada automático, solo le da contexto al admin que revisa un caso
 * nuevo de ese mismo taller (ver DisputaEnCola.tallerAntecedentes24m).
 * Suspender/revocar la aprobación de un taller sigue siendo, siempre, una
 * decisión humana aparte -- mismo criterio ya usado para la extinción de
 * cuenta de un vendedor.
 */
export async function contarAntecedentesTaller(aliadoId: string): Promise<number> {
  const res = await getPool().query<{ count: string }>(
    `
      SELECT COUNT(*) FROM disputas_cit_completo
      WHERE aliado_id = $1
        AND taller_sancionado = true
        AND resuelta_en > NOW() - ($2 || ' months')::interval
    `,
    [aliadoId, VENTANA_ANTECEDENTES_TALLER_MESES]
  )
  return Number(res.rows[0]?.count ?? 0)
}

/** Deuda pendiente de un Taller Aliado (gate de nuevas inspecciones -- ver inspeccion.service.ts). */
export async function obtenerDeudaPendienteTaller(
  aliadoId: string
): Promise<{ id: string; monto: number; motivo: string } | null> {
  const res = await getPool().query<{ id: string; monto: string; motivo: string }>(
    `SELECT id, monto, motivo FROM deudas_talleres WHERE aliado_id = $1 AND estado = 'pendiente' ORDER BY creado_en ASC LIMIT 1`,
    [aliadoId]
  )
  const row = res.rows[0]
  return row ? { id: row.id, monto: Number(row.monto), motivo: row.motivo } : null
}

/** Confirma el pago manual de una deuda de taller (mismo criterio que confirmarPagoDeuda()). */
export async function confirmarPagoDeudaTaller(deudaId: string): Promise<void> {
  const res = await getPool().query(
    `UPDATE deudas_talleres SET estado = 'pagada', pagada_en = NOW() WHERE id = $1 AND estado = 'pendiente'`,
    [deudaId]
  )
  if (res.rowCount === 0) {
    throw new ApiError(409, 'DEUDA_NO_PENDIENTE', 'La deuda no existe o ya fue resuelta.')
  }
}
