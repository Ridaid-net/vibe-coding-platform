"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bfaService = void 0;
exports.hashCIT = hashCIT;
exports.isValidSHA256 = isValidSHA256;
const ethers_1 = require("ethers");
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
const logger_1 = require("../middleware/logger");
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
];
// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function hashCIT(content) {
    return crypto_1.default.createHash('sha256')
        .update(typeof content === 'string' ? Buffer.from(content, 'utf8') : content)
        .digest('hex');
}
function isValidSHA256(hash) {
    return /^[a-f0-9]{64}$/i.test(hash);
}
// Clasificar errores de ethers.js para mensajes claros al usuario
function classifyBFAError(err) {
    const msg = String(err?.message ?? err);
    if (msg.includes('INSUFFICIENT_FUNDS') || msg.includes('insufficient funds')) {
        return `Saldo insuficiente en wallet BFA. Contactar a ONTI para recargar fondos.`;
    }
    if (msg.includes('nonce too low') || msg.includes('NONCE_EXPIRED')) {
        return `Conflicto de nonce — reintentar en unos segundos.`;
    }
    if (msg.includes('already known') || msg.includes('replacement fee too low')) {
        return `Transacción duplicada o precio de gas insuficiente para reemplazo.`;
    }
    if (msg.includes('execution reverted') || msg.includes('reverted')) {
        // Extraer el mensaje de revert si es posible
        const revertMatch = msg.match(/reverted[^:]*:\s*(.+?)(?:$|\n)/);
        return `Contrato rechazó la transacción: ${revertMatch?.[1] ?? msg.slice(0, 100)}`;
    }
    if (msg.includes('timeout') || msg.includes('TIMEOUT') || msg.includes('NETWORK_ERROR')) {
        return `Timeout conectando al nodo BFA. El nodo puede estar caído.`;
    }
    if (msg.includes('network changed') || msg.includes('underlying network changed')) {
        return `Red BFA cambió — reconectar.`;
    }
    return msg.slice(0, 200);
}
// ══════════════════════════════════════════════════════════
// NONCE MANAGER — evita conflictos en requests concurrentes
// ══════════════════════════════════════════════════════════
class NonceManager {
    wallet;
    nonce = null;
    pending = 0; // txs en vuelo
    lock = Promise.resolve();
    constructor(wallet) {
        this.wallet = wallet;
    }
    /** Obtiene el próximo nonce de forma segura bajo concurrencia */
    async nextNonce() {
        // Serializar el acceso para evitar dos txs con el mismo nonce
        let resolve;
        const prevLock = this.lock;
        this.lock = new Promise(r => { resolve = r; });
        await prevLock;
        try {
            if (this.nonce === null || this.pending === 0) {
                // Obtener nonce actual de la red (fuente de verdad)
                this.nonce = await this.wallet.getNonce('pending');
            }
            const n = this.nonce;
            this.nonce++;
            this.pending++;
            return n;
        }
        finally {
            resolve();
        }
    }
    /** Llamar cuando la tx confirma o falla */
    txConfirmed() {
        this.pending = Math.max(0, this.pending - 1);
    }
    /** Resetear en caso de error de nonce */
    async reset() {
        this.nonce = null;
        this.pending = 0;
        logger_1.log.bfa.warn('NonceManager: nonce reseteado — reconectando con la red');
    }
}
// ══════════════════════════════════════════════════════════
// GAS STRATEGY — precio de gas óptimo
// ══════════════════════════════════════════════════════════
const GAS_BUFFER_PCT = 20n; // +20% sobre la estimación
const GAS_LIMIT_MAX = 500000n;
const GAS_PRICE_BUMP = 110n; // 10% bump en reenvíos
async function estimateGasWithBuffer(provider, tx) {
    try {
        const estimated = await provider.estimateGas(tx);
        const withBuffer = estimated * (100n + GAS_BUFFER_PCT) / 100n;
        return withBuffer < GAS_LIMIT_MAX ? withBuffer : GAS_LIMIT_MAX;
    }
    catch {
        logger_1.log.bfa.warn('Gas estimation falló — usando límite por defecto');
        return 200000n;
    }
}
async function getFeeData(provider) {
    const feeData = await provider.getFeeData();
    // BFA usa PoA Ethereum — detectar soporte EIP-1559
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        return {
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
            isEIP1559: true,
        };
    }
    // Legacy gas price (PoA networks como BFA)
    return {
        gasPrice: feeData.gasPrice ?? 1000000000n,
        isEIP1559: false,
    };
}
// ══════════════════════════════════════════════════════════
// CIRCUIT BREAKER — pausa envíos si el nodo está caído
// ══════════════════════════════════════════════════════════
class CircuitBreaker {
    failures = 0;
    lastFailure = 0;
    THRESHOLD = 5; // fallos consecutivos para abrir el circuito
    RESET_TIME_MS = 60_000; // 1 min de espera antes de reintentar
    canSend() {
        if (this.failures < this.THRESHOLD)
            return true;
        if (Date.now() - this.lastFailure > this.RESET_TIME_MS) {
            this.failures = 0;
            return true;
        }
        return false;
    }
    onSuccess() { this.failures = 0; }
    onFailure() {
        this.failures++;
        this.lastFailure = Date.now();
        if (this.failures >= this.THRESHOLD) {
            logger_1.log.bfa.error({ failures: this.failures }, '🔴 Circuit breaker ABIERTO — demasiados errores BFA consecutivos');
        }
    }
    isOpen() { return this.failures >= this.THRESHOLD; }
}
class BFAServiceReal {
    provider;
    wallet;
    contract;
    nonces;
    breaker;
    walletAddress;
    chainId;
    confirmations;
    constructor() {
        const rpcUrl = (env_1.env.BFA_RPC_URL ?? env_1.env.BFA_TESTNET_RPC_URL);
        this.chainId = env_1.env.BFA_CHAIN_ID ?? 4337;
        this.confirmations = this.chainId === 4337 ? 3 : 1; // mainnet más confirmaciones
        this.provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl, {
            chainId: this.chainId,
            name: this.chainId === 4337 ? 'bfa' : 'bfa-testnet',
        });
        this.wallet = new ethers_1.ethers.Wallet(env_1.env.BFA_WALLET_PRIVATE_KEY, this.provider);
        this.contract = new ethers_1.ethers.Contract(env_1.env.BFA_CONTRACT_ADDRESS, CIT_ABI, this.wallet);
        this.nonces = new NonceManager(this.wallet);
        this.breaker = new CircuitBreaker();
        this.walletAddress = this.wallet.address;
        this.provider.on('error', (err) => {
            logger_1.log.bfa.error({ err: err.message }, 'Provider error — nonce manager reseteado');
            this.nonces.reset();
        });
        logger_1.log.bfa.info({
            wallet: this.walletAddress,
            contract: env_1.env.BFA_CONTRACT_ADDRESS.slice(0, 10) + '...',
            chainId: this.chainId,
            rpc: rpcUrl.replace(/\/\/.*@/, '//***@'), // ocultar credenciales en URL
        }, '✓ BFAServiceReal inicializado');
    }
    // ── Enviar transacción con nonce manager + circuit breaker ──
    async sendTx(method, args, logCtx) {
        if (this.breaker.isOpen()) {
            throw new Error(`BFA circuit breaker abierto — demasiados errores consecutivos. Reintentar en 1 min.`);
        }
        const timer = (0, logger_1.startTimer)(`bfa.${method}`, logCtx);
        const nonce = await this.nonces.nextNonce();
        logger_1.log.bfa.info({ method, nonce, ...logCtx }, `BFA: enviando ${method}`);
        try {
            // Construir tx para estimación de gas
            const txReq = await this.contract[method](...args);
            // Obtener gas + fee data
            const feeData = await getFeeData(this.provider);
            const gasLimit = await estimateGasWithBuffer(this.provider, {
                to: await this.contract.getAddress(),
                data: (await this.contract[method].populateTransaction(...args)).data,
                from: this.walletAddress,
            });
            // Enviar transacción firmada
            const tx = await this.contract[method].send(...args, {
                nonce,
                gasLimit,
                ...(feeData.isEIP1559
                    ? { maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas }
                    : { gasPrice: feeData.gasPrice }),
            });
            logger_1.log.bfa.debug({ method, txHash: tx.hash, nonce, gasLimit: gasLimit.toString() }, 'TX enviada');
            // Esperar confirmaciones
            const receipt = await tx.wait(this.confirmations);
            if (!receipt)
                throw new Error('Receipt nulo tras confirmación');
            const ms = timer({ txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
            this.breaker.onSuccess();
            this.nonces.txConfirmed();
            logger_1.log.bfa.info({
                method, txHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                ms, ...logCtx,
            }, `✓ BFA ${method} confirmado`);
            return receipt;
        }
        catch (err) {
            this.nonces.txConfirmed();
            this.breaker.onFailure();
            const isNonceError = String(err.message).includes('nonce');
            if (isNonceError)
                await this.nonces.reset();
            const friendly = classifyBFAError(err);
            logger_1.log.bfa.error({ method, nonce, friendly, raw: err.message?.slice(0, 200), ...logCtx }, `✗ BFA ${method} falló`);
            throw new Error(friendly);
        }
    }
    // ── Mint — serial + inspectorId + hashSHA256 → tokenId ──
    async mint(propietario, hashSHA256, numeroCIT, serialBicicleta) {
        if (!isValidSHA256(hashSHA256))
            throw new Error(`hashSHA256 inválido: debe ser SHA-256 hex de 64 chars`);
        if (!propietario || propietario === ethers_1.ethers.ZeroAddress)
            throw new Error('Dirección propietario inválida');
        const receipt = await this.sendTx('mint', [propietario, hashSHA256, numeroCIT, serialBicicleta], {
            numeroCIT, serial: serialBicicleta,
            hash: hashSHA256.slice(0, 16) + '...',
        });
        // Extraer tokenId del evento CITMinted
        const iface = new ethers_1.ethers.Interface(CIT_ABI);
        let tokenId = 0;
        for (const log_ of receipt.logs) {
            try {
                const parsed = iface.parseLog({ topics: [...log_.topics], data: log_.data });
                if (parsed?.name === 'CITMinted') {
                    tokenId = Number(parsed.args.tokenId);
                    break;
                }
            }
            catch { /* log no pertenece a este contrato */ }
        }
        if (tokenId === 0) {
            logger_1.log.bfa.warn({ txHash: receipt.hash }, 'CITMinted event no encontrado — usando fallback totalEmitidos');
            tokenId = Number(await this.contract.totalEmitidos());
        }
        return {
            txHash: receipt.hash,
            tokenId,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
        };
    }
    // ── Bloquear NFT por denuncia de robo ───────────────────
    async bloquear(tokenId, motivo) {
        const receipt = await this.sendTx('bloquear', [tokenId, motivo], { tokenId, motivo: motivo.slice(0, 40) });
        return receipt.hash;
    }
    // ── Desbloquear NFT (bicicleta recuperada) ──────────────
    async desbloquear(tokenId) {
        const receipt = await this.sendTx('desbloquear', [tokenId], { tokenId });
        return receipt.hash;
    }
    // ── Transferir NFT (compraventa) ────────────────────────
    async transferirCIT(tokenId, nuevoPropietario) {
        const receipt = await this.sendTx('transferirCIT', [tokenId, nuevoPropietario], {
            tokenId, destino: nuevoPropietario.slice(0, 10) + '...',
        });
        return receipt.hash;
    }
    // ── Consultas de lectura (sin gas) ──────────────────────
    async verificarIntegridad(hashSHA256) {
        const result = await this.contract.verificarIntegridad(hashSHA256);
        return { valido: result.valido, bloqueado: result.bloqueado, tokenId: Number(result.tokenId) };
    }
    async datosCIT(tokenId) {
        try {
            const d = await this.contract.datosCIT(tokenId);
            return {
                hashSHA256: d.hashSHA256,
                numeroCIT: d.numeroCIT,
                serialBicicleta: d.serialBicicleta,
                propietario: d.propietario,
                bloqueado: d.bloqueado,
                motivoBloqueo: d.motivoBloqueo,
                emitidoEn: Number(d.emitidoEn),
                bloqueadoEn: Number(d.bloqueadoEn),
                inspector: d.inspector,
            };
        }
        catch {
            return null;
        }
    }
    async tokenPorHash(hashSHA256) {
        return Number(await this.contract.tokenPorHash(hashSHA256));
    }
    async historialPorSerial(serial) {
        const ids = await this.contract.historialPorSerial(serial);
        return ids.map(Number);
    }
    async totalEmitidos() {
        return Number(await this.contract.totalEmitidos());
    }
    // ── Health check — estado del wallet y el nodo ─────────
    async healthCheck() {
        try {
            const [balance, blockNumber, nonce, paused, total] = await Promise.all([
                this.provider.getBalance(this.walletAddress),
                this.provider.getBlockNumber(),
                this.wallet.getNonce(),
                this.contract.paused(),
                this.contract.totalEmitidos(),
            ]);
            return {
                ok: true,
                walletAddress: this.walletAddress,
                balance: ethers_1.ethers.formatEther(balance),
                balanceWei: balance.toString(),
                nonce,
                chainId: this.chainId,
                blockNumber,
                contractAddr: env_1.env.BFA_CONTRACT_ADDRESS,
                paused,
                totalCITs: Number(total),
                circuitBreaker: this.breaker.isOpen() ? 'open' : 'closed',
            };
        }
        catch (err) {
            return {
                ok: false,
                walletAddress: this.walletAddress,
                balance: '0',
                balanceWei: '0',
                nonce: -1,
                chainId: this.chainId,
                blockNumber: -1,
                contractAddr: env_1.env.BFA_CONTRACT_ADDRESS ?? '',
                paused: false,
                totalCITs: -1,
                circuitBreaker: this.breaker.isOpen() ? 'open' : 'closed',
                error: classifyBFAError(err),
            };
        }
    }
}
class BFAServiceStub {
    tokens = new Map();
    hashIndex = new Map();
    counter = 1000;
    async mint(to, hashSHA256, numeroCIT, serialBicicleta = '') {
        if (!isValidSHA256(hashSHA256))
            throw new Error(`BFA Stub: hashSHA256 inválido (64 chars hex): ${hashSHA256}`);
        if (this.hashIndex.has(hashSHA256))
            throw new Error(`BFA Stub: hash ya registrado (CIT duplicado): ${hashSHA256.slice(0, 16)}...`);
        const tokenId = this.counter++;
        this.tokens.set(tokenId, {
            hashSHA256, numeroCIT, serialBicicleta,
            propietario: to || '0x000000000000000000000000000000000000dEaD',
            bloqueado: false, motivoBloqueo: '', emitidoEn: Date.now(), tokenId,
        });
        this.hashIndex.set(hashSHA256, tokenId);
        await new Promise(r => setTimeout(r, 120));
        const txHash = '0xSTUB' + crypto_1.default.randomBytes(28).toString('hex');
        logger_1.log.bfa.warn({ stub: true, tokenId, numeroCIT, hash: hashSHA256.slice(0, 16) + '...' }, '⚠️  BFA STUB');
        return { txHash, tokenId, blockNumber: 1_000_000 + tokenId, gasUsed: '85000' };
    }
    async bloquear(tokenId, motivo) {
        const t = this.tokens.get(tokenId);
        if (!t)
            throw new Error(`BFA Stub: token ${tokenId} no existe`);
        if (t.bloqueado)
            throw new Error(`BFA Stub: token ${tokenId} ya bloqueado`);
        t.bloqueado = true;
        t.motivoBloqueo = motivo;
        await new Promise(r => setTimeout(r, 50));
        return '0xLOCK' + crypto_1.default.randomBytes(28).toString('hex');
    }
    async desbloquear(tokenId) {
        const t = this.tokens.get(tokenId);
        if (!t)
            throw new Error(`BFA Stub: token ${tokenId} no existe`);
        if (!t.bloqueado)
            throw new Error(`BFA Stub: token ${tokenId} no estaba bloqueado`);
        t.bloqueado = false;
        t.motivoBloqueo = '';
        await new Promise(r => setTimeout(r, 50));
        return '0xUNLK' + crypto_1.default.randomBytes(28).toString('hex');
    }
    async transferirCIT(tokenId, newOwner) {
        const t = this.tokens.get(tokenId);
        if (!t)
            throw new Error(`BFA Stub: token ${tokenId} no existe`);
        if (t.bloqueado)
            throw new Error(`BFA Stub: token ${tokenId} bloqueado — no se puede transferir`);
        t.propietario = newOwner;
        await new Promise(r => setTimeout(r, 80));
        return '0xTXFR' + crypto_1.default.randomBytes(28).toString('hex');
    }
    async datosCIT(tokenId) {
        const t = this.tokens.get(tokenId);
        if (!t)
            return null;
        return { hashSHA256: t.hashSHA256, numeroCIT: t.numeroCIT, serialBicicleta: t.serialBicicleta, propietario: t.propietario, bloqueado: t.bloqueado, motivoBloqueo: t.motivoBloqueo, emitidoEn: t.emitidoEn, bloqueadoEn: 0, inspector: '0x0000000000000000000000000000000000000000' };
    }
    async verificarIntegridad(hashSHA256) {
        const tokenId = this.hashIndex.get(hashSHA256);
        if (!tokenId)
            return { valido: false, bloqueado: false, tokenId: 0 };
        const t = this.tokens.get(tokenId);
        return { valido: true, bloqueado: t.bloqueado, tokenId };
    }
    async tokenPorHash(hashSHA256) {
        return this.hashIndex.get(hashSHA256) ?? 0;
    }
    async historialPorSerial(serial) {
        const ids = [];
        for (const t of this.tokens.values()) {
            if (t.serialBicicleta === serial)
                ids.push(t.tokenId);
        }
        return ids;
    }
    async totalEmitidos() { return this.tokens.size; }
    async healthCheck() {
        return {
            ok: true, walletAddress: '0xSTUB', balance: '∞', balanceWei: '0',
            nonce: 0, chainId: 0, blockNumber: 0, contractAddr: 'STUB',
            paused: false, totalCITs: this.tokens.size, circuitBreaker: 'closed',
        };
    }
}
const hasRealConfig = !!((env_1.env.BFA_RPC_URL || env_1.env.BFA_TESTNET_RPC_URL) &&
    env_1.env.BFA_WALLET_PRIVATE_KEY &&
    env_1.env.BFA_CONTRACT_ADDRESS);
exports.bfaService = hasRealConfig
    ? new BFAServiceReal()
    : new BFAServiceStub();
if (!hasRealConfig) {
    logger_1.log.bfa.warn({
        mode: 'STUB',
        faltantes: [
            !env_1.env.BFA_RPC_URL && !env_1.env.BFA_TESTNET_RPC_URL ? 'BFA_RPC_URL' : null,
            !env_1.env.BFA_WALLET_PRIVATE_KEY ? 'BFA_WALLET_PRIVATE_KEY' : null,
            !env_1.env.BFA_CONTRACT_ADDRESS ? 'BFA_CONTRACT_ADDRESS' : null,
        ].filter(Boolean),
    }, '⚠️  BFA STUB activo — para producción configurar las variables de entorno BFA_*');
}
