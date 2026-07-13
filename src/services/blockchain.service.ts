import { createHash } from 'node:crypto'
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  isAddress,
  keccak256,
  toUtf8Bytes,
  type TransactionReceipt,
} from 'ethers'
import { getPool, type DbClient } from '@/lib/marketplace'

/**
 * RODAID — Hito 4: Anclaje de Identidad en la BFA (Blockchain Federal Argentina).
 *
 * Conecta el backend con el nodo RPC de la BFA (vía ethers.js) y ancla la
 * identidad verificada de cada bici minteando un NFT en el contrato ERC-721
 * `RodaidCIT` (ver `contracts/RodaidCIT.sol`).
 *
 *   anclarCIT(citId, hash, serial)
 *     a. Carga la wallet privada del backend (process.env.BFA_PRIVATE_KEY).
 *     b. Firma y envía la transacción `mintCIT(to, tokenId, hash)` al contrato.
 *     c. Guarda el `tx_hash` (y el tokenId) en la tabla `cits`.
 *
 * Diseño:
 *  - ASINCRONO Y NO BLOQUEANTE. El anclaje nunca bloquea el flujo del usuario:
 *    se ejecuta como side-effect best-effort tras aprobar el CIT (en el worker
 *    de validación) y se puede reintentar desde un barrido. Si la red BFA tiene
 *    latencia o está caída, el CIT igual queda 'activo'; solo su `bfa_estado`
 *    queda 'PENDIENTE'/'ERROR' para reintentar.
 *  - MANEJO DE REVERTS. Las transacciones revertidas (token ya minteado, gas,
 *    permisos) se detectan (receipt.status === 0 o error CALL_EXCEPTION) y se
 *    registran sin tirar abajo la aprobación del CIT.
 *  - MODO. Igual que MercadoPago: sin credenciales de BFA opera en STUB (simula
 *    un anclaje determinístico) para poder ejercitar el flujo en preview; con
 *    RPC + clave privada + dirección de contrato, opera ONCHAIN real.
 */

// ── Configuración / modo ─────────────────────────────────────────────────────

export type BfaModo = 'ONCHAIN' | 'STUB'

/** ABI mínimo del contrato RodaidCIT que usa el backend (mint + lock + lectura). */
const RODAID_CIT_ABI = [
  'function mintCIT(address to, uint256 serial, string hashSHA256)',
  'function lockCIT(uint256 serial)',
  'function unlockCIT(uint256 serial)',
  'function citHash(uint256 serial) view returns (string)',
  'function locked(uint256 serial) view returns (bool)',
  'function minter() view returns (address)',
  'event CITAnchored(uint256 indexed serial, address indexed to, string hashSHA256)',
  'event CITLocked(uint256 indexed serial)',
  'event CITUnlocked(uint256 indexed serial)',
] as const

// Reintentos antes de marcar el anclaje como 'error' (dead-letter para revisión).
const MAX_INTENTOS_ANCLAJE = 5

function rpcUrl(): string | null {
  const raw = process.env.BFA_RPC_URL
  return raw && raw.trim().length > 0 ? raw.trim() : null
}

function privateKey(): string | null {
  const raw = process.env.BFA_PRIVATE_KEY
  return raw && raw.trim().length > 0 ? raw.trim() : null
}

/**
 * Clave privada del owner del contrato (admin de RODAID), usada para las
 * acciones lock/unlock de robo. Si no hay una específica, se reutiliza la del
 * backend (en despliegues donde minter y owner son la misma wallet).
 */
function ownerPrivateKey(): string | null {
  const raw = process.env.BFA_OWNER_PRIVATE_KEY
  if (raw && raw.trim().length > 0) return raw.trim()
  return privateKey()
}

function contractAddress(): string | null {
  const raw = process.env.BFA_CIT_CONTRACT
  if (!raw || raw.trim().length === 0 || !isAddress(raw.trim())) {
    return null
  }
  return getAddress(raw.trim())
}

/**
 * Determina el modo de operación. ONCHAIN solo si están las tres piezas
 * necesarias (RPC, clave privada y dirección del contrato); si falta alguna,
 * STUB (anclaje simulado) para no romper los entornos sin credenciales.
 */
export function getBfaModo(): BfaModo {
  return rpcUrl() && privateKey() && contractAddress() ? 'ONCHAIN' : 'STUB'
}

