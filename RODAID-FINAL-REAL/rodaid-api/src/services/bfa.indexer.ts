// ─── RODAID · BFA Event Indexer ──────────────────────────
// Indexa los eventos del contrato RodaidCIT.sol en PostgreSQL
// para que el Verificador Público funcione sin llamar a BFA en
// cada request (latencia, límites de rate, disponibilidad del nodo).
//
// Eventos indexados:
//   CITMinted(tokenId, propietario, inspector, hashSHA256, numeroCIT, serial)
//   CITBloqueado(tokenId, motivo, timestamp)
//   CITDesbloqueado(tokenId, timestamp)
//   CITTransferido(tokenId, de, para, numeroCIT)
//
// Estrategia dual:
//   1. Suscripción WebSocket (tiempo real) — si el nodo BFA lo soporta
//   2. Polling cada N segundos (fallback) — más robusto en producción
//
// El índice funciona también en modo STUB:
//   Los eventos del stub se insertan directamente en bfa_eventos
//   para que el Verificador funcione en desarrollo sin nodo BFA.

import { ethers }    from 'ethers'
import { env }       from '../config/env'
import { query, queryOne } from '../config/database'
import { log }       from '../middleware/logger'
import { bfaService } from './bfa.service'

// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════

const POLLING_INTERVAL_MS  = 30_000   // 30 segundos entre polls
const BATCH_SIZE           = 500      // eventos por lote en sync histórico
const CONFIRMATIONS_NEEDED = 1        // bloques confirmados antes de indexar
const START_BLOCK_DEFAULT  = 0        // primer bloque a indexar (ajustar post-deploy)

const EVENTS_ABI = [
  'event CITMinted(uint256 indexed tokenId, address indexed propietario, address indexed inspector, string hashSHA256, string numeroCIT, string serialBicicleta)',
  'event CITBloqueado(uint256 indexed tokenId, string motivo, uint256 timestamp)',
  'event CITDesbloqueado(uint256 indexed tokenId, uint256 timestamp)',
  'event CITTransferido(uint256 indexed tokenId, address indexed de, address indexed para, string numeroCIT)',
]

type EventName = 'CITMinted' | 'CITBloqueado' | 'CITDesbloqueado' | 'CITTransferido'

interface ParsedEvent {
  eventName:       EventName
  txHash:          string
  blockNumber:     number
  tokenId:         number
  hashSHA256?:     string
  numeroCIT?:      string
  serialBicicleta?: string
  propietario?:    string
  inspector?:      string
  motivo?:         string
  deWallet?:       string
  paraWallet?:     string
  rawArgs:         Record<string, unknown>
}

// ══════════════════════════════════════════════════════════
// PARSER DE EVENTOS
// ══════════════════════════════════════════════════════════

const iface = new ethers.Interface(EVENTS_ABI)

function parseLog(log_: ethers.Log): ParsedEvent | null {
  try {
    const parsed = iface.parseLog({ topics: [...log_.topics], data: log_.data })
    if (!parsed) return null

    const base = {
      txHash:      log_.transactionHash,
      blockNumber: log_.blockNumber,
      tokenId:     Number(parsed.args.tokenId ?? 0),
      rawArgs:     Object.fromEntries(
        parsed.fragment.inputs.map((inp, i) => [inp.name, parsed.args[i]?.toString()])
      ),
    }

    switch (parsed.name as EventName) {
      case 'CITMinted':
        return {
          ...base, eventName: 'CITMinted',
          hashSHA256:      parsed.args.hashSHA256,
          numeroCIT:       parsed.args.numeroCIT,
          serialBicicleta: parsed.args.serialBicicleta,
          propietario:     parsed.args.propietario,
          inspector:       parsed.args.inspector,
        }
      case 'CITBloqueado':
        return { ...base, eventName: 'CITBloqueado', motivo: parsed.args.motivo }
      case 'CITDesbloqueado':
        return { ...base, eventName: 'CITDesbloqueado' }
      case 'CITTransferido':
        return {
          ...base, eventName: 'CITTransferido',
          numeroCIT:  parsed.args.numeroCIT,
          deWallet:   parsed.args.de,
          paraWallet: parsed.args.para,
        }
      default:
        return null
    }
  } catch {
    return null  // log de otro contrato
  }
}

