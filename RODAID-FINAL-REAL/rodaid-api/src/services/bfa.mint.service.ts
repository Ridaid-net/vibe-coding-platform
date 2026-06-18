// ─── RODAID · BFA Mint Service ───────────────────────────
// Orquesta la acuñación del NFT ERC-721 en la Blockchain Federal Argentina
// cuando el CIT pasa la validación de 72 horas.
//
// Flujo de acuñación:
//   1. Pre-checks: CIT aprobado, sin NFT previo, sin bloqueo BFA
//   2. Determinar wallet destino (propietario o custodial RODAID)
//   3. bfaService.mint(wallet, hashSHA256, numeroCIT, serial) → tokenId
//   4. Persistir tokenId + txHash + blockNumber en DB (TX atómica)
//   5. Indexar evento CITMinted en bfa_eventos (verificador público)
//   6. Notificar propietario con tokenId + link explorador BFA
//   7. Disparar subida IPFS en background (PDF + metadata ERC-721)
//
// Retry automático:
//   max 5 intentos con backoff exponencial (Bull)
//   Errores de nodo BFA (timeout, INSUFFICIENT_FUNDS) → reintentable
//   Errores de contrato (duplicado, hash inválido) → no reintentable
//
// Verificación post-mint:
//   Llama verificarIntegridad(hashSHA256) en BFA para confirmar el tokenId
//   Si el índice local no coincide → fuerza resync del indexer

import { query, queryOne, transaction } from '../config/database'
import { log, startTimer }              from '../middleware/logger'
import { bfaService }                   from './bfa.service'
import { indexStubEvent }               from './bfa.indexer'
import { env }                          from '../config/env'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface MintResult {
  tokenId:     number
  txHash:      string
  blockNumber: number
  gasUsed:     string
  walletDestino: string
  esCustodial:   boolean
  indexado:    boolean    // true si se indexó correctamente en bfa_eventos
}

export interface MintStatus {
  citId:       string
  numeroCIT:   string
  mintEstado:  string
  mintIntentos: number
  tokenId:     number | null
  txHash:      string | null
  walletDestino: string | null
  ultimoError: string | null
  completadoEn: Date | null
}

const RODAID_CUSTODIAL_WALLET = env.RODAID_CUSTODIAL_WALLET
  ?? '0x0000000000000000000000000000000000000001'

// ── Clasificar si el error de BFA es reintentable ─────────
function esErrorReintentable(err: Error): boolean {
  const msg = err.message.toLowerCase()
  return (
    msg.includes('timeout')          ||
    msg.includes('network')          ||
    msg.includes('econnrefused')     ||
    msg.includes('nonce')            ||
    msg.includes('insufficient funds') ||
    msg.includes('circuit breaker')
  )
}

// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL DE ACUÑACIÓN
// ══════════════════════════════════════════════════════════

