// ─── RODAID · BFA Service — Signing con ethers.js ────────
//
// Dos modos según variables de entorno:
//   REAL → BFAServiceReal (ethers.js + wallet privada + nodo BFA ONTI)
//   STUB → BFAServiceStub (SHA-256 real, transacciones en memoria)
//
// BFAServiceReal implementa:
//   · NonceManager       → evita conflictos de nonce en requests concurrentes
//   · GasStrategy        → estima gas + buffer, detecta EIP-1559 vs legacy
//   · EventParser        → extrae tokenId del evento CITMinted
//   · HealthMonitor      → balance wallet, conexión al nodo, estado del contrato
//   · ErrorClassifier    → distingue revertion, timeout, gas insuficiente
//   · CircuitBreaker     → pausa envío de txs si el nodo está caído
//
// Selección automática:
//   hasRealConfig → BFAServiceReal (producción / testnet con nodo ONTI)
//   sin config    → BFAServiceStub (desarrollo / CI)

import { ethers }   from 'ethers'
import crypto       from 'crypto'
import { env }      from '../config/env'
import { log, startTimer } from '../middleware/logger'
import { BFAMintResult }   from '../types'

// ══════════════════════════════════════════════════════════
// ABI DEL CONTRATO
// ══════════════════════════════════════════════════════════

const CIT_ABI = [
  'function mint(address propietario, string calldata hashSHA256, string calldata numeroCIT, string calldata serialBicicleta) external returns (uint256)',
  'function bloquear(uint256 tokenId, string calldata motivo) external',
  'function desbloquear(uint256 tokenId) external',
  'function transferirCIT(uint256 tokenId, address nuevoPropietario) external',
  'function datosCIT(uint256 tokenId) external view returns (string hashSHA256, string numeroCIT, string serialBicicleta, address propietario, bool bloqueado, string motivoBloqueo, uint256 emitidoEn, uint256 bloqueadoEn, address inspector)',
  'function tokenPorHash(string calldata hashSHA256) external view returns (uint256)',
  'function tokenPorNumero(string calldata numeroCIT) external view returns (uint256)',
  'function historialPorSerial(string calldata serial) external view returns (uint256[])',
  'function verificarIntegridad(string calldata hashSHA256) external view returns (bool valido, bool bloqueado, uint256 tokenId)',
  'function totalEmitidos() external view returns (uint256)',
  'function paused() external view returns (bool)',
  'function operator() external view returns (address)',
  'function owner() external view returns (address)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) external view returns (bool)',
  'event CITMinted(uint256 indexed tokenId, address indexed propietario, address indexed inspector, string hashSHA256, string numeroCIT, string serialBicicleta)',
  'event CITBloqueado(uint256 indexed tokenId, string motivo, uint256 timestamp)',
  'event CITDesbloqueado(uint256 indexed tokenId, uint256 timestamp)',
  'event CITTransferido(uint256 indexed tokenId, address indexed de, address indexed para, string numeroCIT)',
]

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

export function hashCIT(content: string | Buffer): string {
  return crypto.createHash('sha256')
    .update(typeof content === 'string' ? Buffer.from(content, 'utf8') : content)
    .digest('hex')
}

export function isValidSHA256(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash)
}

// Clasificar errores de ethers.js para mensajes claros al usuario
function classifyBFAError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err)
  if (msg.includes('INSUFFICIENT_FUNDS') || msg.includes('insufficient funds')) {
    return `Saldo insuficiente en wallet BFA. Contactar a ONTI para recargar fondos.`
  }
  if (msg.includes('nonce too low') || msg.includes('NONCE_EXPIRED')) {
    return `Conflicto de nonce — reintentar en unos segundos.`
  }
  if (msg.includes('already known') || msg.includes('replacement fee too low')) {
    return `Transacción duplicada o precio de gas insuficiente para reemplazo.`
  }
  if (msg.includes('execution reverted') || msg.includes('reverted')) {
    // Extraer el mensaje de revert si es posible
    const revertMatch = msg.match(/reverted[^:]*:\s*(.+?)(?:$|\n)/)
    return `Contrato rechazó la transacción: ${revertMatch?.[1] ?? msg.slice(0, 100)}`
  }
  if (msg.includes('timeout') || msg.includes('TIMEOUT') || msg.includes('NETWORK_ERROR')) {
    return `Timeout conectando al nodo BFA. El nodo puede estar caído.`
  }
  if (msg.includes('network changed') || msg.includes('underlying network changed')) {
    return `Red BFA cambió — reconectar.`
  }
  return msg.slice(0, 200)
}