// ══════════════════════════════════════════════════════════
// INSERCIÓN EN BASE DE DATOS
// ══════════════════════════════════════════════════════════

async function upsertEvent(event: ParsedEvent, blockTimestamp?: Date): Promise<boolean> {
  try {
    await query(
      `INSERT INTO bfa_eventos
         (event_name, tx_hash, block_number, block_timestamp, token_id,
          hash_sha256, numero_cit, serial_bicicleta,
          propietario, inspector, motivo, de_wallet, para_wallet, raw_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (tx_hash) DO NOTHING`,
      [
        event.eventName,
        event.txHash,
        event.blockNumber,
        blockTimestamp ?? null,
        event.tokenId,
        event.hashSHA256      ?? null,
        event.numeroCIT       ?? null,
        event.serialBicicleta ?? null,
        event.propietario     ?? null,
        event.inspector       ?? null,
        event.motivo          ?? null,
        event.deWallet        ?? null,
        event.paraWallet      ?? null,
        JSON.stringify(event.rawArgs),
      ]
    )
    return true
  } catch (err) {
    log.bfa.warn({ txHash: event.txHash, err: (err as Error).message }, 'upsertEvent error')
    return false
  }
}

async function updateIndexerState(lastBlock: number, totalDelta = 0): Promise<void> {
  await query(
    `UPDATE bfa_indexer_state
     SET last_block    = GREATEST(last_block, $1),
         total_events  = total_events + $2,
         ultima_sync   = NOW()
     WHERE id = 1`,
    [lastBlock, totalDelta]
  )
}

// ══════════════════════════════════════════════════════════
// INDEXER REAL — con nodo BFA
// ══════════════════════════════════════════════════════════

class BFAIndexerReal {
  private readonly provider:      ethers.JsonRpcProvider
  private readonly contract:      ethers.Contract
  private readonly contractAddr:  string
  private readonly chainId:       number
  private timer:                  ReturnType<typeof setInterval> | null = null
  private isRunning = false

  constructor() {
    const rpcUrl    = (env.BFA_RPC_URL ?? env.BFA_TESTNET_RPC_URL)!
    this.chainId    = env.BFA_CHAIN_ID ?? 4337
    this.contractAddr = env.BFA_CONTRACT_ADDRESS!

    this.provider = new ethers.JsonRpcProvider(rpcUrl, {
      chainId: this.chainId,
      name:    this.chainId === 4337 ? 'bfa' : 'bfa-testnet',
    })
    this.contract = new ethers.Contract(this.contractAddr, EVENTS_ABI, this.provider)

    log.bfa.info({
      contract: this.contractAddr.slice(0, 10) + '...',
      chainId:  this.chainId,
      rpc:      rpcUrl.replace(/\/\/.*@/, '//***@'),
    }, '✓ BFAIndexer inicializado')
  }

  // ── Sync histórico: de fromBlock a toBlock en lotes ──────
  async syncRange(fromBlock: number, toBlock: number): Promise<number> {
    let indexed = 0

    for (let start = fromBlock; start <= toBlock; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE - 1, toBlock)

      try {
        const logs = await this.provider.getLogs({
          address:   this.contractAddr,
          fromBlock: start,
          toBlock:   end,
        })

        // Agrupar por bloque para minimizar llamadas getBlock
        const blockMap = new Map<number, Date>()
        for (const blockN of [...new Set(logs.map(l => l.blockNumber))]) {
          try {
            const block = await this.provider.getBlock(blockN)
            if (block?.timestamp) {
              blockMap.set(blockN, new Date(Number(block.timestamp) * 1000))
            }
          } catch { /* best-effort */ }
        }

        for (const log_ of logs) {
          const parsed = parseLog(log_)
          if (!parsed) continue
          const inserted = await upsertEvent(parsed, blockMap.get(log_.blockNumber))
          if (inserted) indexed++
        }

        if (logs.length > 0) {
          log.bfa.debug({ start, end, events: logs.length }, 'Lote indexado')
        }
      } catch (err) {
        log.bfa.warn({ start, end, err: (err as Error).message }, 'Error en lote — continuando')
      }
    }