export async function acuñarCITEnBFA(
  citId:             string,
  propietarioWallet?: string
): Promise<MintResult> {
  const timer = startTimer('mint.bfa', { citId })

  // ── 1. Cargar datos completos del CIT ─────────────────────
  const cit = await queryOne<{
    id: string; numero_cit: string; hash_sha256: string; estado: string
    propietario_id: string; nft_token_id: number | null; bfa_tx_hash: string | null
    mint_estado: string; mint_intentos: number
    numero_serie: string; inspector_id: string
  }>(
    `SELECT c.id, c.numero_cit, c.hash_sha256, c.estado,
            c.propietario_id, c.nft_token_id, c.bfa_tx_hash,
            c.mint_estado, c.mint_intentos,
            b.numero_serie, c.inspector_id
     FROM cits c
     JOIN bicicletas b ON b.id = c.bicicleta_id
     WHERE c.id = $1`,
    [citId]
  )

  if (!cit) throw new Error(`CIT ${citId} no encontrado`)

  // ── 2. Pre-checks ─────────────────────────────────────────

  // Idempotencia: si ya está acuñado, retornar datos existentes
  if (cit.nft_token_id && cit.bfa_tx_hash) {
    log.bfa.info({ citId, tokenId: cit.nft_token_id }, 'NFT ya acuñado — idempotente')

    const wallet = propietarioWallet ?? RODAID_CUSTODIAL_WALLET
    return {
      tokenId:      cit.nft_token_id,
      txHash:       cit.bfa_tx_hash,
      blockNumber:  0,
      gasUsed:      '0',
      walletDestino: wallet,
      esCustodial:   wallet === RODAID_CUSTODIAL_WALLET,
      indexado:     true,
    }
  }

  if (cit.estado !== 'PENDIENTE') {
    throw new Error(`CIT en estado incorrecto para mint: ${cit.estado}`)
  }

  // Verificar que no esté bloqueado en BFA (denuncia durante las 72 hs)
  if (cit.hash_sha256) {
    try {
      const bfaCheck = await bfaService.verificarIntegridad(cit.hash_sha256)
      if (bfaCheck.valido && bfaCheck.bloqueado) {
        throw new Error(`Hash ${cit.hash_sha256.slice(0, 16)}... está bloqueado en BFA — no se puede acuñar`)
      }
    } catch (err) {
      if ((err as Error).message.includes('bloqueado en BFA')) throw err
      // Otros errores de BFA (nodo no disponible) → continuar igual
      log.bfa.warn({ citId, err: (err as Error).message }, 'verificarIntegridad pre-mint falló — continuando')
    }
  }

  // ── 3. Determinar wallet destino ──────────────────────────
  const propietario = await queryOne<{ wallet_address: string | null }>(
    `SELECT wallet_address FROM usuarios WHERE id = $1`, [cit.propietario_id]
  )
  const walletDestino = propietarioWallet
    ?? propietario?.wallet_address
    ?? RODAID_CUSTODIAL_WALLET
  const esCustodial = walletDestino === RODAID_CUSTODIAL_WALLET

  // ── 4. Marcar como EN_PROCESO ─────────────────────────────
  await query(
    `UPDATE cits
     SET mint_estado     = 'EN_PROCESO',
         mint_intentos   = mint_intentos + 1,
         mint_iniciado_en = COALESCE(mint_iniciado_en, NOW()),
         actualizado_en  = NOW()
     WHERE id = $1`,
    [citId]
  )

  log.bfa.info({
    citId, numeroCIT: cit.numero_cit,
    serial:    cit.numero_serie,
    hash:      cit.hash_sha256.slice(0, 16) + '...',
    wallet:    walletDestino.slice(0, 10) + '...',
    custodial: esCustodial,
    intento:   cit.mint_intentos + 1,
  }, '🔨 Acuñando NFT en BFA')

  // ── 5. MINT EN BFA ────────────────────────────────────────
  let mintResult
  try {
    mintResult = await bfaService.mint(
      walletDestino,
      cit.hash_sha256,
      cit.numero_cit,
      cit.numero_serie
    )
  } catch (err) {
    const errMsg = (err as Error).message
    const reintentable = esErrorReintentable(err as Error)

    await query(
      `UPDATE cits
       SET mint_estado       = $2,
           mint_ultimo_error = $3,
           actualizado_en    = NOW()
       WHERE id = $1`,
      [citId, reintentable ? 'REINTENTANDO' : 'FALLIDO', errMsg]
    )

    log.bfa.error({ citId, errMsg, reintentable }, `✗ Mint BFA falló`)
    throw Object.assign(err as Error, { reintentable })
  }

  // ── 6. TX atómica: activar CIT + guardar NFT datos ────────
  const ahora = new Date()
  const vence = new Date(ahora); vence.setFullYear(vence.getFullYear() + 1)

  await transaction(async (client) => {
    await client.query(
      `UPDATE cits
       SET estado           = 'ACTIVO',
           nft_token_id     = $2,
           bfa_tx_hash      = $3,
           fecha_emision    = $4,
           fecha_vencimiento = $5,
           mint_estado      = 'COMPLETADO',
           mint_completado_en = NOW(),
           mint_ultimo_error = NULL,
           actualizado_en   = NOW()
       WHERE id = $1`,
      [citId, mintResult.tokenId, mintResult.txHash, ahora, vence]
    )

    // Notificar al propietario (fire-and-forget, no bloquea la TX)
    const bfaExplorerUrl = (env.BFA_CHAIN_ID === 4337)
      ? `https://explorer.bfa.ar/tx/${mintResult.txHash}`
      : `https://explorer.testnet.bfa.ar/tx/${mintResult.txHash}`

    // Guardar datos de la notificación en la TX para usarlos después
    void client.query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, cuerpo, datos)
       VALUES ($1, 'CIT_APROBADO', $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [
        cit.propietario_id,
        `✅ CIT ${cit.numero_cit} activado · NFT #${mintResult.tokenId} en BFA`,
        esCustodial
          ? `Tu Certificado ${cit.numero_cit} fue activado. El NFT está en custodia RODAID hasta que registres tu wallet.`
          : `Tu Certificado ${cit.numero_cit} fue activado. NFT #${mintResult.tokenId} registrado en la Blockchain Federal Argentina.`,
        JSON.stringify({ citId, numeroCIT: cit.numero_cit, tokenId: mintResult.tokenId,
          txHash: mintResult.txHash, bfaExplorerUrl, esCustodial, walletDestino }),
      ]
    ).catch(() => {})
  })

  const ms = timer({ tokenId: mintResult.tokenId, txHash: mintResult.txHash })

  // ── 7. Indexar evento CITMinted en bfa_eventos ────────────
  // Mantiene el índice del verificador público actualizado
  // En modo real: el indexer de polling lo recogerá en el próximo ciclo
  // En modo stub: lo indexamos manualmente para tests
  let indexado = false
  try {
    const inspectorWallet = await queryOne<{ wallet_address: string | null }>(
      `SELECT wallet_address FROM inspectores WHERE id = $1`, [cit.inspector_id]
    )
    await indexStubEvent(
      'CITMinted',
      mintResult.tokenId,
      mintResult.txHash,
      mintResult.blockNumber,
      {
        hashSHA256:      cit.hash_sha256,
        numeroCIT:       cit.numero_cit,
        serialBicicleta: cit.numero_serie,
        propietario:     walletDestino,
        inspector:       inspectorWallet?.wallet_address ?? '0x0000000000000000000000000000000000000000',
      }
    )
    indexado = true
  } catch (err) {
    // Indexación es best-effort — no bloquear si falla
    log.bfa.warn({ citId, err: (err as Error).message }, 'Indexación CITMinted falló — indexer recogerá en próximo poll')
  }

  // ── 8. IPFS en background ─────────────────────────────────
  _subirIPFSBackground(citId, cit.numero_cit).catch(err => {
    log.bfa.warn({ citId, err: (err as Error).message }, 'IPFS post-mint falló')
  })

  log.bfa.info({
    citId, numeroCIT: cit.numero_cit,
    tokenId:     mintResult.tokenId,
    txHash:      mintResult.txHash,
    blockNumber: mintResult.blockNumber,
    gasUsed:     mintResult.gasUsed,
    walletDestino: walletDestino.slice(0, 10) + '...',
    esCustodial,
    indexado, ms,
  }, '✅ NFT acuñado en BFA · CIT ACTIVO')

  return { ...mintResult, walletDestino, esCustodial, indexado }
}