/**
 * Wallet de custodia que recibe el NFT del CIT. Mientras no exista el sistema
 * de cuentas con wallets de usuario (hito posterior), el NFT se mintea a una
 * wallet de custodia del backend; cuando exista, se reemplaza por la del dueño.
 */
function custodyAddress(wallet: Wallet): string {
  const configured = process.env.BFA_CIT_CUSTODY_WALLET
  if (configured && isAddress(configured.trim())) {
    return getAddress(configured.trim())
  }
  return wallet.address
}

// ── tokenId determinístico a partir del número de serie ──────────────────────

const UINT256_MASK = BigInt(2) ** BigInt(256) - BigInt(1)

/**
 * Convierte el número de serie de la bici en el `tokenId` (uint256) del NFT.
 * Si el serial ya es puramente numérico se usa tal cual; si es alfanumérico se
 * deriva determinísticamente con keccak256. Siempre devuelve el mismo tokenId
 * para el mismo serial, de modo que re-anclar revierte on-chain (unicidad).
 */
export function serialToTokenId(serial: string | number | bigint): bigint {
  if (typeof serial === 'bigint') {
    return serial & UINT256_MASK
  }
  if (typeof serial === 'number' && Number.isInteger(serial) && serial >= 0) {
    return BigInt(serial) & UINT256_MASK
  }
  const texto = String(serial).trim()
  if (/^\d+$/.test(texto)) {
    return BigInt(texto) & UINT256_MASK
  }
  // Alfanumérico: keccak256(utf8(serial)) -> uint256.
  return BigInt(keccak256(toUtf8Bytes(texto))) & UINT256_MASK
}

// ── Resultado ────────────────────────────────────────────────────────────────

export interface AnclajeResultado {
  citId: string
  estado: 'ACUNADO' | 'PENDIENTE' | 'ERROR' | 'OMITIDO'
  modo: BfaModo
  txHash: string | null
  tokenId: string | null
  motivo?: string
}

interface CitAnclajeRow {
  id: string
  bfa_estado: string
  bfa_tx_hash: string | null
  bfa_intentos: number
}

function esRevert(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: string }).code
  return (
    code === 'CALL_EXCEPTION' ||
    code === 'UNPREDICTABLE_GAS_LIMIT' ||
    code === 'INSUFFICIENT_FUNDS' ||
    code === 'NONCE_EXPIRED' ||
    code === 'REPLACEMENT_UNDERPRICED'
  )
}

function mensajeError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const e = error as { shortMessage?: string; reason?: string; message?: string }
    return e.shortMessage ?? e.reason ?? e.message ?? String(error)
  }
  return String(error)
}

// ── anclarCIT ────────────────────────────────────────────────────────────────

/**
 * Ancla un CIT en la BFA: mintea su NFT y guarda el tx_hash en `cits`.
 *
 * Best-effort y no bloqueante: nunca lanza. Devuelve un `AnclajeResultado` con
 * el desenlace (anclado / pendiente para reintentar / error / omitido). Es
 * idempotente: si el CIT ya fue anclado, no vuelve a mintear.
 */
export async function anclarCIT(
  citId: string,
  hash: string,
  serial: string | number | bigint
): Promise<AnclajeResultado> {
  const modo = getBfaModo()
  const tokenId = serialToTokenId(serial)

  // 1. Idempotencia + claim: solo seguimos si el CIT existe y no está anclado.
  const claim = await reclamarAnclaje(citId)
  if (claim === 'no-existe') {
    return { citId, estado: 'OMITIDO', modo, txHash: null, tokenId: null, motivo: 'CIT inexistente' }
  }
  if (claim === 'ya-anclado') {
    return { citId, estado: 'ACUNADO', modo, txHash: null, tokenId: tokenId.toString(), motivo: 'Ya estaba anclado' }
  }

  try {
    let txHash: string

    if (modo === 'STUB') {
      // Anclaje simulado determinístico (preview sin credenciales de BFA).
      txHash = txHashSimulado(citId, hash, tokenId)
    } else {
      txHash = await mintearOnchain(tokenId, hash)
    }

    await marcarAnclado(citId, txHash, tokenId, modo)
    console.info(`[bfa:${modo}] CIT ${citId} anclado tokenId=${tokenId} tx=${txHash}`)
    return { citId, estado: 'ACUNADO', modo, txHash, tokenId: tokenId.toString() }
  } catch (error) {
    const motivo = mensajeError(error)
    const revert = esRevert(error)
    const estadoFinal = await registrarFalloAnclaje(citId, motivo)
    console.error(
      `[bfa:${modo}] fallo el anclaje del CIT ${citId} (${revert ? 'REVERT' : 'ERROR'}): ${motivo}`
    )
    return {
      citId,
      estado: estadoFinal,
      modo,
      txHash: null,
      tokenId: tokenId.toString(),
      motivo,
    }
  }
}