    return indexed
  }

  // ── Polling — verifica bloques nuevos periódicamente ─────
  async poll(): Promise<void> {
    try {
      const state = await queryOne<{ last_block: number }>(
        'SELECT last_block FROM bfa_indexer_state WHERE id=1'
      )
      const fromBlock = (state?.last_block ?? 0) + 1
      const toBlock   = (await this.provider.getBlockNumber()) - CONFIRMATIONS_NEEDED

      if (toBlock < fromBlock) return  // sin bloques nuevos

      const indexed = await this.syncRange(fromBlock, toBlock)
      await updateIndexerState(toBlock, indexed)

      if (indexed > 0) {
        log.bfa.info({ fromBlock, toBlock, indexed }, '✓ Poll: eventos nuevos indexados')
      }
    } catch (err) {
      log.bfa.warn({ err: (err as Error).message }, 'Poll error')
    }
  }

  // ── Iniciar indexer ───────────────────────────────────────
  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    log.bfa.info({ pollingMs: POLLING_INTERVAL_MS }, '▶ Indexer BFA iniciado')

    // Actualizar estado inicial
    void query(
      `UPDATE bfa_indexer_state
      SET corriendo=TRUE, contract_address=$1, chain_id=$2
      WHERE id=1`,
      [this.contractAddr, this.chainId]
      )

    // Sync histórico inicial
    const state = await queryOne<{ last_block: number }>(
      'SELECT last_block FROM bfa_indexer_state WHERE id=1'
    )
    const fromBlock = state?.last_block ?? START_BLOCK_DEFAULT

    if (fromBlock === 0) {
      log.bfa.info('Sync histórico inicial desde bloque 0...')
      const toBlock = await this.provider.getBlockNumber()
      const indexed = await this.syncRange(START_BLOCK_DEFAULT, toBlock)
      await updateIndexerState(toBlock, indexed)
      log.bfa.info({ indexed, toBlock }, 'Sync histórico completado')
    }

    // Iniciar polling periódico
    this.timer = setInterval(() => this.poll(), POLLING_INTERVAL_MS)

    // Intentar suscripción WebSocket para tiempo real
    this.tryWebSocket()
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.isRunning = false
    await query('UPDATE bfa_indexer_state SET corriendo=FALSE WHERE id=1')
    log.bfa.info('■ Indexer BFA detenido')
  }

  // ── WebSocket para tiempo real (best-effort) ──────────────
  private tryWebSocket(): void {
    const wsUrl = env.BFA_WS_URL
    if (!wsUrl) return

    try {
      const wsProvider = new ethers.WebSocketProvider(wsUrl, {
        chainId: this.chainId,
        name:    'bfa',
      })
      const wsContract = new ethers.Contract(this.contractAddr, EVENTS_ABI, wsProvider)

      const makeHandler = (eventName: EventName) => (...args: unknown[]) => {
        const log_ = args[args.length - 1] as ethers.EventLog
        const parsed = parseLog(log_)
        if (!parsed) return
        upsertEvent(parsed).then(() => updateIndexerState(log_.blockNumber, 1)).catch(() => {})
        log.bfa.debug({ eventName, tokenId: parsed.tokenId, txHash: parsed.txHash }, `↗ Evento real-time: ${eventName}`)
      }

      wsContract.on('CITMinted',      makeHandler('CITMinted'))
      wsContract.on('CITBloqueado',   makeHandler('CITBloqueado'))
      wsContract.on('CITDesbloqueado',makeHandler('CITDesbloqueado'))
      wsContract.on('CITTransferido', makeHandler('CITTransferido'))

      wsProvider.on('error', () => {
        log.bfa.warn('WebSocket desconectado — usando solo polling')
        wsContract.removeAllListeners()
      })

      log.bfa.info({ wsUrl: wsUrl.replace(/\/\/.*@/, '//***@') }, '✓ WebSocket conectado para eventos real-time')
    } catch (err) {
      log.bfa.warn({ err: (err as Error).message }, 'WebSocket no disponible — solo polling activo')
    }
  }

  // ── Estado del indexer ────────────────────────────────────
  async getStatus() {
    const state = await queryOne<{
      last_block: number; total_events: number; ultima_sync: Date | null; corriendo: boolean
    }>('SELECT last_block, total_events, ultima_sync, corriendo FROM bfa_indexer_state WHERE id=1')

    const [currentBlock, countByEvent] = await Promise.all([
      this.provider.getBlockNumber().catch(() => -1),
      query<{ event_name: string; count: string }>(
        'SELECT event_name, COUNT(*)::text AS count FROM bfa_eventos GROUP BY event_name ORDER BY event_name'
      ),
    ])

    return {
      running:       this.isRunning,
      lastBlock:     state?.last_block ?? 0,
      currentBlock,
      blocksBehind:  currentBlock - (state?.last_block ?? 0),
      totalEvents:   state?.total_events ?? 0,
      ultimaSync:    state?.ultima_sync?.toISOString() ?? null,
      contractAddr:  this.contractAddr,
      chainId:       this.chainId,
      pollingMs:     POLLING_INTERVAL_MS,
      byEvent:       Object.fromEntries(countByEvent.map(r => [r.event_name, parseInt(r.count)])),
    }
  }
}