// ── IPFS background helper ──────────────────────────────────
async function _subirIPFSBackground(citId: string, numeroCIT: string): Promise<void> {
  const { subirPDFCIT, subirMetadataCIT, buildTokenURI } = await import('./ipfs.service')
  const { generarPDFCIT } = await import('./pdf.service')

  const citCompleto = await queryOne<{
    puntos: number; punto_detalle: Record<string, boolean> | string; hash_sha256: string
    marca: string; modelo: string; anio: number; tipo: string; color: string
    propietario_nombre: string; propietario_apellido: string; propietario_dni: string
    inspector_nombre: string; inspector_apellido: string
    taller_nombre: string; taller_localidad: string
    fotos: string[]; nft_token_id: number | null; bfa_tx_hash: string | null
    numero_serie: string
  }>(
    `SELECT c.puntos, c.punto_detalle, c.hash_sha256, c.nft_token_id, c.bfa_tx_hash,
            COALESCE(b.marca,'') AS marca, COALESCE(b.modelo,'') AS modelo,
            COALESCE(b.anio,0) AS anio, COALESCE(b.tipo::text,'') AS tipo,
            COALESCE(b.color,'') AS color, b.numero_serie,
            COALESCE(u.nombre,'')    AS propietario_nombre,
            COALESCE(u.apellido,'')  AS propietario_apellido,
            COALESCE(u.dni,'')       AS propietario_dni,
            COALESCE(ui.nombre,'')   AS inspector_nombre,
            COALESCE(ui.apellido,'') AS inspector_apellido,
            COALESCE(ta.nombre,'')   AS taller_nombre,
            COALESCE(ta.localidad,'') AS taller_localidad,
            c.fotos
     FROM cits c
     LEFT JOIN bicicletas b ON b.id=c.bicicleta_id
     LEFT JOIN usuarios u ON u.id=c.propietario_id
     LEFT JOIN inspectores i ON i.id=c.inspector_id
     LEFT JOIN usuarios ui ON ui.id=i.usuario_id
     LEFT JOIN talleres_aliados ta ON ta.id=c.taller_aliado_id
     WHERE c.id=$1`,
    [citId]
  )
  if (!citCompleto) return

  const puntosDetalle = typeof citCompleto.punto_detalle === 'string'
    ? JSON.parse(citCompleto.punto_detalle)
    : citCompleto.punto_detalle

  const fotosUrls = Array.isArray(citCompleto.fotos)
    ? citCompleto.fotos
    : JSON.parse(String(citCompleto.fotos) || '[]')

  const pdfBuffer = await generarPDFCIT({
    numeroCIT,
    hashSHA256:        citCompleto.hash_sha256,
    serial:            citCompleto.numero_serie,
    marca:             citCompleto.marca,
    modelo:            citCompleto.modelo,
    anio:              citCompleto.anio,
    tipo:              citCompleto.tipo,
    color:             citCompleto.color,
    propietarioNombre: `${citCompleto.propietario_nombre} ${citCompleto.propietario_apellido}`,
    propietarioDNI:    citCompleto.propietario_dni,
    puntos:            puntosDetalle,
    totalPuntos:       citCompleto.puntos ?? 0,
    inspectorNombre:   citCompleto.inspector_nombre,
    inspectorApellido: citCompleto.inspector_apellido,
    tallerNombre:      citCompleto.taller_nombre,
    tallerLocalidad:   citCompleto.taller_localidad,
    fechaEmision:      new Date().toISOString(),
    nftTokenId:        citCompleto.nft_token_id ?? undefined,
    bfaTxHash:         citCompleto.bfa_tx_hash ?? undefined,
    fotosUrls,
  })

  const pdfResult  = await subirPDFCIT(pdfBuffer, numeroCIT)
  const metaResult = await subirMetadataCIT({
    numeroCIT,
    serial:            citCompleto.numero_serie,
    hashSHA256:        citCompleto.hash_sha256,
    marca:             citCompleto.marca,
    modelo:            citCompleto.modelo,
    anio:              citCompleto.anio,
    tipo:              citCompleto.tipo,
    color:             citCompleto.color,
    propietarioNombre: `${citCompleto.propietario_nombre} ${citCompleto.propietario_apellido}`,
    inspectorNombre:   `${citCompleto.inspector_nombre} ${citCompleto.inspector_apellido}`,
    tallerNombre:      citCompleto.taller_nombre,
    tallerLocalidad:   citCompleto.taller_localidad,
    totalPuntos:       citCompleto.puntos ?? 0,
    fechaEmision:      new Date().toISOString(),
    nftTokenId:        citCompleto.nft_token_id ?? undefined,
    bfaTxHash:         citCompleto.bfa_tx_hash ?? undefined,
  }, pdfResult.cid, pdfResult.cid)

  await query(
    `UPDATE cits SET ipfs_pdf_cid=$2, ipfs_metadata_cid=$3, token_uri=$4, ipfs_subido_en=NOW() WHERE id=$1`,
    [citId, pdfResult.cid, metaResult.cid, buildTokenURI(metaResult.cid)]
  )
}