// ══════════════════════════════════════════════════════════
// NONCE MANAGER — evita conflictos en requests concurrentes
// ══════════════════════════════════════════════════════════

class NonceManager {
  private nonce:   number | null = null
  private pending: number        = 0          // txs en vuelo
  private lock:    Promise<void> = Promise.resolve()

  constructor(private wallet: ethers.Wallet) {}

  /** Obtiene el próximo nonce de forma segura bajo concurrencia */
  async nextNonce(): Promise<number> {
    // Serializar el acceso para evitar dos txs con el mismo nonce
    let resolve!: () => void
    const prevLock = this.lock
    this.lock = new Promise(r => { resolve = r })

    await prevLock

    try {
      if (this.nonce === null || this.pending === 0) {
        // Obtener nonce actual de la red (fuente de verdad)
        this.nonce = await this.wallet.getNonce('pending')
      }
      const n = this.nonce
      this.nonce++
      this.pending++
      return n
    } finally {
      resolve()
    }
  }

  /** Llamar cuando la tx confirma o falla */
  txConfirmed() {
    this.pending = Math.max(0, this.pending - 1)
  }

  /** Resetear en caso de error de nonce */
  async reset() {
    this.nonce   = null
    this.pending = 0
    log.bfa.warn('NonceManager: nonce reseteado — reconectando con la red')
  }
}

// ══════════════════════════════════════════════════════════
// GAS STRATEGY — precio de gas óptimo
// ══════════════════════════════════════════════════════════

const GAS_BUFFER_PCT   = 20n   // +20% sobre la estimación
const GAS_LIMIT_MAX    = 500_000n
const GAS_PRICE_BUMP   = 110n  // 10% bump en reenvíos

async function estimateGasWithBuffer(
  provider: ethers.JsonRpcProvider,
  tx: ethers.TransactionRequest
): Promise<bigint> {
  try {
    const estimated = await provider.estimateGas(tx)
    const withBuffer = estimated * (100n + GAS_BUFFER_PCT) / 100n
    return withBuffer < GAS_LIMIT_MAX ? withBuffer : GAS_LIMIT_MAX
  } catch {
    log.bfa.warn('Gas estimation falló — usando límite por defecto')
    return 200_000n
  }
}

async function getFeeData(provider: ethers.JsonRpcProvider): Promise<{
  gasPrice?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  isEIP1559: boolean
}> {
  const feeData = await provider.getFeeData()

  // BFA usa PoA Ethereum — detectar soporte EIP-1559
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    return {
      maxFeePerGas:         feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      isEIP1559: true,
    }
  }

  // Legacy gas price (PoA networks como BFA)
  return {
    gasPrice:  feeData.gasPrice ?? 1_000_000_000n,
    isEIP1559: false,
  }
}

// ══════════════════════════════════════════════════════════
// CIRCUIT BREAKER — pausa envíos si el nodo está caído
// ══════════════════════════════════════════════════════════

class CircuitBreaker {
  private failures    = 0
  private lastFailure = 0
  private readonly THRESHOLD     = 5    // fallos consecutivos para abrir el circuito
  private readonly RESET_TIME_MS = 60_000  // 1 min de espera antes de reintentar

  canSend(): boolean {
    if (this.failures < this.THRESHOLD) return true
    if (Date.now() - this.lastFailure > this.RESET_TIME_MS) {
      this.failures = 0
      return true
    }
    return false
  }

