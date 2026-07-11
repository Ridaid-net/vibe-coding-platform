import { createHash } from 'node:crypto'
import { getPool, type DbClient } from '@/lib/marketplace'
import {
  bfaConfigurada,
  enviarAcunacionBFA,
  esErrorReintentable,
  leerConfigBFA,
  type AcunacionNFT,
  type BfaConfig,
} from '@/lib/bfa'
import { invalidarCache as invalidarCacheMinisterio } from '@/src/services/ministerio.service'

/**
 * RODAID — Transferencia real de titularidad de una bicicleta.
 *
 * El CIT nunca se revoca ni se re-emite al venderse o transferirse: misma
 * identidad tecnica de siempre. Lo unico que cambia es
 * bicicletas.propietario_id, mas un evento de "transferencia de dominio"
 * propio anclado en BFA por separado del mint original del CIT (que ya
 * ocupa las columnas bfa_* de `cits`).
 *
 * Se llama desde escrow.service.ts (liberarFondos — el punto comun a los
 * cuatro caminos que hoy dan por completada una venta: confirmarEntrega,
 * resolverDisputa a favor del vendedor, procesarAutoReleases, y
 * confirmarEntregaCitCompleto) y desde la transferencia manual
 * (/api/v1/bicicletas/[id]/transferir).
 *
 * Igual que el mint del CIT: la transferencia real (paso de base de datos) es
 * inmediata y nunca depende de la blockchain. El anclaje en BFA es un sello
 * de auditoria best-effort que se intenta despues de committear, con
 * reintento si falla de forma transitoria — nunca bloquea el cambio de
 * titularidad legal dentro de RODAID.
 */

const BFA_ESQUEMA_TRANSFERENCIA = 'RODAID-CIT-TRANSFERENCIA-v1'

export interface TransferenciaInput {
  citId: string
  bicicletaId: string
  propietarioAnteriorId: string
  propietarioNuevoId: string
  motivo: 'venta_marketplace' | 'transferencia_manual'
  escrowTransaccionId?: string | null
  actorId: string | null
  actorRol: string
}

export interface TransferenciaResultado {
  transferenciaId: string
  numeroSerie: string | null
}

/**
 * Paso 1 (DB, dentro de la transaccion del llamador): transfiere
 * bicicletas.propietario_id y deja el registro en cit_transferencias con
 * bfa_estado = 'PENDIENTE'. El llamador dispara el paso 2 (anclaje BFA +
 * invalidacion de cache) DESPUES de committear.
 */
export async function transferirTitularidadBicicleta(
  client: DbClient,
  input: TransferenciaInput
): Promise<TransferenciaResultado> {
  const biciRes = await client.query<{ numero_serie: string }>(
    `UPDATE bicicletas SET propietario_id = $1, updated_at = NOW() WHERE id = $2 RETURNING numero_serie`,
    [input.propietarioNuevoId, input.bicicletaId]
  )

  const transRes = await client.query<{ id: string }>(
    `
      INSERT INTO cit_transferencias
        (cit_id, bicicleta_id, escrow_transaccion_id, propietario_anterior_id,
         propietario_nuevo_id, motivo, actor_id, actor_rol)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `,
    [
      input.citId,
      input.bicicletaId,
      input.escrowTransaccionId ?? null,
      input.propietarioAnteriorId,
      input.propietarioNuevoId,
      input.motivo,
      input.actorId,
      input.actorRol,
    ]
  )
  const transferenciaId = transRes.rows[0].id

  await client.query(
    `
      INSERT INTO cit_eventos (cit_id, tipo, actor_id, actor_rol, metadata)
      VALUES ($1, 'TRANSFERENCIA_TITULARIDAD', $2, $3, $4::jsonb)
    `,
    [
      input.citId,
      input.actorId,
      input.actorRol,
      JSON.stringify({
        transferenciaId,
        propietarioAnteriorId: input.propietarioAnteriorId,
        propietarioNuevoId: input.propietarioNuevoId,
        motivo: input.motivo,
      }),
    ]
  )

  return { transferenciaId, numeroSerie: biciRes.rows[0]?.numero_serie ?? null }
}

interface TransferenciaRow {
  id: string
  cit_id: string
  bicicleta_id: string
  propietario_anterior_id: string
  propietario_nuevo_id: string
  motivo: string
  created_at: string
}