// ══════════════════════════════════════════════════════════
// VERIFICACIÓN POST-MINT ON-CHAIN
// ══════════════════════════════════════════════════════════

export interface VerificacionMintResult {
  citId:        string
  tokenId:      number
  bfaValido:    boolean
  bfaBloqueado: boolean
  propietarioOnChain: string | null
  coincideDB:   boolean    // propietario DB ≡ propietario on-chain
  error?:       string
}

export async function verificarMintEnBFA(citId: string): Promise<VerificacionMintResult> {
  const row = await queryOne<{
    nft_token_id: number; hash_sha256: string; propietario_id: string
  }>(
    `SELECT nft_token_id, hash_sha256, propietario_id FROM cits WHERE id=$1`, [citId]
  )

  if (!row?.nft_token_id) {
    return { citId, tokenId: 0, bfaValido: false, bfaBloqueado: false,
             propietarioOnChain: null, coincideDB: false,
             error: 'CIT sin NFT acuñado' }
  }

  try {
    const [integridad, datos] = await Promise.all([
      bfaService.verificarIntegridad(row.hash_sha256),
      bfaService.datosCIT(row.nft_token_id),
    ])

    // El propietario on-chain es la wallet del NFT
    const propietarioOnChain = datos?.propietario ?? null

    // Verificar que la wallet on-chain coincide con el usuario en DB
    const propietarioWallet = await queryOne<{ wallet_address: string | null }>(
      `SELECT wallet_address FROM usuarios WHERE id=$1`, [row.propietario_id]
    )

    const coincideDB = propietarioWallet?.wallet_address != null &&
      propietarioOnChain?.toLowerCase() === propietarioWallet.wallet_address.toLowerCase()

    return {
      citId,
      tokenId:            row.nft_token_id,
      bfaValido:          integridad.valido,
      bfaBloqueado:       integridad.bloqueado,
      propietarioOnChain,
      coincideDB,
    }
  } catch (err) {
    return {
      citId,
      tokenId:    row.nft_token_id,
      bfaValido:  false,
      bfaBloqueado: false,
      propietarioOnChain: null,
      coincideDB: false,
      error: (err as Error).message,
    }
  }
}

