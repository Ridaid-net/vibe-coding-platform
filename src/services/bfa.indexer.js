"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.bfaIndexer = void 0;
exports.indexStubEvent = indexStubEvent;
exports.verificarPorSerial = verificarPorSerial;
exports.verificarPorHash = verificarPorHash;
exports.verificarPorNumeroCIT = verificarPorNumeroCIT;
exports.getIndexerStats = getIndexerStats;
exports.startIndexer = startIndexer;
const ethers_1 = require("ethers");
const env_1 = require("../config/env");
const database_1 = require("../config/database");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════
const POLLING_INTERVAL_MS = 30_000; // 30 segundos entre polls
const BATCH_SIZE = 500; // eventos por lote en sync histórico
const CONFIRMATIONS_NEEDED = 1; // bloques confirmados antes de indexar
const START_BLOCK_DEFAULT = 0; // primer bloque a indexar (ajustar post-deploy)
const EVENTS_ABI = [
    'event CITMinted(uint256 indexed tokenId, address indexed propietario, address indexed inspector, string hashSHA256, string numeroCIT, string serialBicicleta)',
    'event CITBloqueado(uint256 indexed tokenId, string motivo, uint256 timestamp)',
    'event CITDesbloqueado(uint256 indexed tokenId, uint256 timestamp)',
    'event CITTransferido(uint256 indexed tokenId, address indexed de, address indexed para, string numeroCIT)',
];
// ══════════════════════════════════════════════════════════
// PARSER DE EVENTOS
// ══════════════════════════════════════════════════════════
const iface = new ethers_1.ethers.Interface(EVENTS_ABI);
function parseLog(log_) {
    try {
        const parsed = iface.parseLog({ topics: [...log_.topics], data: log_.data });
        if (!parsed)
            return null;
        const base = {
            txHash: log_.transactionHash,
            blockNumber: log_.blockNumber,
            tokenId: Number(parsed.args.tokenId ?? 0),
            rawArgs: Object.fromEntries(parsed.fragment.inputs.map((inp, i) => [inp.name, parsed.args[i]?.toString()])),
        };
        switch (parsed.name) {
            case 'CITMinted':
                return {
                    ...base, eventName: 'CITMinted',
                    hashSHA256: parsed.args.hashSHA256,
                    numeroCIT: parsed.args.numeroCIT,
                    serialBicicleta: parsed.args.serialBicicleta,
                    propietario: parsed.args.propietario,
                    inspector: parsed.args.inspector,
                };
            case 'CITBloqueado':
                return { ...base, eventName: 'CITBloqueado', motivo: parsed.args.motivo };
            case 'CITDesbloqueado':
                return { ...base, eventName: 'CITDesbloqueado' };
            case 'CITTransferido':
                return {
                    ...base, eventName: 'CITTransferido',
                    numeroCIT: parsed.args.numeroCIT,
                    deWallet: parsed.args.de,
                    paraWallet: parsed.args.para,
                };
            default:
                return null;
        }
    }
    catch {
        return null; // log de otro contrato
    }
}
// ══════════════════════════════════════════════════════════
// INSERCIÓN EN BASE DE DATOS
// ══════════════════════════════════════════════════════════
async function upsertEvent(event, blockTimestamp) {
    try {
        await (0, database_1.query)(`INSERT INTO bfa_eventos
         (event_name, tx_hash, block_number, block_timestamp, token_id,
          hash_sha256, numero_cit, serial_bicicleta,
          propietario, inspector, motivo, de_wallet, para_wallet, raw_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (tx_hash) DO NOTHING`, [
            event.eventName,
            event.txHash,
            event.blockNumber,
            blockTimestamp ?? null,
            event.tokenId,
            event.hashSHA256 ?? null,
            event.numeroCIT ?? null,
            event.serialBicicleta ?? null,
            event.propietario ?? null,
            event.inspector ?? null,
            event.motivo ?? null,
            event.deWallet ?? null,
            event.paraWallet ?? null,
            JSON.stringify(event.rawArgs),
        ]);
        return true;
    }
    catch (err) {
        logger_1.log.bfa.warn({ txHash: event.txHash, err: err.message }, 'upsertEvent error');
        return false;
    }
}
async function updateIndexerState(lastBlock, totalDelta = 0) {
    await (0, database_1.query)(`UPDATE bfa_indexer_state
     SET last_block    = GREATEST(last_block, $1),
         total_events  = total_events + $2,
         ultima_sync   = NOW()
     WHERE id = 1`, [lastBlock, totalDelta]);
}
// ══════════════════════════════════════════════════════════
// INDEXER REAL — con nodo BFA
// ══════════════════════════════════════════════════════════
class BFAIndexerReal {
    provider;
    contract;
    contractAddr;
    chainId;
    timer = null;
    isRunning = false;
    constructor() {
        const rpcUrl = (env_1.env.BFA_RPC_URL ?? env_1.env.BFA_TESTNET_RPC_URL);
        this.chainId = env_1.env.BFA_CHAIN_ID ?? 4337;
        this.contractAddr = env_1.env.BFA_CONTRACT_ADDRESS;
        this.provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl, {
            chainId: this.chainId,
            name: this.chainId === 4337 ? 'bfa' : 'bfa-testnet',
        });
        this.contract = new ethers_1.ethers.Contract(this.contractAddr, EVENTS_ABI, this.provider);
        logger_1.log.bfa.info({
            contract: this.contractAddr.slice(0, 10) + '...',
            chainId: this.chainId,
            rpc: rpcUrl.replace(/\/\/.*@/, '//***@'),
        }, '✓ BFAIndexer inicializado');
    }
    // ── Sync histórico: de fromBlock a toBlock en lotes ──────
    async syncRange(fromBlock, toBlock) {
        let indexed = 0;
        for (let start = fromBlock; start <= toBlock; start += BATCH_SIZE) {
            const end = Math.min(start + BATCH_SIZE - 1, toBlock);
            try {
                const logs = await this.provider.getLogs({
                    address: this.contractAddr,
                    fromBlock: start,
                    toBlock: end,
                });
                // Agrupar por bloque para minimizar llamadas getBlock
                const blockMap = new Map();
                for (const blockN of [...new Set(logs.map(l => l.blockNumber))]) {
                    try {
                        const block = await this.provider.getBlock(blockN);
                        if (block?.timestamp) {
                            blockMap.set(blockN, new Date(Number(block.timestamp) * 1000));
                        }
                    }
                    catch { /* best-effort */ }
                }
                for (const log_ of logs) {
                    const parsed = parseLog(log_);
                    if (!parsed)
                        continue;
                    const inserted = await upsertEvent(parsed, blockMap.get(log_.blockNumber));
                    if (inserted)
                        indexed++;
                }
                if (logs.length > 0) {
                    logger_1.log.bfa.debug({ start, end, events: logs.length }, 'Lote indexado');
                }
            }
            catch (err) {
                logger_1.log.bfa.warn({ start, end, err: err.message }, 'Error en lote — continuando');
            }
        }
        return indexed;
    }
    // ── Polling — verifica bloques nuevos periódicamente ─────
    async poll() {
        try {
            const state = await (0, database_1.queryOne)('SELECT last_block FROM bfa_indexer_state WHERE id=1');
            const fromBlock = (state?.last_block ?? 0) + 1;
            const toBlock = (await this.provider.getBlockNumber()) - CONFIRMATIONS_NEEDED;
            if (toBlock < fromBlock)
                return; // sin bloques nuevos
            const indexed = await this.syncRange(fromBlock, toBlock);
            await updateIndexerState(toBlock, indexed);
            if (indexed > 0) {
                logger_1.log.bfa.info({ fromBlock, toBlock, indexed }, '✓ Poll: eventos nuevos indexados');
            }
        }
        catch (err) {
            logger_1.log.bfa.warn({ err: err.message }, 'Poll error');
        }
    }
    // ── Iniciar indexer ───────────────────────────────────────
    async start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        logger_1.log.bfa.info({ pollingMs: POLLING_INTERVAL_MS }, '▶ Indexer BFA iniciado');
        // Actualizar estado inicial
        void (0, database_1.query)(`UPDATE bfa_indexer_state
      SET corriendo=TRUE, contract_address=$1, chain_id=$2
      WHERE id=1`, [this.contractAddr, this.chainId]);
        // Sync histórico inicial
        const state = await (0, database_1.queryOne)('SELECT last_block FROM bfa_indexer_state WHERE id=1');
        const fromBlock = state?.last_block ?? START_BLOCK_DEFAULT;
        if (fromBlock === 0) {
            logger_1.log.bfa.info('Sync histórico inicial desde bloque 0...');
            const toBlock = await this.provider.getBlockNumber();
            const indexed = await this.syncRange(START_BLOCK_DEFAULT, toBlock);
            await updateIndexerState(toBlock, indexed);
            logger_1.log.bfa.info({ indexed, toBlock }, 'Sync histórico completado');
        }
        // Iniciar polling periódico
        this.timer = setInterval(() => this.poll(), POLLING_INTERVAL_MS);
        // Intentar suscripción WebSocket para tiempo real
        this.tryWebSocket();
    }
    async stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.isRunning = false;
        await (0, database_1.query)('UPDATE bfa_indexer_state SET corriendo=FALSE WHERE id=1');
        logger_1.log.bfa.info('■ Indexer BFA detenido');
    }
    // ── WebSocket para tiempo real (best-effort) ──────────────
    tryWebSocket() {
        const wsUrl = env_1.env.BFA_WS_URL;
        if (!wsUrl)
            return;
        try {
            const wsProvider = new ethers_1.ethers.WebSocketProvider(wsUrl, {
                chainId: this.chainId,
                name: 'bfa',
            });
            const wsContract = new ethers_1.ethers.Contract(this.contractAddr, EVENTS_ABI, wsProvider);
            const makeHandler = (eventName) => (...args) => {
                const log_ = args[args.length - 1];
                const parsed = parseLog(log_);
                if (!parsed)
                    return;
                upsertEvent(parsed).then(() => updateIndexerState(log_.blockNumber, 1)).catch(() => { });
                logger_1.log.bfa.debug({ eventName, tokenId: parsed.tokenId, txHash: parsed.txHash }, `↗ Evento real-time: ${eventName}`);
            };
            wsContract.on('CITMinted', makeHandler('CITMinted'));
            wsContract.on('CITBloqueado', makeHandler('CITBloqueado'));
            wsContract.on('CITDesbloqueado', makeHandler('CITDesbloqueado'));
            wsContract.on('CITTransferido', makeHandler('CITTransferido'));
            wsProvider.on('error', () => {
                logger_1.log.bfa.warn('WebSocket desconectado — usando solo polling');
                wsContract.removeAllListeners();
            });
            logger_1.log.bfa.info({ wsUrl: wsUrl.replace(/\/\/.*@/, '//***@') }, '✓ WebSocket conectado para eventos real-time');
        }
        catch (err) {
            logger_1.log.bfa.warn({ err: err.message }, 'WebSocket no disponible — solo polling activo');
        }
    }
    // ── Estado del indexer ────────────────────────────────────
    async getStatus() {
        const state = await (0, database_1.queryOne)('SELECT last_block, total_events, ultima_sync, corriendo FROM bfa_indexer_state WHERE id=1');
        const [currentBlock, countByEvent] = await Promise.all([
            this.provider.getBlockNumber().catch(() => -1),
            (0, database_1.query)('SELECT event_name, COUNT(*)::text AS count FROM bfa_eventos GROUP BY event_name ORDER BY event_name'),
        ]);
        return {
            running: this.isRunning,
            lastBlock: state?.last_block ?? 0,
            currentBlock,
            blocksBehind: currentBlock - (state?.last_block ?? 0),
            totalEvents: state?.total_events ?? 0,
            ultimaSync: state?.ultima_sync?.toISOString() ?? null,
            contractAddr: this.contractAddr,
            chainId: this.chainId,
            pollingMs: POLLING_INTERVAL_MS,
            byEvent: Object.fromEntries(countByEvent.map(r => [r.event_name, parseInt(r.count)])),
        };
    }
}
// ══════════════════════════════════════════════════════════
// INDEXER STUB — desarrollo sin nodo BFA
// ══════════════════════════════════════════════════════════
class BFAIndexerStub {
    isRunning = false;
    async start() {
        this.isRunning = true;
        logger_1.log.bfa.warn('⚠️  BFAIndexer STUB activo — los eventos se insertan manualmente via indexStubEvent()');
    }
    async stop() {
        this.isRunning = false;
    }
    async poll() { }
    async getStatus() {
        const countByEvent = await (0, database_1.query)('SELECT event_name, COUNT(*)::text AS count FROM bfa_eventos GROUP BY event_name ORDER BY event_name');
        const totalEvents = countByEvent.reduce((acc, r) => acc + parseInt(r.count), 0);
        return {
            running: this.isRunning,
            lastBlock: 0, currentBlock: 0, blocksBehind: 0,
            totalEvents, ultimaSync: null, contractAddr: 'STUB',
            chainId: 0, pollingMs: 0,
            byEvent: Object.fromEntries(countByEvent.map(r => [r.event_name, parseInt(r.count)])),
            stub: true,
        };
    }
}
// ══════════════════════════════════════════════════════════
// EXPORTAR INSTANCIA
// ══════════════════════════════════════════════════════════
const hasRealConfig = !!((env_1.env.BFA_RPC_URL || env_1.env.BFA_TESTNET_RPC_URL) &&
    env_1.env.BFA_CONTRACT_ADDRESS);
