import { createHash } from 'node:crypto'

/**
 * RODAID — Modulo 4 (CIT): Configuracion Final · Acunacion del NFT en BFA.
 *
 * Toma un Certificado de Identidad Tecnica ya sellado y lo representa como un NFT
 * anclado en la Blockchain Federal Argentina (BFA). La pieza criptografica que se
 * estampa on-chain es la huella SHA-256 del certificado (calculada en el intake e
 * inmutable desde entonces): la identidad del token deriva de esa huella, de modo
 * que un certificado mapea a exactamente un NFT, reproducible y verificable.
 *
 * Construido solo sobre `node:crypto` (sin dependencias externas ni de framework),
 * para que sea importable tanto desde el route handler de Next como desde la funcion
 * programada de Netlify, y unit-testeable de forma aislada.
 *
 * La construccion del NFT (token id + metadata + hash de metadata) es totalmente
 * deterministica y NO realiza llamadas de red. La submission a BFA si es de red y
 * esta detras de un gateway configurable: si no hay gateway configurado, NO se
 * inventa una transaccion (se senaliza `BFA_NO_CONFIGURADA` y el certificado queda
 * a la espera), preservando la honestidad del estado on-chain.
 */

export const BFA_ESQUEMA_NFT = 'RODAID-CIT-NFT-v1'

/** Error tipado de la capa BFA. El servicio lo mapea a su ApiError; el worker lo loguea. */
export class BfaError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
    /**
     * `true` si el fallo es transitorio (red/timeout/5xx) y conviene reintentar;
     * `false` si es fatal (rechazo del contrato: huella ya anclada, destino
     * invalido) y no debe reintentarse automaticamente.
     */
    public reintentable = true
  ) {
    super(message)
    this.name = 'BfaError'
  }
}

// ── Configuracion ────────────────────────────────────────────────────────────

export interface BfaConfig {
  /** Nombre legible de la red destino. */
  redNombre: string
  /** Identificador de cadena (etiqueta de configuracion; participa del objetoId). */
  chainId: string
  /** Direccion/identificador del contrato de acunacion, si aplica. */
  contrato: string | null
  /** Endpoint del gateway/relayer de BFA que efectua el anclaje on-chain. */
  gatewayUrl: string | null
  /** Credencial del gateway. Vive solo aqui; nunca se loguea ni se devuelve. */
  apiKey: string | null
  /** Base del explorador de BFA para construir el link a la transaccion. */
  explorerUrl: string | null
  /** Timeout de la submission, en milisegundos. */
  timeoutMs: number
  /** Wallet custodial de RODAID (Modelo Custodial), si esta configurada. */
  custodialWallet: string | null
}

/**
 * Lee la configuracion de BFA del entorno. Acepta tanto `process.env` (runtime de
 * Next) como un getter explicito (runtime de funciones de Netlify, `Netlify.env`).
 */