  onSuccess() { this.failures = 0 }

  onFailure() {
    this.failures++
    this.lastFailure = Date.now()
    if (this.failures >= this.THRESHOLD) {
      log.bfa.error({ failures: this.failures }, '🔴 Circuit breaker ABIERTO — demasiados errores BFA consecutivos')
    }
  }

  isOpen() { return this.failures >= this.THRESHOLD }
}

// ══════════════════════════════════════════════════════════
// BFA SERVICE REAL — producción con wallet privada
// ══════════════════════════════════════════════════════════

interface DatosCIT {
  hashSHA256: string; numeroCIT: string; serialBicicleta: string
  propietario: string; bloqueado: boolean; motivoBloqueo: string
  emitidoEn: number; bloqueadoEn: number; inspector: string
}

class BFAServiceReal {
  private readonly provider:  ethers.JsonRpcProvider
  private readonly wallet:    ethers.Wallet
  private readonly contract:  ethers.Contract
  private readonly nonces:    NonceManager
  private readonly breaker:   CircuitBreaker
  readonly walletAddress:     string
  private readonly chainId:   number
  private readonly confirmations: number

  constructor() {
    const rpcUrl     = (env.BFA_RPC_URL ?? env.BFA_TESTNET_RPC_URL)!
    this.chainId     = env.BFA_CHAIN_ID ?? 4337
    this.confirmations = this.chainId === 4337 ? 3 : 1  // mainnet más confirmaciones

    this.provider = new ethers.JsonRpcProvider(rpcUrl, {
      chainId: this.chainId,
      name:    this.chainId === 4337 ? 'bfa' : 'bfa-testnet',
    })

    this.wallet   = new ethers.Wallet(env.BFA_WALLET_PRIVATE_KEY!, this.provider)
    this.contract = new ethers.Contract(env.BFA_CONTRACT_ADDRESS!, CIT_ABI, this.wallet)
    this.nonces   = new NonceManager(this.wallet)
    this.breaker  = new CircuitBreaker()
    this.walletAddress = this.wallet.address

    this.provider.on('error', (err) => {
      log.bfa.error({ err: err.message }, 'Provider error — nonce manager reseteado')
      this.nonces.reset()
    })

    log.bfa.info({
      wallet:   this.walletAddress,
      contract: env.BFA_CONTRACT_ADDRESS!.slice(0, 10) + '...',
      chainId:  this.chainId,
      rpc:      rpcUrl.replace(/\/\/.*@/, '//***@'),  // ocultar credenciales en URL
    }, '✓ BFAServiceReal inicializado')
  }

  // ── Enviar transacción con nonce manager + circuit breaker ──
  private async sendTx(
    method: string,
    args: unknown[],
    logCtx: Record<string, unknown>
  ): Promise<ethers.TransactionReceipt> {
    if (this.breaker.isOpen()) {
      throw new Error(`BFA circuit breaker abierto — demasiados errores consecutivos. Reintentar en 1 min.`)
    }

    const timer = startTimer(`bfa.${method}`, logCtx)
    const nonce = await this.nonces.nextNonce()

    log.bfa.info({ method, nonce, ...logCtx }, `BFA: enviando ${method}`)

    try {
      // Construir tx para estimación de gas
      const txReq = await (this.contract[method] as ethers.ContractMethod)(...args)

      // Obtener gas + fee data
      const feeData    = await getFeeData(this.provider)
      const gasLimit   = await estimateGasWithBuffer(this.provider, {
        to:   await this.contract.getAddress(),
        data: (await this.contract[method].populateTransaction(...args)).data,
        from: this.walletAddress,
      })

      // Enviar transacción firmada
      const tx: ethers.ContractTransactionResponse = await (this.contract[method] as ethers.ContractMethod).send(
        ...args,
        {
          nonce,
          gasLimit,
          ...(feeData.isEIP1559
            ? { maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas }
            : { gasPrice: feeData.gasPrice }
          ),
        }
      )

      log.bfa.debug({ method, txHash: tx.hash, nonce, gasLimit: gasLimit.toString() }, 'TX enviada')

      // Esperar confirmaciones
      const receipt = await tx.wait(this.confirmations)
      if (!receipt) throw new Error('Receipt nulo tras confirmación')

      const ms = timer({ txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() })

      this.breaker.onSuccess()
      this.nonces.txConfirmed()

      log.bfa.info({
        method, txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed:     receipt.gasUsed.toString(),
        ms, ...logCtx,
      }, `✓ BFA ${method} confirmado`)

      return receipt

    } catch (err) {
      this.nonces.txConfirmed()
      this.breaker.onFailure()

      const isNonceError = String((err as Error).message).includes('nonce')
      if (isNonceError) await this.nonces.reset()

      const friendly = classifyBFAError(err)
      log.bfa.error({ method, nonce, friendly, raw: (err as Error).message?.slice(0, 200), ...logCtx }, `✗ BFA ${method} falló`)

      throw new Error(friendly)
    }
  }