exports.bfaIndexer = hasRealConfig
    ? new BFAIndexerReal()
    : new BFAIndexerStub();
// ── Insertar evento desde el stub BFA para pruebas ─────────
async function indexStubEvent(eventName, tokenId, txHash, blockNumber, data) {
    await upsertEvent({
        eventName, txHash, blockNumber, tokenId,
        rawArgs: {},
        ...data,
    }, new Date());
    await updateIndexerState(blockNumber, 1);
}
/** Verificar CIT por número de serie de la bicicleta */
async function verificarPorSerial(serial) {
    // Buscar TODOS los eventos del token_id asociado al serial
    // (no solo los que tienen serial_bicicleta — lock/unlock/transfer no lo tienen)
    const rows = await (0, database_1.query)(`SELECT e.event_name, e.tx_hash, e.block_number, e.block_timestamp, e.token_id,
            e.hash_sha256, e.numero_cit, e.serial_bicicleta, e.propietario, e.inspector,
            e.motivo, e.de_wallet, e.para_wallet
     FROM bfa_eventos e
     WHERE e.token_id = (
       SELECT token_id FROM bfa_eventos
       WHERE serial_bicicleta = $1 AND event_name = 'CITMinted'
       ORDER BY block_number ASC LIMIT 1
     )
     ORDER BY e.block_number ASC`, [serial]);
    return buildVerificacion(serial, null, rows);
}
/** Verificar CIT por hash SHA-256 del documento */
async function verificarPorHash(hashSHA256) {
    const rows = await (0, database_1.query)(`SELECT e.event_name, e.tx_hash, e.block_number, e.block_timestamp, e.token_id,
            e.hash_sha256, e.numero_cit, e.serial_bicicleta, e.propietario, e.inspector,
            e.motivo, e.de_wallet, e.para_wallet
     FROM bfa_eventos e
     WHERE e.token_id = (
       SELECT token_id FROM bfa_eventos
       WHERE hash_sha256 = $1 AND event_name = 'CITMinted'
       LIMIT 1
     )
     ORDER BY e.block_number ASC`, [hashSHA256]);
    return buildVerificacion(null, hashSHA256, rows);
}
/** Verificar CIT por número (RCIT-2026-00001) */
async function verificarPorNumeroCIT(numeroCIT) {
    const rows = await (0, database_1.query)(`SELECT e.event_name, e.tx_hash, e.block_number, e.block_timestamp, e.token_id,
            e.hash_sha256, e.numero_cit, e.serial_bicicleta, e.propietario, e.inspector,
            e.motivo, e.de_wallet, e.para_wallet
     FROM bfa_eventos e
     WHERE e.token_id = (
       SELECT token_id FROM bfa_eventos
       WHERE numero_cit = $1 AND event_name = 'CITMinted'
       LIMIT 1
     )
     ORDER BY e.block_number ASC`, [numeroCIT]);
    return buildVerificacion(null, null, rows, numeroCIT);
}
function buildVerificacion(serial, hashSHA256, rows, numeroCIT) {
    if (!rows.length) {
        return {
            encontrado: false,
            estado: 'NO_ENCONTRADO',
            bfa: { indexado: false, bloqueado: false, transferencias: 0 },
            historial: [],
        };
    }
    // El mint define los datos base del CIT
    const mint = rows.find(r => r.event_name === 'CITMinted');
    // Estado actual: el último lock/unlock determina si está bloqueado
    let bloqueado = false;
    let bloqueoMotivo;
    const locks = rows.filter(r => r.event_name === 'CITBloqueado');
    const unlocks = rows.filter(r => r.event_name === 'CITDesbloqueado');
    // Si hay más locks que unlocks → está bloqueado
    if (locks.length > unlocks.length) {
        bloqueado = true;
        bloqueoMotivo = String(locks[locks.length - 1].motivo ?? '');
    }
    // Propietario actual: el último transfer, o el mint si no hubo transfers
    const transfers = rows.filter(r => r.event_name === 'CITTransferido');
    const propietarioActual = transfers.length > 0
        ? String(transfers[transfers.length - 1].para_wallet ?? '')
        : String(mint?.propietario ?? '');
    const estado = bloqueado ? 'BLOQUEADO'
        : transfers.length > 0 ? 'TRANSFERIDO'
            : 'ACTIVO';
    const ultimaTransferencia = transfers.length > 0
        ? String(transfers[transfers.length - 1].tx_hash ?? '')
        : undefined;
    return {
        encontrado: true,
        serial: String(mint?.serial_bicicleta ?? serial ?? ''),
        hashSHA256: String(mint?.hash_sha256 ?? hashSHA256 ?? ''),
        numeroCIT: String(mint?.numero_cit ?? numeroCIT ?? ''),
        estado,
        propietario: propietarioActual,
        inspector: String(mint?.inspector ?? ''),
        emitidoEn: mint?.block_timestamp ? new Date(mint.block_timestamp).toISOString() : undefined,
        bfa: {
            indexado: true,
            tokenId: Number(mint?.token_id ?? 0) || undefined,
            mintTxHash: String(mint?.tx_hash ?? ''),
            mintBloque: Number(mint?.block_number ?? 0) || undefined,
            bloqueado,
            bloqueoMotivo,
            transferencias: transfers.length,
            ultimaTransferencia,
        },
        historial: rows.map(r => ({
            tipo: r.event_name,
            txHash: String(r.tx_hash ?? ''),
            bloque: Number(r.block_number ?? 0),
            timestamp: r.block_timestamp ? new Date(r.block_timestamp).toISOString() : undefined,
            datos: r.event_name === 'CITMinted' ? { propietario: String(r.propietario ?? ''), inspector: String(r.inspector ?? '') }
                : r.event_name === 'CITBloqueado' ? { motivo: String(r.motivo ?? '') }
                    : r.event_name === 'CITTransferido' ? { de: String(r.de_wallet ?? ''), para: String(r.para_wallet ?? '') }
                        : undefined,
        })),
    };
}
// ── Estadísticas globales para admin ─────────────────────
async function getIndexerStats() {
    const [state, byEvent, recientes] = await Promise.all([
        (0, database_1.queryOne)('SELECT last_block, total_events, ultima_sync FROM bfa_indexer_state WHERE id=1'),
        (0, database_1.query)('SELECT event_name, COUNT(*)::text AS count FROM bfa_eventos GROUP BY event_name'),
        (0, database_1.query)('SELECT event_name, tx_hash, block_number, indexado_en FROM bfa_eventos ORDER BY indexado_en DESC LIMIT 5'),
    ]);
    return {
        lastBlock: state?.last_block ?? 0,
        totalEvents: state?.total_events ?? 0,
        ultimaSync: state?.ultima_sync?.toISOString() ?? null,
        byEvent: Object.fromEntries(byEvent.map(r => [r.event_name, parseInt(r.count)])),
        recientes,
    };
}
// ── Iniciar indexer desde server.ts ─────────────────────
let indexerStarted = false;
async function startIndexer() {
    if (indexerStarted)
        return;
    indexerStarted = true;
    try {
        await exports.bfaIndexer.start();
    }
    catch (err) {
        logger_1.log.bfa.error({ err: err.message }, 'Error iniciando indexer');
    }
}