export function leerConfigBFA(
  getEnv: (clave: string) => string | undefined = (clave) => process.env[clave]
): BfaConfig {
  const limpio = (clave: string): string | null => {
    const valor = getEnv(clave)
    if (typeof valor !== 'string') return null
    const trimmed = valor.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  const timeoutCrudo = Number(limpio('BFA_TIMEOUT_MS'))
  return {
    redNombre: limpio('BFA_RED_NOMBRE') ?? 'Blockchain Federal Argentina',
    chainId: limpio('BFA_CHAIN_ID') ?? 'bfa',
    contrato: limpio('BFA_CONTRATO'),
    gatewayUrl: limpio('BFA_GATEWAY_URL'),
    apiKey: limpio('BFA_GATEWAY_API_KEY'),
    explorerUrl: limpio('BFA_EXPLORER_URL'),
    timeoutMs:
      Number.isFinite(timeoutCrudo) && timeoutCrudo > 0 ? timeoutCrudo : 8000,
    custodialWallet: limpio('RODAID_CUSTODIAL_WALLET'),
  }
}

/** `true` si hay un gateway configurado capaz de efectuar el anclaje on-chain. */
export function bfaConfigurada(config: BfaConfig): boolean {
  return config.gatewayUrl !== null
}

// ── Wallet de destino del NFT (directo vs. custodial) ────────────────────────

export type ModoCustodia = 'DIRECTO' | 'CUSTODIAL'

export interface WalletDestino {
  wallet: string
  modo: ModoCustodia
}

/** Forma aceptable de una wallet: 0x + 40 hex, o un identificador alfanumerico. */
const WALLET_RE = /^(0x[0-9a-fA-F]{40}|[a-zA-Z0-9:_-]{8,120})$/

/**
 * Resuelve la wallet de destino del NFT:
 *   - Si el propietario aporta su wallet -> transferencia DIRECTA (se valida el formato;
 *     una wallet malformada es un error FATAL, no se reintenta).
 *   - Si no -> Modelo Custodial RODAID: el NFT se acuna a la wallet custodial de la
 *     plataforma (configurada por entorno) o, en su defecto, a un identificador
 *     custodial deterministico por ciclista, para que el certificado quede a la espera
 *     de ser transferido cuando el propietario reclame su wallet.
 */
export function resolverWalletDestino(
  propietarioWallet: string | null | undefined,
  ciclistaId: string,
  config: BfaConfig
): WalletDestino {
  const aportada = typeof propietarioWallet === 'string' ? propietarioWallet.trim() : ''
  if (aportada.length > 0) {
    if (!WALLET_RE.test(aportada)) {
      throw new BfaError(
        'BFA_PROPIETARIO_INVALIDO',
        'La wallet del propietario no tiene un formato valido.',
        422,
        false // fatal: no se reintenta una wallet malformada.
      )
    }
    return { wallet: aportada, modo: 'DIRECTO' }
  }
  return {
    wallet: config.custodialWallet ?? `custodial:rodaid:${ciclistaId}`,
    modo: 'CUSTODIAL',
  }
}

/**
 * Clasifica un error de acunacion como reintentable o fatal, para decidir el estado
 * de mint (REINTENTANDO/ERROR vs. FALLIDO):
 *   - Red / timeout / conflicto de nonce -> reintentable (el worker lo reintenta).
 *   - Hash duplicado / propietario invalido / rechazo de contrato -> fatal (bloqueo
 *     definitivo para auditoria; requiere intervencion manual).
 */
export function esErrorReintentable(error: unknown): boolean {
  if (error instanceof BfaError) {
    return error.reintentable
  }
  const mensaje = (error instanceof Error ? error.message : String(error)).toLowerCase()
  // Fatales explicitos: nunca se reintentan solos.
  if (
    mensaje.includes('duplicad') ||
    mensaje.includes('already') ||
    mensaje.includes('duplicate') ||
    mensaje.includes('propietario') ||
    mensaje.includes('invalid')
  ) {
    return false
  }
  // Transitorios tipicos: red, timeout, conflicto de nonce.
  // Por defecto se asume transitorio (mejor reintentar que bloquear por un fallo raro).
  return true
}

// ── Serializacion canonica (determinista, local) ─────────────────────────────

/**
 * Serializa un valor con las claves de objeto ordenadas recursivamente, de modo
 * que el hash de la metadata sea independiente del orden de insercion. Misma
 * disciplina canonica que el nucleo de sellado (`lib/cit.ts`), reimplementada aqui
 * para que la capa BFA no dependa de nada mas que de `node:crypto`.
 */
function canonical(value: unknown): string {
  return JSON.stringify(ordenar(value))
}

function ordenar(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value ?? null
  }
  if (Array.isArray(value)) {
    return value.map((item) => ordenar(item))
  }
  const entrada = value as Record<string, unknown>
  const salida: Record<string, unknown> = {}
  for (const clave of Object.keys(entrada).sort()) {
    if (entrada[clave] !== undefined) {
      salida[clave] = ordenar(entrada[clave])
    }
  }
  return salida
}

function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

// ── Construccion deterministica del NFT ──────────────────────────────────────

export interface CertificadoSellado {
  citId: string
  huella: string
  firma: string
  algoritmo: string
  bicicletaSerial: string
  ciclistaId: string
  aliadoId: string
  aliadoNombre: string | null
  estado: string
  selladoEn: string
  fechaEmision: string | null
  fechaVencimiento: string | null
}