// ══════════════════════════════════════════════════════════
// INDEXER STUB — desarrollo sin nodo BFA
// ══════════════════════════════════════════════════════════

class BFAIndexerStub {
  private isRunning = false

  async start() {
    this.isRunning = true
    log.bfa.warn('⚠️  BFAIndexer STUB activo — los eventos se insertan manualmente via indexStubEvent()')
  }

  async stop() {
    this.isRunning = false
  }

  async poll() { /* noop */ }

  async getStatus() {
    const countByEvent = await query<{ event_name: string; count: string }>(
      'SELECT event_name, COUNT(*)::text AS count FROM bfa_eventos GROUP BY event_name ORDER BY event_name'
    )
    const totalEvents = countByEvent.reduce((acc, r) => acc + parseInt(r.count), 0)
    return {
      running:     this.isRunning,
      lastBlock:   0, currentBlock: 0, blocksBehind: 0,
      totalEvents, ultimaSync: null, contractAddr: 'STUB',
      chainId: 0, pollingMs: 0,
      byEvent: Object.fromEntries(countByEvent.map(r => [r.event_name, parseInt(r.count)])),
      stub: true,
    }
  }
}

// ══════════════════════════════════════════════════════════
// EXPORTAR INSTANCIA
// ══════════════════════════════════════════════════════════

const hasRealConfig = !!(
  (env.BFA_RPC_URL || env.BFA_TESTNET_RPC_URL) &&
  env.BFA_CONTRACT_ADDRESS
)

export const bfaIndexer: BFAIndexerReal | BFAIndexerStub = hasRealConfig
  ? new BFAIndexerReal()
  : new BFAIndexerStub()

// ── Insertar evento desde el stub BFA para pruebas ─────────
export async function indexStubEvent(
  eventName:  EventName,
  tokenId:    number,
  txHash:     string,
  blockNumber: number,
  data:       Partial<ParsedEvent>
): Promise<void> {
  await upsertEvent({
    eventName, txHash, blockNumber, tokenId,
    rawArgs: {},
    ...data,
  }, new Date())
  await updateIndexerState(blockNumber, 1)
}

// ══════════════════════════════════════════════════════════
// VERIFICADOR PÚBLICO — consultas sobre el índice
// ══════════════════════════════════════════════════════════

export interface CITVerificacion {
  encontrado:     boolean
  serial?:        string
  hashSHA256?:    string
  numeroCIT?:     string
  estado:         'ACTIVO' | 'BLOQUEADO' | 'TRANSFERIDO' | 'NO_ENCONTRADO'
  propietario?:   string
  inspector?:     string
  emitidoEn?:     string
  bfa: {
    indexado:     boolean
    tokenId?:     number
    mintTxHash?:  string
    mintBloque?:  number
    bloqueado:    boolean
    bloqueoMotivo?: string
    transferencias: number
    ultimaTransferencia?: string
  }
  historial:     EventHistorial[]
}

interface EventHistorial {
  tipo:        EventName
  txHash:      string
  bloque:      number
  timestamp?:  string
  datos?:      Record<string, string | null | undefined>
}

