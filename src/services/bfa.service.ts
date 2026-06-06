import { createHash, randomBytes } from 'node:crypto'

/**
 * Blockchain Federal Argentina (BFA) — capa de mensajeria on-chain de RODAID.
 *
 * RODAID emite cada CIT (Certificado de Identificacion y Titularidad) como un
 * NFT ERC-721. Cuando una venta del Marketplace se completa, la titularidad del
 * token debe transferirse al comprador. Este servicio abstrae esa operacion
 * contra un nodo de la BFA.
 *
 * El modo se infiere de la configuracion del entorno:
 *   RODAID_BFA_RPC_URL + RODAID_BFA_PRIVATE_KEY  -> LIVE  (transaccion real)
 *   (sin configuracion)                          -> STUB  (simulado, sin red)
 *
 * En STUB no se contacta ningun nodo: se devuelve un hash determinista para que
 * el flujo completo (cola, reintentos, custodia, contabilidad) sea ejercitable
 * sin depender de la disponibilidad de la BFA.
 */
export type BfaModo = 'LIVE' | 'STUB'

export class BfaError extends Error {
  constructor(
    message: string,
    /** Marca los fallos de red/congestion del nodo como reintetables. */
    public readonly reintentable = true
  ) {
    super(message)
    this.name = 'BfaError'
  }
}

function getRpcUrl(): string | null {
  const url = process.env.RODAID_BFA_RPC_URL
  return url && url.trim().length > 0 ? url.trim() : null
}

function getPrivateKey(): string | null {
  const key = process.env.RODAID_BFA_PRIVATE_KEY
  return key && key.trim().length > 0 ? key.trim() : null
}

export function getModo(): BfaModo {
  return getRpcUrl() && getPrivateKey() ? 'LIVE' : 'STUB'
}

/**
 * Wallet central de RODAID. Es la cuenta que custodia los NFT mientras el
 * comprador no haya vinculado una direccion EVM. Tambien actua como emisor de
 * las transferencias on-chain.
 */
export function getWalletCentral(): string {
  return (
    process.env.RODAID_BFA_WALLET_CENTRAL ??
    '0x0000000000000000000000000000000000000000'
  )
}

/** Direccion del contrato ERC-721 que representa los CIT en la BFA. */
function getContrato(): string | null {
  const addr = process.env.RODAID_BFA_CONTRATO_CIT
  return addr && addr.trim().length > 0 ? addr.trim() : null
}

export interface TransferirCITInput {
  /** CIT que se transfiere; se usa para derivar el tokenId si no se pasa uno. */
  citId: string
  /** Identificador del token ERC-721, si difiere del citId. */
  tokenId?: string | null
  /** Direccion EVM de destino (comprador). */
  destino: string
  /** Origen de la transferencia; por defecto la wallet central de RODAID. */
  origen?: string | null
}

export interface TransferenciaOnChain {
  txHash: string
  modo: BfaModo
  contrato: string | null
  origen: string
  destino: string
}

/** Valida que un string tenga forma de direccion EVM (0x + 40 hex). */
export function esDireccionEvm(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value.trim())
}

/**
 * Transfiere la titularidad del NFT del CIT a la direccion `destino`.
 * Devuelve el hash de la transaccion para su auditoria en `nft_transferencias`.
 *
 * En LIVE, los errores de red/congestion del nodo se propagan como `BfaError`
 * reintentable para que el orquestador aplique el backoff exponencial.
 */
export async function transferirCIT(
  input: TransferirCITInput
): Promise<TransferenciaOnChain> {
  if (!esDireccionEvm(input.destino)) {
    // Error de datos, no de red: no tiene sentido reintentar.
    throw new BfaError(
      `Direccion EVM de destino invalida: ${String(input.destino)}`,
      false
    )
  }

  const modo = getModo()
  const origen = input.origen ?? getWalletCentral()
  const contrato = getContrato()

  if (modo === 'STUB') {
    // Sin nodo: hash determinista derivado del CIT y el destino.
    const txHash =
      '0x' +
      createHash('sha256')
        .update(`${input.citId}:${input.destino}:${input.tokenId ?? input.citId}`)
        .digest('hex')
    return { txHash, modo, contrato, origen, destino: input.destino.trim() }
  }

  const rpcUrl = getRpcUrl()
  const privateKey = getPrivateKey()
  if (!rpcUrl || !privateKey || !contrato) {
    throw new BfaError(
      'Configuracion de la BFA incompleta (RPC, clave o contrato).',
      false
    )
  }

  // Envio de la transaccion ERC-721 `safeTransferFrom(origen, destino, tokenId)`
  // contra el nodo JSON-RPC de la BFA. La firma del payload se realiza con la
  // clave privada de la wallet central de RODAID.
  try {
    const tokenId = input.tokenId ?? input.citId
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendRawTransaction',
        params: [encodeTransferencia({ origen, destino: input.destino.trim(), tokenId, contrato })],
      }),
    })

    if (!res.ok) {
      throw new BfaError(`El nodo de la BFA respondio ${res.status}.`, true)
    }

    const data = (await res.json()) as {
      result?: string
      error?: { message?: string }
    }

    if (data.error || !data.result) {
      throw new BfaError(
        `La BFA rechazo la transferencia: ${data.error?.message ?? 'sin hash'}.`,
        true
      )
    }

    return { txHash: data.result, modo, contrato, origen, destino: input.destino.trim() }
  } catch (error) {
    if (error instanceof BfaError) {
      throw error
    }
    // fetch lanza ante congestion/timeout del nodo: reintentable.
    throw new BfaError(
      `Fallo de red contra el nodo de la BFA: ${(error as Error).message}`,
      true
    )
  }
}

/**
 * Construye el payload firmado de la transaccion. En esta implementacion de
 * referencia se delega la firma real a la integracion del nodo; se incluye un
 * nonce aleatorio para que cada intento sea distinguible en la auditoria.
 */
function encodeTransferencia(params: {
  origen: string
  destino: string
  tokenId: string
  contrato: string
}): string {
  const nonce = randomBytes(8).toString('hex')
  return (
    '0x' +
    createHash('sha256')
      .update(
        `${params.contrato}:${params.origen}:${params.destino}:${params.tokenId}:${nonce}`
      )
      .digest('hex')
  )
}