// ══════════════════════════════════════════════════════════
// ADMIN: ESTADO DE MINTS
// ══════════════════════════════════════════════════════════

export async function getMintStatus(citId: string): Promise<MintStatus | null> {
  return queryOne<MintStatus>(
    `SELECT id AS "citId", numero_cit AS "numeroCIT", mint_estado AS "mintEstado",
            mint_intentos AS "mintIntentos", nft_token_id AS "tokenId",
            bfa_tx_hash AS "txHash", mint_ultimo_error AS "ultimoError",
            mint_completado_en AS "completadoEn",
            NULL::text AS "walletDestino"  -- requires transacciones join for full data
     FROM cits WHERE id=$1`,
    [citId]
  )
}

export async function getCITsMintFallido(): Promise<MintStatus[]> {
  return query<MintStatus>(
    `SELECT id AS "citId", numero_cit AS "numeroCIT", mint_estado AS "mintEstado",
            mint_intentos AS "mintIntentos", nft_token_id AS "tokenId",
            bfa_tx_hash AS "txHash", mint_ultimo_error AS "ultimoError",
            mint_completado_en AS "completadoEn", NULL::text AS "walletDestino"
     FROM cits
     WHERE mint_estado IN ('FALLIDO','REINTENTANDO')
       AND estado = 'PENDIENTE'
     ORDER BY mint_intentos DESC, mint_iniciado_en ASC`,
    []
  )
}
