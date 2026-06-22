// ─── RODAID · NFT Transfer Service — ERC-721 en BFA ──────
// Transfiere el token CIT (ERC-721) al nuevo propietario
// cuando se cierra la venta en el escrow.
//
// Flujo:
//   1. confirmarEntrega() → encolarTransferencia()
//   2. Cola PENDIENTE → procesarTransferencia()
//      → bfaService.transferirCIT(tokenId, walletDestino)
//      → txHash on-chain
//   3. UPDATE cits.propietario_id + bicicletas.propietario_id
//
// Sin wallet del comprador → estado SIN_WALLET
//   → POST /api/v1/usuarios/wallet {address} → reencola
//
// Retry backoff: 0 → 2min → 8min → 30min → 2h → FALLIDA
//
// BFA stub activo cuando BFA_CONTRACT_ADDRESS no está definido.

import { query, queryOne } from '../config/database'
import { bfaService }      from './bfa.service'
import { env }             from '../config/env'
import { log }             from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type EstadoNFTTransfer =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'CONFIRMADA'
  | 'CUSTODIADO'   // en wallet RODAID, propietario actualizado off-chain
  | 'SIN_WALLET'   // comprador sin wallet — pendiente de vincular
  | 'FALLIDA'

export interface ResultadoTransfer {
  transferId:  string
  estado:      EstadoNFTTransfer
  txHash?:     string
  custodial:   boolean
  mensaje:     string
}

const BACKOFF_SECS = [0, 120, 480, 1800, 7200]
const MAX_INTENTOS = 5

// ══════════════════════════════════════════════════════════
// RESOLVER WALLET DE DESTINO
// ══════════════════════════════════════════════════════════

async function resolverWalletDestino(usuarioId: string): Promise<{
  wallet: string; custodial: boolean
}> {
  const usuario = await queryOne<{ wallet_address: string | null }>(
    `SELECT wallet_address FROM usuarios WHERE id=$1`, [usuarioId]
  )

  if (usuario?.wallet_address) {
    return { wallet: usuario.wallet_address, custodial: false }
  }

  // Sin wallet → usar wallet custodial de RODAID
  const custodialWallet = env.RODAID_CUSTODIAL_WALLET
  if (custodialWallet) {
    return { wallet: custodialWallet, custodial: true }
  }

  return { wallet: '', custodial: false }
}

// ══════════════════════════════════════════════════════════
// TRANSFERENCIA PRINCIPAL
// ══════════════════════════════════════════════════════════

export async function transferirNFTAlComprador(opts: {
  citId:         string
  transaccionId: string
  compradorId:   string
  vendedorId:    string
}): Promise<ResultadoTransfer> {

  // 1. Cargar CIT + token ID
  const cit = await queryOne<{
    nftTokenId: number | null; numeroCIT: string; bicicletaId: string
    propietarioWallet: string | null
  }>(
    `SELECT c.nft_token_id       AS "nftTokenId",
            c.numero_cit          AS "numeroCIT",
            c.bicicleta_id        AS "bicicletaId",
            c.propietario_wallet  AS "propietarioWallet"
     FROM cits c WHERE c.id=$1`,
    [opts.citId]
  )

  if (!cit) throw Object.assign(new Error('CIT no encontrado'), { code: 'CIT_NOT_FOUND', status: 404 })
  if (!cit.nftTokenId) throw Object.assign(
    new Error(`CIT ${cit.numeroCIT} sin token NFT. El mint debe completarse antes de transferir.`),
    { code: 'NO_TOKEN', status: 422 }
  )

  // 2. Resolver wallet de destino
  const { wallet: paraWallet, custodial } = await resolverWalletDestino(opts.compradorId)
  const deWallet = cit.propietarioWallet
    ?? env.RODAID_CUSTODIAL_WALLET
    ?? '0x0000000000000000000000000000000000000000'

  // 3. Verificar transaccion_id FK
  const txExiste = await queryOne<{ id: string }>(
    `SELECT id FROM transacciones WHERE id=$1`, [opts.transaccionId]
  )

  // 4. Crear registro en cola
  const estadoInicial: EstadoNFTTransfer = !paraWallet ? 'SIN_WALLET'
    : custodial ? 'CUSTODIADO' : 'PENDIENTE'

  const row = await queryOne<{ id: string }>(
    `INSERT INTO nft_transferencias
       (cit_id, transaccion_id, token_id, de_wallet, para_wallet,
        de_usuario_id, para_usuario_id, estado, proximo_intento)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     RETURNING id`,
    [
      opts.citId, txExiste?.id ?? null, cit.nftTokenId,
      deWallet, paraWallet || null,
      opts.vendedorId, opts.compradorId,
      estadoInicial,
    ]
  )
  const transferId = row!.id

  log.bfa.info({
    transferId, nftTokenId: cit.nftTokenId, numeroCIT: cit.numeroCIT,
    de: deWallet.slice(0, 10), para: paraWallet?.slice(0, 10) ?? 'SIN_WALLET',
    custodial, estado: estadoInicial,
  }, `🔄 NFT transfer encolada: #${cit.nftTokenId} → ${estadoInicial}`)

  // 5a. Sin wallet → devolver para que comprador vincule
  if (estadoInicial === 'SIN_WALLET') {
    return { transferId, estado: 'SIN_WALLET', custodial: false,
      mensaje: 'Vinculá tu wallet para recibir el NFT. POST /api/v1/usuarios/wallet' }
  }

  // 5b. Custodial → propietario actualizado off-chain, NFT queda en wallet RODAID
  if (estadoInicial === 'CUSTODIADO') {
    await actualizarPropietarioDB({ citId: opts.citId, bicicletaId: cit.bicicletaId, compradorId: opts.compradorId })
    await query(
      `UPDATE nft_transferencias SET estado='CUSTODIADO', confirmado_en=NOW() WHERE id=$1`,
      [transferId]
    )
    return { transferId, estado: 'CUSTODIADO', custodial: true,
      mensaje: 'NFT registrado en wallet custodial RODAID. Propietario actualizado off-chain.' }
  }

  // 5c. Transferencia on-chain
  return procesarTransferenciaById(transferId, cit.nftTokenId, paraWallet, cit.bicicletaId, opts)
}