  // ── Mint — serial + inspectorId + hashSHA256 → tokenId ──
  async mint(
    propietario:    string,
    hashSHA256:     string,
    numeroCIT:      string,
    serialBicicleta: string
  ): Promise<BFAMintResult> {
    if (!isValidSHA256(hashSHA256)) throw new Error(`hashSHA256 inválido: debe ser SHA-256 hex de 64 chars`)
    if (!propietario || propietario === ethers.ZeroAddress) throw new Error('Dirección propietario inválida')

    const receipt = await this.sendTx('mint', [propietario, hashSHA256, numeroCIT, serialBicicleta], {
      numeroCIT, serial: serialBicicleta,
      hash: hashSHA256.slice(0, 16) + '...',
    })

    // Extraer tokenId del evento CITMinted
    const iface     = new ethers.Interface(CIT_ABI)
    let tokenId     = 0

    for (const log_ of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...log_.topics], data: log_.data })
        if (parsed?.name === 'CITMinted') {
          tokenId = Number(parsed.args.tokenId)
          break
        }
      } catch { /* log no pertenece a este contrato */ }
    }

    if (tokenId === 0) {
      log.bfa.warn({ txHash: receipt.hash }, 'CITMinted event no encontrado — usando fallback totalEmitidos')
      tokenId = Number(await this.contract.totalEmitidos())
    }

    return {
      txHash:      receipt.hash,
      tokenId,
      blockNumber: receipt.blockNumber,
      gasUsed:     receipt.gasUsed.toString(),
    }
  }

  // ── Bloquear NFT por denuncia de robo ───────────────────
  async bloquear(tokenId: number, motivo: string): Promise<string> {
    const receipt = await this.sendTx('bloquear', [tokenId, motivo], { tokenId, motivo: motivo.slice(0, 40) })
    return receipt.hash
  }

  // ── Desbloquear NFT (bicicleta recuperada) ──────────────
  async desbloquear(tokenId: number): Promise<string> {
    const receipt = await this.sendTx('desbloquear', [tokenId], { tokenId })
    return receipt.hash
  }

  // ── Transferir NFT (compraventa) ────────────────────────
  async transferirCIT(tokenId: number, nuevoPropietario: string): Promise<string> {
    const receipt = await this.sendTx('transferirCIT', [tokenId, nuevoPropietario], {
      tokenId, destino: nuevoPropietario.slice(0, 10) + '...',
    })
    return receipt.hash
  }

  // ── Consultas de lectura (sin gas) ──────────────────────

  async verificarIntegridad(hashSHA256: string): Promise<{ valido: boolean; bloqueado: boolean; tokenId: number }> {
    const result = await this.contract.verificarIntegridad(hashSHA256)
    return { valido: result.valido, bloqueado: result.bloqueado, tokenId: Number(result.tokenId) }
  }

  async datosCIT(tokenId: number): Promise<DatosCIT | null> {
    try {
      const d = await this.contract.datosCIT(tokenId)
      return {
        hashSHA256:      d.hashSHA256,
        numeroCIT:       d.numeroCIT,
        serialBicicleta: d.serialBicicleta,
        propietario:     d.propietario,
        bloqueado:       d.bloqueado,
        motivoBloqueo:   d.motivoBloqueo,
        emitidoEn:       Number(d.emitidoEn),
        bloqueadoEn:     Number(d.bloqueadoEn),
        inspector:       d.inspector,
      }
    } catch { return null }
  }

  async tokenPorHash(hashSHA256: string): Promise<number> {
    return Number(await this.contract.tokenPorHash(hashSHA256))
  }

  async historialPorSerial(serial: string): Promise<number[]> {
    const ids = await this.contract.historialPorSerial(serial)
    return ids.map(Number)
  }

  async totalEmitidos(): Promise<number> {
    return Number(await this.contract.totalEmitidos())
  }

  // ── Health check — estado del wallet y el nodo ─────────
  async healthCheck(): Promise<{
    ok:            boolean
    walletAddress: string
    balance:       string
    balanceWei:    string
    nonce:         number
    chainId:       number
    blockNumber:   number
    contractAddr:  string
    paused:        boolean
    totalCITs:     number
    circuitBreaker: 'closed' | 'open'
    error?:        string
  }> {
    try {
      const [balance, blockNumber, nonce, paused, total] = await Promise.all([
        this.provider.getBalance(this.walletAddress),
        this.provider.getBlockNumber(),
        this.wallet.getNonce(),
        this.contract.paused() as Promise<boolean>,
        this.contract.totalEmitidos() as Promise<bigint>,
      ])

      return {
        ok:            true,
        walletAddress: this.walletAddress,
        balance:       ethers.formatEther(balance),
        balanceWei:    balance.toString(),
        nonce,
        chainId:       this.chainId,
        blockNumber,
        contractAddr:  env.BFA_CONTRACT_ADDRESS!,
        paused,
        totalCITs:     Number(total),
        circuitBreaker: this.breaker.isOpen() ? 'open' : 'closed',
      }
    } catch (err) {
      return {
        ok:            false,
        walletAddress: this.walletAddress,
        balance:       '0',
        balanceWei:    '0',
        nonce:         -1,
        chainId:       this.chainId,
        blockNumber:   -1,
        contractAddr:  env.BFA_CONTRACT_ADDRESS ?? '',
        paused:        false,
        totalCITs:     -1,
        circuitBreaker: this.breaker.isOpen() ? 'open' : 'closed',
        error:         classifyBFAError(err),
      }
    }
  }
}