/**
 * Envía la transacción de minteo al contrato y espera su confirmación.
 * Lanza si la transacción revierte (receipt.status === 0) o si ethers reporta
 * un CALL_EXCEPTION, para que `anclarCIT` lo registre como fallo.
 */
async function mintearOnchain(tokenId: bigint, hash: string): Promise<string> {
  const provider = new JsonRpcProvider(rpcUrl()!)
  const wallet = new Wallet(privateKey()!, provider)
  const contract = new Contract(contractAddress()!, RODAID_CIT_ABI, wallet)
  const to = custodyAddress(wallet)

  // Firma y envía la transacción (no bloquea: await sobre I/O de red).
  const tx = await contract.mintCIT(to, tokenId, hash)
  const receipt: TransactionReceipt | null = await tx.wait()

  // Transacción revertida: status 0 (o receipt nulo).
  if (!receipt || receipt.status === 0) {
    throw Object.assign(new Error('La transacción de minteo fue revertida.'), {
      code: 'CALL_EXCEPTION',
    })
  }
  return receipt.hash
}

/** tx_hash determinístico para el modo STUB (32 bytes hex, formato 0x...). */
function txHashSimulado(citId: string, hash: string, tokenId: bigint): string {
  const digest = createHash('sha256')
    .update(`${citId}:${hash}:${tokenId.toString()}`)
    .digest('hex')
  return `0x${digest}`
}

// ── Persistencia en `cits` ───────────────────────────────────────────────────

type ClaimResultado = 'reclamado' | 'ya-anclado' | 'no-existe'

/**
 * Reclama el anclaje de un CIT de forma atómica: pasa `bfa_estado` a
 * 'PENDIENTE' (reusado tambien como marca de claim -- este sistema no tiene
 * concurrencia real entre workers, asi que no hace falta un estado
 * intermedio propio) solo si todavia no fue anclado. El lock `FOR UPDATE`
 * es lo que realmente evita que dos procesos ancles el mismo CIT a la vez.
 *
 * IMPORTANTE: los valores del enum real `cit_bfa_estado` son en MAYUSCULA
 * (NO_INICIADA/PENDIENTE/ACUNADO/ERROR/FALLIDO) -- confirmado 2026-07-11 via
 * un deploy fallido (22P02) y verificado empiricamente contra produccion
 * (los 3 CIT existentes estaban en NO_INICIADA, con bfa_tx_hash e intentos
 * en cero: el anclaje nunca habia escrito con exito ni una sola vez, porque
 * este archivo escribia en minuscula contra un enum que nunca tuvo esos
 * valores).
 */
async function reclamarAnclaje(citId: string): Promise<ClaimResultado> {
  return withTx(async (client) => {
    const res = await client.query<CitAnclajeRow>(
      `SELECT id, bfa_estado, bfa_tx_hash, bfa_intentos FROM cits WHERE id = $1 FOR UPDATE`,
      [citId]
    )
    const cit = res.rows[0]
    if (!cit) return 'no-existe'
    if (cit.bfa_estado === 'ACUNADO' || cit.bfa_tx_hash) return 'ya-anclado'

    await client.query(
      `UPDATE cits SET bfa_estado = 'PENDIENTE', bfa_intentos = bfa_intentos + 1, updated_at = NOW() WHERE id = $1`,
      [citId]
    )
    return 'reclamado'
  })
}

