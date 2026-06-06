// ─── RODAID · bfaService — consulta on-chain a la BFA (alta fidelidad) ─────
//
// Servicio que emula, con alta fidelidad, la lectura del contrato inteligente
// `RodaidCIT.sol` desplegado en la Blockchain Federal Argentina (BFA). Modela
// las funciones `view` del contrato sin requerir un nodo real, de modo que el
// Verificador Público pueda cruzar el hash on-chain en cada consulta:
//
//   · verificarIntegridad(tokenId, hash) → { valido, bloqueado, tokenId }
//   · datosCIT(tokenId)                  → { hashSHA256, serial, bloqueado, propietario }
//
// El "ledger" on-chain es el estado INMUTABLE del contrato: el hash que se grabó
// al mint de cada CIT. Coincide con el índice local de eventos (bfa_eventos);
// puede divergir del documento de la base de datos sólo si éste fue manipulado.
//
// Resiliencia (fail-open): `consultarBFAOnChain` NUNCA lanza ni rechaza. Si se
// simula un timeout de red o el nodo de la BFA está caído, devuelve
// `consultada: false` con la latencia agotada y deja que la verificación
// continúe con los datos locales de Netlify Blobs. No debe trabar al inspector.
//
// Producción (no requerido en este entorno simulado):
//   BFA_RPC_URL=https://publicnode.testnet.bfa.ar
//   BFA_CONTRACT_ADDRESS=0x...           // contrato RodaidCIT deployado

import { MOCK_SEED, getEventoIndexHash } from '@/lib/mockApi'

// ── Estado on-chain (ledger inmutable del contrato) ────────────────────────

interface OnChainToken {
  tokenId: number
  serial: string
  hashSHA256: string // hash grabado al mint (inmutable)
  bloqueado: boolean
  bloqueoMotivo?: string
  transferencias: number
  propietario: string
}

type SeedRecord = {
  serial: string
  nftTokenId?: number | null
  propietario?: { nombre?: string; apellido?: string } | null
  bfa?: {
    indexado?: boolean
    tokenId?: number | null
    bloqueado?: boolean
    bloqueoMotivo?: string
    transferencias?: number
  } | null
}

/**
 * Reconstruye el ledger on-chain a partir de los CIT minteados. El hash on-chain
 * se toma del índice local de eventos (hash original de mint), de modo que la
 * cadena y el índice local siempre concuerden; sólo el documento de la DB puede
 * divergir si fue manipulado.
 */
function construirLedger(): Map<string, OnChainToken> {
  const ledger = new Map<string, OnChainToken>()
  const seed = MOCK_SEED as Record<string, SeedRecord>

  for (const rec of Object.values(seed)) {
    if (!rec?.bfa?.indexado) continue
    const serial = String(rec.serial).toUpperCase()
    const hash = getEventoIndexHash(serial)
    const tokenId = rec.bfa.tokenId ?? rec.nftTokenId ?? 0
    if (!hash || !tokenId) continue

    ledger.set(serial, {
      tokenId,
      serial,
      hashSHA256: hash,
      bloqueado: Boolean(rec.bfa.bloqueado),
      bloqueoMotivo: rec.bfa.bloqueoMotivo,
      transferencias: typeof rec.bfa.transferencias === 'number' ? rec.bfa.transferencias : 0,
      propietario: rec.propietario
        ? `${rec.propietario.nombre ?? ''} ${rec.propietario.apellido ?? ''}`.trim()
        : '',
    })
  }
  return ledger
}

// El ledger es estado inmutable: se construye una sola vez por instancia.
let LEDGER: Map<string, OnChainToken> | null = null
function ledger(): Map<string, OnChainToken> {
  if (!LEDGER) LEDGER = construirLedger()
  return LEDGER
}

// ── Funciones `view` del contrato RodaidCIT.sol ────────────────────────────

/** view RodaidCIT.datosCIT(tokenId) — devuelve los datos on-chain del token. */
export function datosCIT(tokenId: number): OnChainToken | null {
  for (const tok of ledger().values()) {
    if (tok.tokenId === tokenId) return tok
  }
  return null
}

