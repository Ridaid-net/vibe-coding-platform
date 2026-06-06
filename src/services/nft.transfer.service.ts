import { ApiError, getPool, type DbClient } from '@/lib/marketplace'
import {
  esDireccionEvm,
  getWalletCentral,
  transferirCIT,
  BfaError,
} from '@/src/services/bfa.service'

/**
 * RODAID — Modulo 7, Fase C: entrega del NFT (ERC-721) y custodia hibrida.
 *
 * Cuando el escrow llega a COMPLETADA, la titularidad del CIT (un NFT) debe
 * pasar al comprador. La estrategia es hibrida (pensada para Mendoza):
 *
 *   - Non-custodial: si el comprador tiene una direccion EVM vinculada, se
 *     dispara la transferencia on-chain contra la BFA (bfaService.transferirCIT).
 *   - Custodial: si NO tiene wallet, el NFT permanece en la wallet central de
 *     RODAID y la titularidad se registra internamente (propietario_id en `cits`
 *     y `bicicletas`). El comprador puede reclamarlo luego vinculando una wallet
 *     en POST /api/v1/cit/:id/reclamar-nft.
 *
 * Toda la operacion queda auditada en `nft_transferencias`. Ante congestion de
 * los nodos de la BFA se reintenta con backoff exponencial; al quinto intento
 * fallido la transferencia se marca FALLIDA y se alerta al administrador.
 */

export type NftEstado =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'CONFIRMADA'
  | 'CUSTODIADO'
  | 'SIN_WALLET'
  | 'FALLIDA'

// Backoff exponencial entre reintentos, en minutos: 5 min, 30 min, 2 h, 6 h.
// Con 5 intentos maximos hay 4 esperas; tras el 5o intento -> FALLIDA.
const BACKOFF_MINUTOS = [5, 30, 120, 360]
const MAX_INTENTOS = 5

// Ventana tras la cual una fila EN_PROCESO se considera "colgada" (el proceso
// fire-and-forget murio) y puede ser reclamada por el barrido de reintentos.
const EN_PROCESO_STALE_MIN = 10

// Costo de procesamiento de la pasarela como fraccion del precio final.
// Configurable por entorno; usado solo para la contabilidad de la ganancia neta.
function getTasaPasarela(): number {
  const raw = Number(process.env.RODAID_PASARELA_FEE_RATE)
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.0149
}

export interface NftTransferenciaRow {
  id: string
  transaccion_id: string
  publicacion_id: string
  cit_id: string
  bicicleta_id: string
  comprador_id: string
  destino_evm: string | null
  estado: NftEstado
  tx_hash: string | null
  intentos: number
  max_intentos: number
  proximo_reintento_en: string | null
  ultimo_error: string | null
  error_log: Array<Record<string, unknown>>
  reclamado_en: string | null
  confirmada_en: string | null
  created_at: string
  updated_at: string
}