export interface AcunacionNFT {
  /** Identidad determinista del token: deriva directamente de la huella sellada. */
  tokenId: string
  /** URN que localiza el token en la red destino. */
  objetoId: string
  /** Metadata ERC-721 del certificado. */
  metadata: Record<string, unknown>
  /** SHA-256 de la metadata canonica: ancla el contenido del token. */
  metadataHash: string
  /** Identificador deterministico del sello (puede sobrescribirlo el gateway). */
  stampId: string
  /** Nombre de la red destino. */
  red: string
}

/**
 * Deriva la identidad on-chain del token desde la huella del certificado. La huella
 * es un SHA-256 (32 bytes); se expone como un token id hexadecimal de 256 bits, de
 * modo que 1 certificado <-> 1 NFT, sin colisiones y sin estado adicional.
 */
export function derivarTokenId(huella: string): string {
  return `0x${huella.toLowerCase()}`
}

/**
 * Arma el NFT del certificado de forma deterministica: identidad del token,
 * metadata ERC-721 (con la huella como content-hash inmutable) y el hash de esa
 * metadata. No realiza ninguna llamada de red.
 */
export function construirAcunacionNFT(
  cert: CertificadoSellado,
  config: BfaConfig
): AcunacionNFT {
  const tokenId = derivarTokenId(cert.huella)

  const metadata = {
    schema: BFA_ESQUEMA_NFT,
    name: `RODAID CIT · ${cert.bicicletaSerial}`,
    description:
      'Certificado de Identidad Tecnica (CIT) de RODAID anclado en la Blockchain Federal Argentina (BFA). La huella SHA-256 es el sello inmutable del certificado.',
    emisor: 'RODAID',
    red: config.redNombre,
    contentHash: cert.huella,
    firmaHMAC: cert.firma,
    algoritmo: cert.algoritmo,
    attributes: [
      { trait_type: 'Numero de serie', value: cert.bicicletaSerial },
      { trait_type: 'Huella SHA-256', value: cert.huella },
      { trait_type: 'Algoritmo', value: cert.algoritmo },
      { trait_type: 'Estado', value: cert.estado },
      { trait_type: 'Aliado emisor', value: cert.aliadoNombre ?? cert.aliadoId },
      { trait_type: 'Sellado', value: cert.selladoEn },
      { trait_type: 'Emitido', value: cert.fechaEmision ?? null },
      { trait_type: 'Vence', value: cert.fechaVencimiento ?? null },
    ],
  }

  const metadataHash = sha256Hex(canonical(metadata))
  // Sello deterministico: liga la huella a la red/contrato destino. Sirve como
  // identificador estable del anclaje mientras el gateway no devuelva uno propio.
  const stampId = sha256Hex(
    `${config.chainId}|${config.contrato ?? ''}|${cert.huella}`
  )
  const objetoId = `bfa:${config.chainId}:${config.contrato ?? 'cit'}:${tokenId}`

  return { tokenId, objetoId, metadata, metadataHash, stampId, red: config.redNombre }
}

// ── Submission on-chain (configurable) ───────────────────────────────────────

export interface ResultadoAcunacion {
  txHash: string
  stampId: string
  objetoId: string
  red: string
  /** Link al explorador de BFA para la transaccion, si hay explorer configurado. */
  explorerUrl: string | null
}

/** Construye el link del explorador de BFA a una transaccion, si hay base configurada. */
export function construirExplorerUrl(
  base: string | null,
  txHash: string
): string | null {
  if (!base) return null
  return `${base.replace(/\/+$/, '')}/tx/${txHash}`
}

/**
 * Efectua el anclaje del NFT en BFA a traves del gateway/relayer configurado.
 *
 * El gateway recibe la huella, el token id y la metadata, ejecuta la transaccion
 * on-chain y devuelve su `txHash`. Si no hay gateway configurado, se lanza
 * `BFA_NO_CONFIGURADA` (no se fabrica ninguna transaccion). La llamada esta acotada
 * por un timeout para no quedar bloqueada ante inestabilidad de la red.
 */