/** Verificar CIT por número de serie de la bicicleta */
export async function verificarPorSerial(serial: string): Promise<CITVerificacion> {
  // Buscar TODOS los eventos del token_id asociado al serial
  // (no solo los que tienen serial_bicicleta — lock/unlock/transfer no lo tienen)
  const rows = await query<{
    event_name: string; tx_hash: string; block_number: number
    block_timestamp: Date | null; token_id: number
    hash_sha256: string | null; numero_cit: string | null
    serial_bicicleta: string | null
    propietario: string | null; inspector: string | null; motivo: string | null
    de_wallet: string | null; para_wallet: string | null
  }>(
    `SELECT e.event_name, e.tx_hash, e.block_number, e.block_timestamp, e.token_id,
            e.hash_sha256, e.numero_cit, e.serial_bicicleta, e.propietario, e.inspector,
            e.motivo, e.de_wallet, e.para_wallet
     FROM bfa_eventos e
     WHERE e.token_id = (
       SELECT token_id FROM bfa_eventos
       WHERE serial_bicicleta = $1 AND event_name = 'CITMinted'
       ORDER BY block_number ASC LIMIT 1
     )
     ORDER BY e.block_number ASC`,
    [serial]
  )

  return buildVerificacion(serial, null, rows as unknown as Array<Record<string, unknown>>)
}

/** Verificar CIT por hash SHA-256 del documento */
export async function verificarPorHash(hashSHA256: string): Promise<CITVerificacion> {
  const rows = await query<{
    event_name: string; tx_hash: string; block_number: number
    block_timestamp: Date | null; token_id: number
    hash_sha256: string | null; numero_cit: string | null
    serial_bicicleta: string | null
    propietario: string | null; inspector: string | null; motivo: string | null
    de_wallet: string | null; para_wallet: string | null
  }>(
    `SELECT e.event_name, e.tx_hash, e.block_number, e.block_timestamp, e.token_id,
            e.hash_sha256, e.numero_cit, e.serial_bicicleta, e.propietario, e.inspector,
            e.motivo, e.de_wallet, e.para_wallet
     FROM bfa_eventos e
     WHERE e.token_id = (
       SELECT token_id FROM bfa_eventos
       WHERE hash_sha256 = $1 AND event_name = 'CITMinted'
       LIMIT 1
     )
     ORDER BY e.block_number ASC`,
    [hashSHA256]
  )

  return buildVerificacion(null, hashSHA256, rows as unknown as Array<Record<string, unknown>>)
}

/** Verificar CIT por número (RCIT-2026-00001) */
export async function verificarPorNumeroCIT(numeroCIT: string): Promise<CITVerificacion> {
  const rows = await query<{
    event_name: string; tx_hash: string; block_number: number
    block_timestamp: Date | null; token_id: number
    hash_sha256: string | null; numero_cit: string | null
    serial_bicicleta: string | null
    propietario: string | null; inspector: string | null; motivo: string | null
    de_wallet: string | null; para_wallet: string | null
  }>(
    `SELECT e.event_name, e.tx_hash, e.block_number, e.block_timestamp, e.token_id,
            e.hash_sha256, e.numero_cit, e.serial_bicicleta, e.propietario, e.inspector,
            e.motivo, e.de_wallet, e.para_wallet
     FROM bfa_eventos e
     WHERE e.token_id = (
       SELECT token_id FROM bfa_eventos
       WHERE numero_cit = $1 AND event_name = 'CITMinted'
       LIMIT 1
     )
     ORDER BY e.block_number ASC`,
    [numeroCIT]
  )

  return buildVerificacion(null, null, rows as unknown as Array<Record<string, unknown>>, numeroCIT)
}