export function mapTransferencia(row: NftTransferenciaRow) {
  return {
    id: row.id,
    transaccionId: row.transaccion_id,
    publicacionId: row.publicacion_id,
    citId: row.cit_id,
    bicicletaId: row.bicicleta_id,
    compradorId: row.comprador_id,
    destinoEvm: row.destino_evm,
    estado: row.estado,
    txHash: row.tx_hash,
    intentos: row.intentos,
    maxIntentos: row.max_intentos,
    proximoReintentoEn: row.proximo_reintento_en,
    ultimoError: row.ultimo_error,
    errorLog: row.error_log ?? [],
    reclamadoEn: row.reclamado_en,
    confirmadaEn: row.confirmada_en,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
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

// ── Contabilidad del Plan Libre ─────────────────────────────────────────────

export interface RegistrarComisionInput {
  transaccionId: string
  publicacionId: string
  vendedorId: string
  compradorId: string
  plan: string
  gateway: string
  precioFinal: number
  /** Retencion bruta de RODAID (2.5% del precio) ya calculada por el escrow. */
  retencionBruta: number
  tasaComision: number
}

/**
 * Asienta la partida contable de la venta en `rodaid_comisiones`: retencion del
 * 2.5%, costo de la pasarela y ganancia neta (retencion - costo). Idempotente
 * por transaccion. Se ejecuta dentro de la transaccion del escrow.
 */
export async function registrarComision(
  client: DbClient,
  input: RegistrarComisionInput
): Promise<void> {
  const tasaPasarela = getTasaPasarela()
  const costoPasarela = Math.round(input.precioFinal * tasaPasarela * 100) / 100
  const gananciaNeta = Math.round((input.retencionBruta - costoPasarela) * 100) / 100

  await client.query(
    `
      INSERT INTO rodaid_comisiones (
        transaccion_id, publicacion_id, vendedor_id, comprador_id, plan, gateway,
        precio_final_ars, tasa_comision, retencion_bruta_ars,
        tasa_pasarela, costo_pasarela_ars, ganancia_neta_ars
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (transaccion_id) DO NOTHING
    `,
    [
      input.transaccionId,
      input.publicacionId,
      input.vendedorId,
      input.compradorId,
      input.plan,
      input.gateway,
      input.precioFinal,
      input.tasaComision,
      input.retencionBruta,
      tasaPasarela,
      costoPasarela,
      gananciaNeta,
    ]
  )
}

// ── Encolado de la transferencia (dentro de la transaccion del escrow) ──────

/**
 * Crea la fila PENDIENTE en `nft_transferencias` para la transaccion recien
 * completada. Resuelve cit_id/bicicleta_id desde la publicacion. Idempotente.
 */
export async function encolarTransferenciaNft(
  client: DbClient,
  input: { transaccionId: string; publicacionId: string; compradorId: string }
): Promise<void> {
  await client.query(
    `
      INSERT INTO nft_transferencias (
        transaccion_id, publicacion_id, cit_id, bicicleta_id, comprador_id, max_intentos
      )
      SELECT $1, p.id, p.cit_id, p.bicicleta_id, $3, $4
      FROM marketplace_publicaciones p
      WHERE p.id = $2
      ON CONFLICT (transaccion_id) DO NOTHING
    `,
    [input.transaccionId, input.publicacionId, input.compradorId, MAX_INTENTOS]
  )
}

// ── Disparo fire-and-forget tras COMPLETADA ─────────────────────────────────

/**
 * Dispara el procesamiento de la transferencia para una transaccion completada,
 * SIN esperar el resultado (fire-and-forget). Pensado para invocarse justo
 * despues de que confirmarEntrega() haya hecho COMMIT del escrow.
 */
export function dispararTransferenciaNft(transaccionId: string): void {
  void (async () => {
    try {
      const res = await getPool().query<{ id: string }>(
        `SELECT id FROM nft_transferencias WHERE transaccion_id = $1`,
        [transaccionId]
      )
      const fila = res.rows[0]
      if (fila) {
        await procesarTransferencia(fila.id)
      }
    } catch (error) {
      console.error('[nft] disparo de transferencia fallo', transaccionId, error)
    }
  })()
}

// ── Maquina de estados de la transferencia ──────────────────────────────────

type Claim =
  | { accion: 'TRANSFERIR'; citId: string; destino: string; intento: number }
  | { accion: 'CUSTODIADO' }
  | { accion: 'NADA' }

/**
 * Procesa una transferencia: reclama la fila, decide entre la via on-chain y la
 * custodia, ejecuta la llamada a la BFA fuera de la transaccion y aplica el
 * resultado (CONFIRMADA / reintento programado / FALLIDA).
 */
export async function procesarTransferencia(transferenciaId: string): Promise<NftEstado> {
  const claim = await withTx<Claim>(async (client) => {
    const res = await client.query<NftTransferenciaRow>(
      `SELECT * FROM nft_transferencias WHERE id = $1 FOR UPDATE`,
      [transferenciaId]
    )
    const row = res.rows[0]
    if (!row) {
      return { accion: 'NADA' }
    }
    // Estados terminales: no se reprocesan.
    if (['CONFIRMADA', 'CUSTODIADO', 'FALLIDA'].includes(row.estado)) {
      return { accion: 'NADA' }
    }
    // Otra ejecucion ya esta trabajando esta fila (EN_PROCESO reciente).
    if (
      row.estado === 'EN_PROCESO' &&
      Date.now() - new Date(row.updated_at).getTime() < EN_PROCESO_STALE_MIN * 60_000
    ) {
      return { accion: 'NADA' }
    }

    const usuario = await client.query<{ direccion_evm: string | null }>(
      `SELECT direccion_evm FROM usuarios WHERE id = $1`,
      [row.comprador_id]
    )
    const destino = row.destino_evm ?? usuario.rows[0]?.direccion_evm ?? null

    // Sin wallet vinculada -> custodia: la titularidad pasa internamente al
    // comprador y el NFT permanece en la wallet central de RODAID.
    if (!esDireccionEvm(destino)) {
      await actualizarPropietarioInterno(client, row.cit_id, row.bicicleta_id, row.comprador_id)
      await client.query(
        `
          UPDATE nft_transferencias
          SET estado = 'CUSTODIADO',
              proximo_reintento_en = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [row.id]
      )
      return { accion: 'CUSTODIADO' }
    }

    // Con wallet -> se marca EN_PROCESO y se consume un intento.
    const upd = await client.query<{ intentos: number }>(
      `
        UPDATE nft_transferencias
        SET estado = 'EN_PROCESO',
            destino_evm = $2,
            intentos = intentos + 1,
            updated_at = NOW()
        WHERE id = $1
        RETURNING intentos
      `,
      [row.id, destino]
    )
    return {
      accion: 'TRANSFERIR',
      citId: row.cit_id,
      destino,
      intento: upd.rows[0].intentos,
    }
  })

  if (claim.accion === 'NADA') {
    const actual = await leerEstado(transferenciaId)
    return actual ?? 'FALLIDA'
  }
  if (claim.accion === 'CUSTODIADO') {
    return 'CUSTODIADO'
  }

  // Llamada de red a la BFA, FUERA de toda transaccion de base de datos.
  try {
    const recibo = await transferirCIT({ citId: claim.citId, destino: claim.destino })
    await withTx(async (client) => {
      const res = await client.query<NftTransferenciaRow>(
        `SELECT * FROM nft_transferencias WHERE id = $1 FOR UPDATE`,
        [transferenciaId]
      )
      const row = res.rows[0]
      if (!row) return
      await actualizarPropietarioInterno(client, row.cit_id, row.bicicleta_id, row.comprador_id)
      await client.query(
        `
          UPDATE nft_transferencias
          SET estado = 'CONFIRMADA',
              tx_hash = $2,
              confirmada_en = NOW(),
              proximo_reintento_en = NULL,
              ultimo_error = NULL,
              updated_at = NOW()
          WHERE id = $1
        `,
        [transferenciaId, recibo.txHash]
      )
    })
    return 'CONFIRMADA'
  } catch (error) {
    return registrarFallo(transferenciaId, claim.intento, error)
  }
}

/** Pone propietario_id = comprador en `cits` y `bicicletas` (titularidad interna). */
async function actualizarPropietarioInterno(
  client: DbClient,
  citId: string,
  bicicletaId: string,
  compradorId: string
): Promise<void> {
  await client.query(`UPDATE cits SET propietario_id = $2 WHERE id = $1`, [citId, compradorId])
  await client.query(`UPDATE bicicletas SET propietario_id = $2 WHERE id = $1`, [
    bicicletaId,
    compradorId,
  ])
}

/**
 * Aplica un fallo del intento `intento`: programa el siguiente reintento con
 * backoff exponencial o, agotados los intentos (o ante un error no reintetable),
 * marca FALLIDA y alerta al administrador.
 */
async function registrarFallo(
  transferenciaId: string,
  intento: number,
  error: unknown
): Promise<NftEstado> {
  const mensaje = error instanceof Error ? error.message : String(error)
  const reintentable = error instanceof BfaError ? error.reintentable : true
  const definitivo = !reintentable || intento >= MAX_INTENTOS

  const estado = await withTx<NftEstado>(async (client) => {
    if (definitivo) {
      await client.query(
        `
          UPDATE nft_transferencias
          SET estado = 'FALLIDA',
              ultimo_error = $2,
              proximo_reintento_en = NULL,
              error_log = error_log || $3::jsonb,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          transferenciaId,
          mensaje,
          JSON.stringify([{ intento, mensaje, definitivo: true }]),
        ]
      )
      return 'FALLIDA'
    }

    // El indice del backoff corresponde al intento recien fallado (1-based).
    const minutos = BACKOFF_MINUTOS[Math.min(intento - 1, BACKOFF_MINUTOS.length - 1)]
    await client.query(
      `
        UPDATE nft_transferencias
        SET estado = 'PENDIENTE',
            ultimo_error = $2,
            proximo_reintento_en = NOW() + ($3 * INTERVAL '1 minute'),
            error_log = error_log || $4::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        transferenciaId,
        mensaje,
        minutos,
        JSON.stringify([{ intento, mensaje, reintentaEnMin: minutos }]),
      ]
    )
    return 'PENDIENTE'
  })

  if (estado === 'FALLIDA') {
    await alertarAdministrador(transferenciaId, mensaje)
  }
  return estado
}

async function leerEstado(transferenciaId: string): Promise<NftEstado | null> {
  const res = await getPool().query<{ estado: NftEstado }>(
    `SELECT estado FROM nft_transferencias WHERE id = $1`,
    [transferenciaId]
  )
  return res.rows[0]?.estado ?? null
}

/**
 * Alerta al administrador ante una transferencia FALLIDA definitiva. Siempre
 * deja traza en el log y, si hay un webhook configurado, intenta notificarlo
 * (nunca propaga errores de la notificacion).
 */
async function alertarAdministrador(transferenciaId: string, mensaje: string): Promise<void> {
  console.error(
    `[nft][ALERTA] transferencia ${transferenciaId} FALLIDA tras ${MAX_INTENTOS} intentos: ${mensaje}`
  )
  const webhook = process.env.RODAID_ADMIN_ALERT_WEBHOOK
  if (!webhook) return
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo: 'NFT_TRANSFERENCIA_FALLIDA',
        transferenciaId,
        mensaje,
        intentos: MAX_INTENTOS,
      }),
    })
  } catch (error) {
    console.error('[nft] no se pudo notificar al administrador', error)
  }
}

// ── Barrido de reintentos (tarea programada / admin) ────────────────────────

/**
 * Reprocesa las transferencias reintetables cuyo plazo de backoff ya vencio,
 * mas las que quedaron colgadas en EN_PROCESO. Pensado como tarea programada.
 */
export async function procesarReintentosNft(limite = 50) {
  const pendientes = await getPool().query<{ id: string }>(
    `
      SELECT id FROM nft_transferencias
      WHERE (
              estado = 'PENDIENTE'
              AND (proximo_reintento_en IS NULL OR proximo_reintento_en <= NOW())
            )
         OR (
              estado = 'EN_PROCESO'
              AND updated_at < NOW() - ($2 * INTERVAL '1 minute')
            )
      ORDER BY proximo_reintento_en ASC NULLS FIRST
      LIMIT $1
    `,
    [limite, EN_PROCESO_STALE_MIN]
  )

  const resultados: Array<{ id: string; estado: NftEstado }> = []
  for (const { id } of pendientes.rows) {
    try {
      const estado = await procesarTransferencia(id)
      resultados.push({ id, estado })
    } catch (error) {
      console.error('[nft] reintento fallo para', id, error)
    }
  }

  return { procesadas: pendientes.rows.length, resultados }
}

// ── Reclamo de un NFT custodiado ────────────────────────────────────────────

/**
 * El comprador reclama el NFT que RODAID mantiene en custodia. Requiere que el
 * usuario tenga una direccion EVM vinculada; reencola la transferencia on-chain
 * y ejecuta el primer intento de inmediato.
 */
export async function reclamarNft(input: { citId: string; usuarioId: string }) {
  const claim = await withTx<{ tipo: 'SIN_WALLET' } | { tipo: 'REENCOLADA'; id: string }>(
    async (client) => {
      const res = await client.query<NftTransferenciaRow>(
        `
          SELECT * FROM nft_transferencias
          WHERE cit_id = $1
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
        `,
        [input.citId]
      )
      const row = res.rows[0]
      if (!row) {
        throw new ApiError(404, 'NFT_NOT_FOUND', 'No hay una transferencia de NFT para este CIT.')
      }
      if (row.comprador_id !== input.usuarioId) {
        throw new ApiError(403, 'NOT_OWNER', 'Solo el titular puede reclamar este NFT.')
      }
      if (!['CUSTODIADO', 'SIN_WALLET', 'FALLIDA'].includes(row.estado)) {
        throw new ApiError(
          409,
          'NFT_NO_RECLAMABLE',
          'El NFT no esta en custodia ni en un estado reclamable.'
        )
      }

      const usuario = await client.query<{ direccion_evm: string | null }>(
        `SELECT direccion_evm FROM usuarios WHERE id = $1`,
        [input.usuarioId]
      )
      const wallet = usuario.rows[0]?.direccion_evm ?? null

      if (!esDireccionEvm(wallet)) {
        // Sin wallet: se persiste el estado SIN_WALLET (se confirma esta tx) y
        // el llamador devuelve un 422 pidiendo vincular una direccion EVM.
        await client.query(
          `UPDATE nft_transferencias SET estado = 'SIN_WALLET', updated_at = NOW() WHERE id = $1`,
          [row.id]
        )
        return { tipo: 'SIN_WALLET' }
      }

      // Reencola la transferencia on-chain con un ciclo de intentos fresco.
      await client.query(
        `
          UPDATE nft_transferencias
          SET estado = 'PENDIENTE',
              destino_evm = $2,
              intentos = 0,
              proximo_reintento_en = NULL,
              ultimo_error = NULL,
              reclamado_en = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [row.id, wallet]
      )
      return { tipo: 'REENCOLADA', id: row.id }
    }
  )

  if (claim.tipo === 'SIN_WALLET') {
    throw new ApiError(
      422,
      'WALLET_REQUERIDA',
      'Vincula una direccion EVM valida para reclamar el NFT.'
    )
  }

  // Primer intento on-chain inmediato (la accion es explicita del usuario).
  const estado = await procesarTransferencia(claim.id)
  const res = await getPool().query<NftTransferenciaRow>(
    `SELECT * FROM nft_transferencias WHERE id = $1`,
    [claim.id]
  )
  return { estado, walletCentral: getWalletCentral(), transferencia: mapTransferencia(res.rows[0]) }
}

// ── Lecturas ────────────────────────────────────────────────────────────────

export async function getTransferenciaPorTransaccion(transaccionId: string) {
  const res = await getPool().query<NftTransferenciaRow>(
    `SELECT * FROM nft_transferencias WHERE transaccion_id = $1`,
    [transaccionId]
  )
  return res.rows[0] ? mapTransferencia(res.rows[0]) : null
}