// ══════════════════════════════════════════════════════════
// EJECUCIÓN ON-CHAIN
// ══════════════════════════════════════════════════════════

async function procesarTransferenciaById(
  transferId: string,
  nftTokenId:  number,
  paraWallet:  string,
  bicicletaId: string,
  opts:        { citId: string; compradorId: string; transaccionId: string }
): Promise<ResultadoTransfer> {

  await query(
    `UPDATE nft_transferencias SET estado='EN_PROCESO', intentos=intentos+1, iniciado_en=NOW() WHERE id=$1`,
    [transferId]
  )

  try {
    const txHash = await bfaService.transferirCIT(nftTokenId, paraWallet)

    await query(
      `UPDATE nft_transferencias SET estado='CONFIRMADA', tx_hash=$2, confirmado_en=NOW() WHERE id=$1`,
      [transferId, txHash]
    )

    // Actualizar transacciones.bfa_transfer_tx_hash
    if (opts.transaccionId) {
      await query(
        `UPDATE transacciones SET bfa_transfer_tx_hash=$2, bfa_transferred_en=NOW() WHERE id=$1`,
        [opts.transaccionId, txHash]
      ).catch(() => {})
    }

    await actualizarPropietarioDB({ citId: opts.citId, bicicletaId, compradorId: opts.compradorId, txHash })

    // Registrar en bfa_eventos
    await query(
      `INSERT INTO bfa_eventos (tipo, token_id, tx_hash, direccion_para, datos)
       VALUES ('TRANSFER', $1, $2, $3, $4)`,
      [nftTokenId, txHash, paraWallet, JSON.stringify({ transferId, compradorId: opts.compradorId })]
    ).catch(() => {})

    log.bfa.info({ transferId, nftTokenId, txHash: txHash.slice(0,12)+'...', paraWallet: paraWallet.slice(0,10) },
      `✓ NFT #${nftTokenId} transferido on-chain`)

    return { transferId, estado: 'CONFIRMADA', txHash, custodial: false, mensaje: `NFT transferido. TxHash: ${txHash}` }

  } catch (err) {
    const errorMsg = (err as Error).message
    const intentos = 1  // primer intento
    const nextRetry = intentos < MAX_INTENTOS
      ? new Date(Date.now() + BACKOFF_SECS[intentos] * 1000) : null

    await query(
      `UPDATE nft_transferencias SET estado='FALLIDA', error_mensaje=$2, proximo_intento=$3 WHERE id=$1`,
      [transferId, errorMsg.slice(0, 500), nextRetry]
    )

    log.bfa.error({ transferId, nftTokenId, errorMsg }, `✗ NFT transfer on-chain fallida`)
    return { transferId, estado: 'FALLIDA', custodial: false, mensaje: `Error on-chain: ${errorMsg}` }
  }
}

// ══════════════════════════════════════════════════════════
// ACTUALIZAR PROPIETARIO EN DB
// ══════════════════════════════════════════════════════════