// ══════════════════════════════════════════════════════════
// BFA SERVICE STUB — desarrollo sin nodo BFA
// ══════════════════════════════════════════════════════════

interface StubToken {
  hashSHA256: string; numeroCIT: string; serialBicicleta: string
  propietario: string; bloqueado: boolean; motivoBloqueo: string
  emitidoEn: number; tokenId: number
}

// ══════════════════════════════════════════════════════════
// BFA SERVICE STUB — PERSISTENTE en DB
// Reemplaza el Map en memoria con bfa_stub_tokens.
// SHA-256 real · tokenId persistente · sobrevive reinicios.
// ══════════════════════════════════════════════════════════
class BFAServiceStub {
  // SHA-256 del payload CIT — siempre real, nunca simulado
  computeRealHash(payload: string): string {
    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex')
  }

  async mint(to: string, hashSHA256: string, numeroCIT: string, serialBicicleta = ''): Promise<BFAMintResult> {
    if (!isValidSHA256(hashSHA256)) {
      throw new Error(`BFA Stub: hashSHA256 inválido (debe ser 64 chars hex sin 0x): "${hashSHA256.slice(0,20)}…"`)
    }

    // Idempotencia: si ya existe este hash → devolver el token existente
    const { queryOne: q1, query: q } = await import('../config/database')
    const existing = await q1<{ token_id: number; tx_hash: string; block_number: number }>(
      `SELECT token_id, tx_hash, block_number FROM bfa_stub_tokens WHERE hash_sha256 = $1`,
      [hashSHA256]
    ).catch(() => null)

    if (existing) {
      log.bfa.info({ tokenId: existing.token_id, numeroCIT }, '⚡ BFA STUB — token ya existía (idempotente)')
      return { txHash: existing.tx_hash, tokenId: existing.token_id, blockNumber: existing.block_number, gasUsed: '85000' }
    }

    // Nuevo tokenId desde la secuencia DB — persistente entre reinicios
    const seqRow = await q1<{ nextval: string }>(
      `SELECT nextval('bfa_stub_token_seq')::text AS nextval`, []
    ).catch(() => null)
    const tokenId = seqRow ? parseInt(seqRow.nextval) : Date.now()

    const txHash    = '0xBFA_STUB_' + crypto.randomBytes(24).toString('hex')
    const blockNum  = 1_000_000 + tokenId

    await q(
      `INSERT INTO bfa_stub_tokens
         (token_id, hash_sha256, numero_cit, serial_bicicleta, propietario, tx_hash, block_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (hash_sha256) DO NOTHING`,
      [tokenId, hashSHA256, numeroCIT, serialBicicleta,
       to || '0x000000000000000000000000000000000000dEaD',
       txHash, blockNum]
    ).catch(() => {})

    log.bfa.warn({
      stub: true, tokenId, numeroCIT,
      hash: hashSHA256.slice(0, 16) + '…',
      accion: 'Para producción: configurar BFA_RPC_URL + BFA_WALLET_PRIVATE_KEY + BFA_CONTRACT_ADDRESS',
    }, '⚠️  BFA STUB — NFT simulado (persistido en DB)')

    return { txHash, tokenId, blockNumber: blockNum, gasUsed: '85000' }
  }