function buildVerificacion(
  serial:     string | null,
  hashSHA256: string | null,
  rows:       Array<Record<string, unknown>>,
  numeroCIT?: string
): CITVerificacion {
  if (!rows.length) {
    return {
      encontrado: false,
      estado:     'NO_ENCONTRADO',
      bfa:        { indexado: false, bloqueado: false, transferencias: 0 },
      historial:  [],
    }
  }

  // El mint define los datos base del CIT
  const mint = rows.find(r => r.event_name === 'CITMinted')

  // Estado actual: el último lock/unlock determina si está bloqueado
  let bloqueado = false; let bloqueoMotivo: string | undefined
  const locks = rows.filter(r => r.event_name === 'CITBloqueado')
  const unlocks = rows.filter(r => r.event_name === 'CITDesbloqueado')

  // Si hay más locks que unlocks → está bloqueado
  if (locks.length > unlocks.length) {
    bloqueado = true
    bloqueoMotivo = String(locks[locks.length - 1].motivo ?? '')
  }

  // Propietario actual: el último transfer, o el mint si no hubo transfers
  const transfers = rows.filter(r => r.event_name === 'CITTransferido')
  const propietarioActual = transfers.length > 0
    ? String(transfers[transfers.length - 1].para_wallet ?? '')
    : String(mint?.propietario ?? '')

  const estado: CITVerificacion['estado'] = bloqueado ? 'BLOQUEADO'
    : transfers.length > 0               ? 'TRANSFERIDO'
    : 'ACTIVO'

  const ultimaTransferencia = transfers.length > 0
    ? String(transfers[transfers.length - 1].tx_hash ?? '')
    : undefined

  return {
    encontrado: true,
    serial:     String(mint?.serial_bicicleta ?? serial ?? ''),
    hashSHA256: String(mint?.hash_sha256 ?? hashSHA256 ?? ''),
    numeroCIT:  String(mint?.numero_cit ?? numeroCIT ?? ''),
    estado,
    propietario: propietarioActual,
    inspector:   String(mint?.inspector ?? ''),
    emitidoEn:   mint?.block_timestamp ? new Date(mint.block_timestamp as Date).toISOString() : undefined,
    bfa: {
      indexado:     true,
      tokenId:      Number(mint?.token_id ?? 0) || undefined,
      mintTxHash:   String(mint?.tx_hash ?? ''),
      mintBloque:   Number(mint?.block_number ?? 0) || undefined,
      bloqueado,
      bloqueoMotivo,
      transferencias:       transfers.length,
      ultimaTransferencia,
    },
    historial: rows.map(r => ({
      tipo:      r.event_name as EventName,
      txHash:    String(r.tx_hash ?? ''),
      bloque:    Number(r.block_number ?? 0),
      timestamp: r.block_timestamp ? new Date(r.block_timestamp as Date).toISOString() : undefined,
      datos: r.event_name === 'CITMinted'      ? { propietario: String(r.propietario ?? ''), inspector: String(r.inspector ?? '') }
           : r.event_name === 'CITBloqueado'   ? { motivo: String(r.motivo ?? '') }
           : r.event_name === 'CITTransferido' ? { de: String(r.de_wallet ?? ''), para: String(r.para_wallet ?? '') }
           : undefined,
    })),
  }
}

// ── Estadísticas globales para admin ─────────────────────

export async function getIndexerStats() {
  const [state, byEvent, recientes] = await Promise.all([
    queryOne<{ last_block: number; total_events: number; ultima_sync: Date | null }>(
      'SELECT last_block, total_events, ultima_sync FROM bfa_indexer_state WHERE id=1'
    ),
    query<{ event_name: string; count: string }>(
      'SELECT event_name, COUNT(*)::text AS count FROM bfa_eventos GROUP BY event_name'
    ),
    query<{ event_name: string; tx_hash: string; block_number: number; indexado_en: Date }>(
      'SELECT event_name, tx_hash, block_number, indexado_en FROM bfa_eventos ORDER BY indexado_en DESC LIMIT 5'
    ),
  ])

  return {
    lastBlock:   state?.last_block ?? 0,
    totalEvents: state?.total_events ?? 0,
    ultimaSync:  state?.ultima_sync?.toISOString() ?? null,
    byEvent:     Object.fromEntries(byEvent.map(r => [r.event_name, parseInt(r.count)])),
    recientes,
  }
}

// ── Iniciar indexer desde server.ts ─────────────────────

let indexerStarted = false
export async function startIndexer(): Promise<void> {
  if (indexerStarted) return
  indexerStarted = true
  try {
    await bfaIndexer.start()
  } catch (err) {
    log.bfa.error({ err: (err as Error).message }, 'Error iniciando indexer')
  }
}