export async function enviarAcunacionBFA(
  nft: AcunacionNFT,
  cert: Pick<CertificadoSellado, 'citId' | 'huella'>,
  config: BfaConfig,
  destino?: WalletDestino
): Promise<ResultadoAcunacion> {
  if (!config.gatewayUrl) {
    throw new BfaError(
      'BFA_NO_CONFIGURADA',
      'No hay un gateway de BFA configurado para acunar el NFT.',
      503,
      false
    )
  }

  const controlador = new AbortController()
  const timer = setTimeout(() => controlador.abort(), config.timeoutMs)
  try {
    const respuesta = await fetch(config.gatewayUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        citId: cert.citId,
        huella: cert.huella,
        tokenId: nft.tokenId,
        contrato: config.contrato,
        chainId: config.chainId,
        metadataHash: nft.metadataHash,
        metadata: nft.metadata,
        ...(destino
          ? { destino: destino.wallet, modoCustodia: destino.modo }
          : {}),
      }),
      signal: controlador.signal,
    })

    if (!respuesta.ok) {
      // 5xx / 429 -> transitorio (reintentable). 4xx de contrato -> fatal.
      const reintentable = respuesta.status >= 500 || respuesta.status === 429
      throw new BfaError(
        reintentable ? 'BFA_ACUNACION_FALLIDA' : 'BFA_ACUNACION_RECHAZADA',
        `El gateway de BFA respondio con estado ${respuesta.status}.`,
        502,
        reintentable
      )
    }

    const datos = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>
    const txHash = textoNoVacio(datos.txHash ?? datos.tx_hash)
    if (!txHash) {
      throw new BfaError(
        'BFA_ACUNACION_FALLIDA',
        'El gateway de BFA no devolvio un txHash.',
        502,
        true
      )
    }

    return {
      txHash,
      stampId: textoNoVacio(datos.stampId ?? datos.stamp_id) ?? nft.stampId,
      objetoId: textoNoVacio(datos.objetoId ?? datos.objeto_id) ?? nft.objetoId,
      red: config.redNombre,
      explorerUrl: construirExplorerUrl(config.explorerUrl, txHash),
    }
  } catch (error) {
    if (error instanceof BfaError) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BfaError(
        'BFA_TIMEOUT',
        `El gateway de BFA no respondio dentro de ${config.timeoutMs} ms.`,
        504,
        true
      )
    }
    throw new BfaError(
      'BFA_ACUNACION_FALLIDA',
      'No se pudo contactar al gateway de BFA.',
      502,
      true
    )
  } finally {
    clearTimeout(timer)
  }
}

function textoNoVacio(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// ── Subida de metadata a IPFS (background, fuera de la transaccion) ───────────

/**
 * Sube la metadata ERC-721 del NFT a IPFS de forma best-effort, FUERA de la
 * transaccion principal de acunacion (`_subirIPFSBackground`). El pin de IPFS no es
 * critico para la consistencia on-chain: la metadata ya quedo anclada por su hash en
 * la base y en la transaccion BFA. Por eso se ejecuta fire-and-forget y nunca hace
 * fallar la acunacion.
 *
 * Si no hay un pinning service configurado (IPFS_API_URL), no se inventa un CID:
 * se devuelve `null`. Honestidad de estado, igual que el resto del modulo.
 */
export async function subirMetadataIPFSBackground(
  nft: Pick<AcunacionNFT, 'metadata' | 'metadataHash'>,
  getEnv: (clave: string) => string | undefined = (clave) => process.env[clave]
): Promise<string | null> {
  const apiUrl = getEnv('IPFS_API_URL')?.trim()
  if (!apiUrl) {
    return null
  }
  const apiKey = getEnv('IPFS_API_KEY')?.trim()
  const timeoutCrudo = Number(getEnv('IPFS_TIMEOUT_MS'))
  const timeoutMs =
    Number.isFinite(timeoutCrudo) && timeoutCrudo > 0 ? timeoutCrudo : 10000

  const controlador = new AbortController()
  const timer = setTimeout(() => controlador.abort(), timeoutMs)
  try {
    const respuesta = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        metadataHash: nft.metadataHash,
        metadata: nft.metadata,
      }),
      signal: controlador.signal,
    })
    if (!respuesta.ok) {
      console.error('[bfa-ipfs] el pinning service respondio', respuesta.status)
      return null
    }
    const datos = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>
    return textoNoVacio(datos.cid ?? datos.IpfsHash ?? datos.Hash)
  } catch (error) {
    console.error('[bfa-ipfs] no se pudo subir la metadata a IPFS', error)
    return null
  } finally {
    clearTimeout(timer)
  }
}