  async bloquear(tokenId: number, motivo: string): Promise<string> {
    const { query: q, queryOne: q1 } = await import('../config/database')
    const t = await q1<{ bloqueado: boolean }>(`SELECT bloqueado FROM bfa_stub_tokens WHERE token_id=$1`,[tokenId]).catch(()=>null)
    if (!t) throw new Error(`BFA Stub: token ${tokenId} no existe`)
    if (t.bloqueado) throw new Error(`BFA Stub: token ${tokenId} ya bloqueado`)
    await q(`UPDATE bfa_stub_tokens SET bloqueado=TRUE, motivo_bloqueo=$2 WHERE token_id=$1`,[tokenId, motivo]).catch(()=>{})
    return '0xBFA_STUB_LOCK_' + crypto.randomBytes(20).toString('hex')
  }

  async desbloquear(tokenId: number): Promise<string> {
    const { query: q, queryOne: q1 } = await import('../config/database')
    const t = await q1<{ bloqueado: boolean }>(`SELECT bloqueado FROM bfa_stub_tokens WHERE token_id=$1`,[tokenId]).catch(()=>null)
    if (!t) throw new Error(`BFA Stub: token ${tokenId} no existe`)
    await q(`UPDATE bfa_stub_tokens SET bloqueado=FALSE, motivo_bloqueo=NULL WHERE token_id=$1`,[tokenId]).catch(()=>{})
    return '0xBFA_STUB_UNLK_' + crypto.randomBytes(20).toString('hex')
  }

  async transferirCIT(tokenId: number, newOwner: string): Promise<string> {
    const { query: q, queryOne: q1 } = await import('../config/database')
    const t = await q1<{ bloqueado: boolean }>(`SELECT bloqueado FROM bfa_stub_tokens WHERE token_id=$1`,[tokenId]).catch(()=>null)
    if (!t) throw new Error(`BFA Stub: token ${tokenId} no existe`)
    if (t.bloqueado) throw new Error(`BFA Stub: token ${tokenId} bloqueado — no se puede transferir`)
    await q(`UPDATE bfa_stub_tokens SET propietario=$2 WHERE token_id=$1`,[tokenId, newOwner]).catch(()=>{})
    return '0xBFA_STUB_TXFR_' + crypto.randomBytes(20).toString('hex')
  }