/** view RodaidCIT.verificarIntegridad(tokenId, hash) — compara contra el mint. */
export function verificarIntegridad(
  tokenId: number,
  hash: string
): { valido: boolean; bloqueado: boolean; tokenId: number } | null {
  const tok = datosCIT(tokenId)
  if (!tok) return null
  return {
    valido: tok.hashSHA256.toLowerCase() === String(hash).toLowerCase() && !tok.bloqueado,
    bloqueado: tok.bloqueado,
    tokenId: tok.tokenId,
  }
}

// ── Orquestador de la consulta on-chain (resiliente / fail-open) ───────────

export interface ResultadoOnChain {
  consultada: boolean // false si el nodo no respondió (fail-open)
  indexado: boolean // el serial existe on-chain (fue minteado)
  tokenId: number | null
  hashOnChain: string | null
  bloqueadoOnChain: boolean | null
  bloqueoMotivo?: string
  transferencias: number | null
  latenciaNodo: number // ms
  nodo: string // host del nodo, o 'ERROR' si cayó
  error?: string
}

const NODO_POR_DEFECTO = 'bfa.ar'
const TIMEOUT_MS = 8000

function nodoHost(): string {
  const url = process.env.BFA_RPC_URL
  if (!url) return NODO_POR_DEFECTO
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Latencia simulada determinística (sin red real), para reportar el nodo. */
function latenciaSimulada(tokenId: number, base: number): number {
  return base + (tokenId % 60)
}

/**
 * Consulta el estado on-chain de un serial. Resuelve SIEMPRE (nunca lanza), para
 * poder ejecutarse dentro de un `Promise.all` junto al resto de las consultas
 * sin que un fallo de la BFA tumbe la verificación.
 *
 * Simula la caída del nodo cuando `opts.forzarTimeout` es true o la variable de
 * entorno `BFA_SIMULAR_TIMEOUT` está activa: en ese caso devuelve
 * `consultada: false`, replicando un timeout de red (`bfa.ar` caído).
 */
export async function consultarBFAOnChain(
  serial: string,
  opts: { forzarTimeout?: boolean } = {}
): Promise<ResultadoOnChain> {
  const key = String(serial ?? '').trim().toUpperCase()
  const caido = opts.forzarTimeout || process.env.BFA_SIMULAR_TIMEOUT === 'true'

  // Fail-open: nodo caído / timeout de red. La verificación sigue con datos locales.
  if (caido) {
    return {
      consultada: false,
      indexado: false,
      tokenId: null,
      hashOnChain: null,
      bloqueadoOnChain: null,
      transferencias: null,
      latenciaNodo: TIMEOUT_MS + 43,
      nodo: 'ERROR',
      error: 'fetch failed: ECONNREFUSED (nodo BFA no respondió)',
    }
  }

  try {
    const tok = datosCIT0(key)

    // Serial no minteado on-chain: la consulta fue exitosa pero no está indexado.
    if (!tok) {
      return {
        consultada: true,
        indexado: false,
        tokenId: null,
        hashOnChain: null,
        bloqueadoOnChain: null,
        transferencias: null,
        latenciaNodo: latenciaSimulada(1, 30),
        nodo: nodoHost(),
      }
    }

    return {
      consultada: true,
      indexado: true,
      tokenId: tok.tokenId,
      hashOnChain: tok.hashSHA256,
      bloqueadoOnChain: tok.bloqueado,
      bloqueoMotivo: tok.bloqueoMotivo,
      transferencias: tok.transferencias,
      latenciaNodo: latenciaSimulada(tok.tokenId, 30),
      nodo: nodoHost(),
    }
  } catch (err) {
    // Cualquier error inesperado se trata como nodo no disponible (fail-open).
    return {
      consultada: false,
      indexado: false,
      tokenId: null,
      hashOnChain: null,
      bloqueadoOnChain: null,
      transferencias: null,
      latenciaNodo: TIMEOUT_MS,
      nodo: 'ERROR',
      error: err instanceof Error ? err.message : 'error desconocido en nodo BFA',
    }
  }
}

/** Lookup on-chain por serial (resuelve serial → token del ledger). */
function datosCIT0(serial: string): OnChainToken | null {
  return ledger().get(serial) ?? null
}