async function marcarAnclado(citId: string, txHash: string, tokenId: bigint, modo: BfaModo) {
  await getPool().query(
    `
      UPDATE cits
      SET bfa_estado = 'ACUNADO',
          bfa_tx_hash = $2,
          bfa_token_id = $3,
          bfa_modo = $5,
          bfa_anclado_en = NOW(),
          bfa_ultimo_error = NULL,
          metadata_json = metadata_json || $4::jsonb,
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      citId,
      txHash,
      tokenId.toString(),
      JSON.stringify({ bfa: { txHash, tokenId: tokenId.toString(), ancladoEn: new Date().toISOString() } }),
      modo,
    ]
  )
}

/**
 * Registra un fallo de anclaje. Vuelve a 'PENDIENTE' para reintentar, salvo
 * que se hayan agotado los intentos, en cuyo caso queda en 'ERROR' (dead-letter).
 */
async function registrarFalloAnclaje(
  citId: string,
  motivo: string
): Promise<'PENDIENTE' | 'ERROR'> {
  return withTx(async (client) => {
    const res = await client.query<CitAnclajeRow>(
      `SELECT id, bfa_estado, bfa_tx_hash, bfa_intentos FROM cits WHERE id = $1 FOR UPDATE`,
      [citId]
    )
    const cit = res.rows[0]
    if (!cit) return 'ERROR'
    const estadoFinal = cit.bfa_intentos >= MAX_INTENTOS_ANCLAJE ? 'ERROR' : 'PENDIENTE'
    await client.query(
      `UPDATE cits SET bfa_estado = $2, bfa_ultimo_error = $3, updated_at = NOW() WHERE id = $1`,
      [citId, estadoFinal, motivo.slice(0, 500)]
    )
    return estadoFinal
  })
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

// ── Reintento en segundo plano / barrido ─────────────────────────────────────

/**
 * Dispara el anclaje sin esperar el resultado (fire-and-forget). Pensado para
 * usarse tras aprobar un CIT, de modo que la respuesta al usuario no quede
 * atada a la latencia de la BFA. Captura cualquier error.
 */
export function anclarCITEnSegundoPlano(
  citId: string,
  hash: string,
  serial: string | number | bigint
): void {
  void anclarCIT(citId, hash, serial).catch((error) => {
    console.error('[bfa] error no controlado en anclaje en segundo plano', citId, error)
  })
}

interface CitPendienteRow {
  id: string
  hash_sha256: string | null
  numero_serie: string
}

/**
 * Barre los CITs aprobados que todavía no se anclaron (o quedaron pendientes de
 * reintento) y reintenta el anclaje. Incluye 'NO_INICIADA' (el default de todo
 * CIT nuevo, nunca reclamado todavia) ademas de 'PENDIENTE' (reintento) --
 * sin esto, un CIT cuyo disparo fire-and-forget post-aprobacion falle antes de
 * llegar al claim queda huerfano para siempre, porque nunca llega a
 * 'PENDIENTE'. Pensado para un endpoint de sistema / Scheduled Function.
 * Procesa secuencialmente para no saturar el nodo RPC.
 */
export async function anclarPendientes(limite = 25): Promise<{
  encontrados: number
  anclados: number
  fallidos: number
  resultados: AnclajeResultado[]
}> {
  const res = await getPool().query<CitPendienteRow>(
    `
      SELECT c.id, c.hash_sha256, b.numero_serie
      FROM cits c
      JOIN bicicletas b ON b.id = c.bicicleta_id
      WHERE c.estado = 'activo'
        AND c.hash_sha256 IS NOT NULL
        AND c.bfa_estado IN ('NO_INICIADA', 'PENDIENTE')
      ORDER BY c.updated_at ASC
      LIMIT $1
    `,
    [limite]
  )

  const resultados: AnclajeResultado[] = []
  for (const row of res.rows) {
    resultados.push(await anclarCIT(row.id, row.hash_sha256!, row.numero_serie))
  }

  return {
    encontrados: res.rows.length,
    anclados: resultados.filter((r) => r.estado === 'ACUNADO').length,
    fallidos: resultados.filter((r) => r.estado === 'ERROR' || r.estado === 'PENDIENTE').length,
    resultados,
  }
}

// ── Verificacion de coincidencia del hash con la BFA ─────────────────────────

export interface VerificacionHashBFA {
  /** El hash del CIT coincide con el registro anclado en la BFA. */
  coincide: boolean
  modo: BfaModo
  tokenId: string
  /** Hash leido de la cadena (ONCHAIN) o el esperado confirmado (STUB). */
  hashOnchain: string | null
  motivo?: string
}

/**
 * Verifica si la huella SHA-256 de un CIT coincide con la registrada en la BFA.
 *
 * - ONCHAIN: lee `citHash(tokenId)` del contrato y lo compara con el hash
 *   esperado (el almacenado en `cits.hash_sha256`). Es la verificacion fuerte:
 *   confirma que lo anclado en la cadena es exactamente la identidad de la bici.
 * - STUB (preview sin credenciales de BFA): no hay cadena que consultar; se
 *   considera coincidente cuando hay un hash anclado, reproduciendo el veredicto
 *   end-to-end.
 *
 * Best-effort: nunca lanza. Ante un error de red devuelve `coincide: false` con
 * el motivo, para que el verificador publico no se caiga por la BFA.
 */
export async function verificarHashEnBFA(
  serial: string | number | bigint,
  hashEsperado: string | null,
  opciones: { ancladoEnDb?: boolean } = {}
): Promise<VerificacionHashBFA> {
  const modo = getBfaModo()
  const tokenId = serialToTokenId(serial)

  if (!hashEsperado) {
    return { coincide: false, modo, tokenId: tokenId.toString(), hashOnchain: null, motivo: 'El CIT no tiene huella SHA-256.' }
  }

  if (modo === 'STUB') {
    // Sin cadena real: el anclaje registrado en la base es la fuente de verdad.
    const coincide = opciones.ancladoEnDb === true
    return {
      coincide,
      modo,
      tokenId: tokenId.toString(),
      hashOnchain: coincide ? hashEsperado : null,
      motivo: coincide ? undefined : 'Todavia no anclado en la BFA.',
    }
  }

  try {
    const provider = new JsonRpcProvider(rpcUrl()!)
    const contract = new Contract(contractAddress()!, RODAID_CIT_ABI, provider)
    const onchain = (await contract.citHash(tokenId)) as string
    const coincide =
      typeof onchain === 'string' &&
      onchain.length > 0 &&
      onchain.toLowerCase() === hashEsperado.toLowerCase()
    return {
      coincide,
      modo,
      tokenId: tokenId.toString(),
      hashOnchain: onchain || null,
      motivo: coincide ? undefined : 'El hash on-chain no coincide o aun no fue minteado.',
    }
  } catch (error) {
    return {
      coincide: false,
      modo,
      tokenId: tokenId.toString(),
      hashOnchain: null,
      motivo: mensajeError(error),
    }
  }
}

// ── Lock / Unlock: marcar una bici como 'denunciada' (robo) ──────────────────

export interface DenunciaResultado {
  serial: string | number | bigint
  tokenId: string
  accion: 'lock' | 'unlock'
  modo: BfaModo
  txHash: string | null
  ok: boolean
  motivo?: string
}

/**
 * Marca (lock) o levanta (unlock) la denuncia de una bici en la BFA. Congela el
 * NFT del CIT para que no pueda transferirse mientras esté reportada como
 * robada. Es una acción del owner del contrato (admin de RODAID).
 *
 * Best-effort: nunca lanza. En STUB simula la transacción.
 */
export async function fijarDenunciaBFA(
  serial: string | number | bigint,
  bloquear: boolean
): Promise<DenunciaResultado> {
  const modo = getBfaModo()
  const tokenId = serialToTokenId(serial)
  const accion = bloquear ? 'lock' : 'unlock'

  try {
    let txHash: string
    if (modo === 'STUB') {
      txHash = txHashSimulado(`denuncia:${accion}`, '', tokenId)
    } else {
      const provider = new JsonRpcProvider(rpcUrl()!)
      const wallet = new Wallet(ownerPrivateKey()!, provider)
      const contract = new Contract(contractAddress()!, RODAID_CIT_ABI, wallet)
      const tx = bloquear
        ? await contract.lockCIT(tokenId)
        : await contract.unlockCIT(tokenId)
      const receipt: TransactionReceipt | null = await tx.wait()
      if (!receipt || receipt.status === 0) {
        throw Object.assign(new Error('La transacción de lock/unlock fue revertida.'), {
          code: 'CALL_EXCEPTION',
        })
      }
      txHash = receipt.hash
    }
    console.info(`[bfa:${modo}] ${accion} tokenId=${tokenId} tx=${txHash}`)
    return { serial, tokenId: tokenId.toString(), accion, modo, txHash, ok: true }
  } catch (error) {
    const motivo = mensajeError(error)
    console.error(`[bfa:${modo}] fallo ${accion} tokenId=${tokenId}: ${motivo}`)
    return { serial, tokenId: tokenId.toString(), accion, modo, txHash: null, ok: false, motivo }
  }
}