async function actualizarPropietarioDB(opts: {
  citId:       string
  bicicletaId: string
  compradorId: string
  txHash?:     string
}): Promise<void> {
  await Promise.all([
    query(`UPDATE cits SET propietario_id=$2 WHERE id=$1`, [opts.citId, opts.compradorId]),
    query(`UPDATE bicicletas SET propietario_id=$2 WHERE id=$1`, [opts.bicicletaId, opts.compradorId]),
  ])

  log.bfa.info({ citId: opts.citId, compradorId: opts.compradorId, txHash: opts.txHash },
    '✓ propietario_id actualizado en cits + bicicletas')
}

// ══════════════════════════════════════════════════════════
// PROCESAR COLA (cron / admin trigger)
// ══════════════════════════════════════════════════════════

export async function procesarReintentos(): Promise<{
  procesadas: number; exitosas: number; fallidas: number
}> {
  const pendientes = await query<{
    id: string; token_id: number; para_wallet: string
    cit_id: string; para_usuario_id: string; transaccion_id: string
    intentos: number
  }>(
    `SELECT id, token_id, para_wallet, cit_id, para_usuario_id, transaccion_id, intentos
     FROM nft_transferencias
     WHERE estado IN ('PENDIENTE','FALLIDA')
       AND (proximo_intento IS NULL OR proximo_intento <= NOW())
       AND intentos < $1
     LIMIT 10`,
    [MAX_INTENTOS]
  )

  let exitosas = 0; let fallidas = 0

  for (const t of pendientes) {
    const bici = await queryOne<{ bicicleta_id: string }>(
      `SELECT bicicleta_id FROM cits WHERE id=$1`, [t.cit_id]
    )
    const result = await procesarTransferenciaById(
      t.id, t.token_id, t.para_wallet, bici?.bicicleta_id ?? '',
      { citId: t.cit_id, compradorId: t.para_usuario_id, transaccionId: t.transaccion_id }
    )
    if (result.estado === 'CONFIRMADA') exitosas++; else fallidas++
  }

  return { procesadas: pendientes.length, exitosas, fallidas }
}

// ══════════════════════════════════════════════════════════
// VINCULAR WALLET Y RE-ENCOLAR
// ══════════════════════════════════════════════════════════

export async function vincularWalletYReintentar(opts: {
  usuarioId:     string
  walletAddress: string
}): Promise<{ encoladas: number }> {
  await query(
    `UPDATE usuarios SET wallet_address=$2 WHERE id=$1`,
    [opts.usuarioId, opts.walletAddress]
  )

  const result = await query<{ id: string }>(
    `UPDATE nft_transferencias
     SET estado='PENDIENTE', para_wallet=$2, proximo_intento=NOW()
     WHERE para_usuario_id=$1 AND estado='SIN_WALLET'
     RETURNING id`,
    [opts.usuarioId, opts.walletAddress]
  )

  log.bfa.info({ usuarioId: opts.usuarioId, walletAddress: opts.walletAddress, encoladas: result.length },
    `✓ ${result.length} NFT transfers re-encoladas`)

  return { encoladas: result.length }
}

// ══════════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════════

export async function getHistorialTransferencias(citId: string) {
  return query(
    `SELECT id, token_id, de_wallet, para_wallet, estado,
            tx_hash, intentos, error_mensaje, iniciado_en AS creada_en, confirmado_en
     FROM nft_transferencias WHERE cit_id=$1 ORDER BY iniciado_en DESC`,
    [citId]
  )
}

export async function getTransferenciasPendientes() {
  return query(
    `SELECT t.id, t.token_id, t.estado, t.intentos, t.para_wallet,
            t.error_mensaje, t.proximo_intento, t.iniciado_en AS creada_en,
            c.numero_cit, b.numero_serie AS serial, b.marca, b.modelo
     FROM nft_transferencias t
     JOIN cits c ON c.id=t.cit_id
     JOIN bicicletas b ON b.id=c.bicicleta_id
     WHERE t.estado IN ('PENDIENTE','FALLIDA','SIN_WALLET')
     ORDER BY t.iniciado_en`,
    []
  )
}

export async function getEstadisticasTransferencias() {
  return queryOne<{
    total: string; pendientes: string; confirmadas: string
    custodiadas: string; sin_wallet: string; fallidas: string
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE estado='PENDIENTE')::text    AS pendientes,
       COUNT(*) FILTER (WHERE estado='CONFIRMADA')::text   AS confirmadas,
       COUNT(*) FILTER (WHERE estado='CUSTODIADO')::text   AS custodiadas,
       COUNT(*) FILTER (WHERE estado='SIN_WALLET')::text   AS sin_wallet,
       COUNT(*) FILTER (WHERE estado='FALLIDA')::text      AS fallidas
     FROM nft_transferencias`,
    []
  )
}