/** Arma el anclaje deterministico de UNA transferencia (sin llamada de red). */
function construirAnclajeTransferencia(t: TransferenciaRow, config: BfaConfig): AcunacionNFT {
  const huella = createHash('sha256')
    .update(`${t.id}|${t.cit_id}|${t.propietario_anterior_id}|${t.propietario_nuevo_id}|${t.created_at}`)
    .digest('hex')
  const tokenId = `0x${huella}`

  const metadata = {
    schema: BFA_ESQUEMA_TRANSFERENCIA,
    citId: t.cit_id,
    transferenciaId: t.id,
    propietarioAnteriorId: t.propietario_anterior_id,
    propietarioNuevoId: t.propietario_nuevo_id,
    motivo: t.motivo,
    fecha: t.created_at,
    red: config.redNombre,
  }
  const metadataHash = createHash('sha256').update(JSON.stringify(metadata)).digest('hex')
  const stampId = createHash('sha256')
    .update(`${config.chainId}|${config.contrato ?? ''}|${huella}`)
    .digest('hex')
  const objetoId = `bfa:${config.chainId}:${config.contrato ?? 'cit-transferencia'}:${tokenId}`

  return { tokenId, objetoId, metadata, metadataHash, stampId, red: config.redNombre }
}

/**
 * Paso 2 (red, FUERA de la transaccion del llamador, best-effort): ancla la
 * transferencia en BFA. Nunca lanza — si falla, deja bfa_estado en
 * ERROR/FALLIDO para que el reintento lo levante despues. Honestidad de
 * estado: sin gateway configurado, no se inventa un txHash.
 */
export async function anclarTransferenciaEnBFA(transferenciaId: string): Promise<void> {
  const pool = getPool()
  const config = leerConfigBFA()

  const res = await pool.query<TransferenciaRow>(
    `SELECT id, cit_id, bicicleta_id, propietario_anterior_id, propietario_nuevo_id, motivo, created_at
     FROM cit_transferencias WHERE id = $1`,
    [transferenciaId]
  )
  const t = res.rows[0]
  if (!t) return

  if (!bfaConfigurada(config)) {
    console.warn(`[transferencia-dominio] BFA no configurada; transferencia ${transferenciaId} queda PENDIENTE.`)
    return
  }

  try {
    const nft = construirAnclajeTransferencia(t, config)
    const resultado = await enviarAcunacionBFA(nft, { citId: t.cit_id, huella: nft.tokenId }, config)
    await pool.query(
      `UPDATE cit_transferencias SET bfa_estado = 'ACUNADO', bfa_tx_hash = $2, bfa_stamp_id = $3, bfa_objeto_id = $4 WHERE id = $1`,
      [transferenciaId, resultado.txHash, resultado.stampId, resultado.objetoId]
    )
  } catch (error) {
    const reintentable = esErrorReintentable(error)
    const mensaje = error instanceof Error ? error.message : 'Fallo el anclaje de la transferencia.'
    await pool.query(
      `UPDATE cit_transferencias SET bfa_estado = $2::cit_bfa_estado, bfa_ultimo_error = $3 WHERE id = $1`,
      [transferenciaId, reintentable ? 'ERROR' : 'FALLIDO', mensaje]
    )
    console.error(`[transferencia-dominio] fallo el anclaje de ${transferenciaId}:`, mensaje)
  }
}

/** Best-effort, nunca lanza — para llamar junto al anclaje en el mismo bloque post-commit. */
export async function invalidarCachePorTransferencia(numeroSerie: string | null): Promise<void> {
  if (!numeroSerie) return
  await invalidarCacheMinisterio(numeroSerie).catch(() => undefined)
}

/** Barrido de reintento — llamado desde POST /api/v1/admin/blockchain/anclar. */
export async function anclarTransferenciasPendientes(limite = 25): Promise<{
  encontradas: number
  ancladas: number
}> {
  const pool = getPool()
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM cit_transferencias WHERE bfa_estado IN ('PENDIENTE', 'ERROR') ORDER BY created_at ASC LIMIT $1`,
    [limite]
  )
  let ancladas = 0
  for (const row of res.rows) {
    await anclarTransferenciaEnBFA(row.id)
    const check = await pool.query<{ bfa_estado: string }>(
      `SELECT bfa_estado FROM cit_transferencias WHERE id = $1`,
      [row.id]
    )
    if (check.rows[0]?.bfa_estado === 'ACUNADO') ancladas += 1
  }
  return { encontradas: res.rows.length, ancladas }
}