  async datosCIT(tokenId: number): Promise<DatosCIT | null> {
    const { queryOne: q1 } = await import('../config/database')
    const t = await q1<any>(`SELECT * FROM bfa_stub_tokens WHERE token_id=$1`,[tokenId]).catch(()=>null)
    if (!t) return null
    return {
      hashSHA256: t.hash_sha256, numeroCIT: t.numero_cit, serialBicicleta: t.serial_bicicleta,
      propietario: t.propietario, bloqueado: t.bloqueado, motivoBloqueo: t.motivo_bloqueo ?? '',
      emitidoEn: new Date(t.creado_en).getTime(), bloqueadoEn: 0,
      inspector: '0x0000000000000000000000000000000000000000',
    }
  }

  async verificarIntegridad(hashSHA256: string) {
    const { queryOne: q1 } = await import('../config/database')
    const t = await q1<{ token_id: number; bloqueado: boolean }>(`SELECT token_id, bloqueado FROM bfa_stub_tokens WHERE hash_sha256=$1`,[hashSHA256]).catch(()=>null)
    if (!t) return { valido: false, bloqueado: false, tokenId: 0 }
    return { valido: true, bloqueado: t.bloqueado, tokenId: t.token_id }
  }

  async tokenPorHash(hashSHA256: string): Promise<number> {
    const { queryOne: q1 } = await import('../config/database')
    const t = await q1<{ token_id: number }>(`SELECT token_id FROM bfa_stub_tokens WHERE hash_sha256=$1`,[hashSHA256]).catch(()=>null)
    return t?.token_id ?? 0
  }

  async historialPorSerial(serial: string): Promise<number[]> {
    const { query: q } = await import('../config/database')
    const rows = await q<{ token_id: number }>(`SELECT token_id FROM bfa_stub_tokens WHERE serial_bicicleta=$1 ORDER BY token_id`,[serial]).catch(()=>[])
    return rows.map(r => r.token_id)
  }

  async totalEmitidos(): Promise<number> {
    const { queryOne: q1 } = await import('../config/database')
    const r = await q1<{ count: string }>(`SELECT COUNT(*)::text AS count FROM bfa_stub_tokens`,[]).catch(()=>null)
    return r ? parseInt(r.count) : 0
  }

  async healthCheck() {
    const total = await this.totalEmitidos()
    return {
      ok: true,
      walletAddress: '0xRODAID_STUB_WALLET',
      balance:       'N/A (STUB)',
      balanceWei:    '0',
      nonce:         0,
      chainId:       0,
      blockNumber:   1_000_000 + total,
      contractAddr:  'bfa_stub_tokens (DB)',
      paused:        false,
      totalCITs:     total,
      circuitBreaker:'closed' as const,
    }
  }
}

// ══════════════════════════════════════════════════════════
// EXPORTAR INSTANCIA CORRECTA
// ══════════════════════════════════════════════════════════

export type BFAService = BFAServiceReal | BFAServiceStub

const hasRealConfig = !!(
  (env.BFA_RPC_URL || env.BFA_TESTNET_RPC_URL) &&
  env.BFA_WALLET_PRIVATE_KEY &&
  env.BFA_CONTRACT_ADDRESS
)

export const bfaService: BFAService = hasRealConfig
  ? new BFAServiceReal()
  : new BFAServiceStub()

if (!hasRealConfig) {
  log.bfa.warn({
    mode: 'STUB',
    faltantes: [
      !env.BFA_RPC_URL && !env.BFA_TESTNET_RPC_URL ? 'BFA_RPC_URL' : null,
      !env.BFA_WALLET_PRIVATE_KEY ? 'BFA_WALLET_PRIVATE_KEY' : null,
      !env.BFA_CONTRACT_ADDRESS   ? 'BFA_CONTRACT_ADDRESS'   : null,
    ].filter(Boolean),
  }, '⚠️  BFA STUB activo — para producción configurar las variables de entorno BFA_*')
}
