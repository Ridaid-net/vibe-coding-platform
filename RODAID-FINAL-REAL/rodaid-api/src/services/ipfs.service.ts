// ─── RODAID · IPFS Service — Pinata + Stub ───────────────
// Sube archivos y metadata a IPFS para los NFTs del CIT.
//
// Modo real (PINATA_JWT configurado):
//   · PinataSDK → /pinning/pinFileToIPFS  (PDF + fotos)
//   · PinataSDK → /pinning/pinJSONToIPFS  (metadata ERC-721)
//
// Modo stub (desarrollo sin credenciales):
//   · Genera CIDs determinísticos con SHA-256 del contenido
//   · No hace ninguna llamada de red
//   · Los CIDs son válidos como formato (Qm...) pero no pinneados
//
// El metadata ERC-721 sigue el estándar OpenSea + Solana:
//   name, description, image, external_url, attributes, files

import PinataSDK   from '@pinata/sdk'
import { Readable } from 'stream'
import crypto       from 'crypto'
import { env }      from '../config/env'
import { log, startTimer } from '../middleware/logger'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface IPFSUploadResult {
  cid:         string   // CIDv1 o CIDv0 (Qm...)
  ipfsUrl:     string   // ipfs://{cid}
  gatewayUrl:  string   // https://gateway.pinata.cloud/ipfs/{cid}
  size:        number   // bytes
  stub:        boolean  // true = no pinnado realmente
}

export interface CITMetadataInput {
  numeroCIT:         string
  serial:            string
  hashSHA256:        string
  marca:             string
  modelo:            string
  anio:              number
  tipo:              string
  color:             string
  propietarioNombre: string
  inspectorNombre:   string
  tallerNombre:      string
  tallerLocalidad:   string
  totalPuntos:       number
  fechaEmision:      string   // ISO 8601
  nftTokenId?:       number
  bfaTxHash?:        string
  imageCID?:         string   // CID de la foto principal
  pdfCID?:           string   // CID del PDF
}

// ── ERC-721 Metadata standard (OpenSea compatible) ────────
interface NFTMetadata {
  name:         string
  description:  string
  image:        string        // ipfs://{imageCID}
  external_url: string        // https://rodaid.com.ar/cit/{serial}
  background_color: string    // hex sin #
  attributes: Array<{
    trait_type: string
    value:      string | number
    display_type?: string
  }>
  properties: {
    files: Array<{ uri: string; type: string; cdn?: boolean }>
    category: string
    creators:  Array<{ address: string; share: number }>
  }
  rodaid: {
    ley:        string
    hashSHA256: string
    serial:     string
    numeroCIT:  string
    version:    string
  }
}

// ══════════════════════════════════════════════════════════
// GATEWAY IPFS
// ══════════════════════════════════════════════════════════

const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs'
const PUBLIC_GATEWAY = 'https://ipfs.io/ipfs'

function ipfsUrl(cid: string)     { return `ipfs://${cid}` }
function gatewayUrl(cid: string)  { return `${PINATA_GATEWAY}/${cid}` }

// ══════════════════════════════════════════════════════════
// STUB — CIDs determinísticos sin pinning real
// ══════════════════════════════════════════════════════════

function stubCID(content: Buffer | string): string {
  const hash = crypto.createHash('sha256')
    .update(typeof content === 'string' ? content : content)
    .digest('hex')
  // Simular formato CIDv0 (Qm + base58)
  const prefix = 'QmRODAIDStub'
  return prefix + hash.slice(0, 34).toUpperCase()
}

// ══════════════════════════════════════════════════════════
// IPFS SERVICE REAL — Pinata SDK
// ══════════════════════════════════════════════════════════

class IPFSServiceReal {
  private readonly pinata: InstanceType<typeof PinataSDK>

  constructor(jwt: string) {
    this.pinata = new (PinataSDK as any)(null, null, { pinataJWTKey: jwt })
    log.bfa.info('✓ IPFSService Pinata inicializado')
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    metadata: Record<string, string> = {}
  ): Promise<IPFSUploadResult> {
    const timer = startTimer('ipfs.upload', { filename, size: buffer.length })

    const readable = Readable.from(buffer) as unknown as NodeJS.ReadableStream & { path: string }
    readable.path = filename

    const result = await this.pinata.pinFileToIPFS(readable, {
      pinataMetadata: {
        name:     filename,
        // keyvalues removed — Pinata SDK type incompatibility,
      },
      pinataOptions: { cidVersion: 1 },
    })

    const ms = timer({ cid: result.IpfsHash })
    log.bfa.info({ filename, cid: result.IpfsHash, size: buffer.length, ms }, '✓ IPFS upload')

    return {
      cid:        result.IpfsHash,
      ipfsUrl:    ipfsUrl(result.IpfsHash),
      gatewayUrl: gatewayUrl(result.IpfsHash),
      size:       buffer.length,
      stub:       false,
    }
  }

  async uploadJSON(
    obj: object,
    name: string,
    metadata: Record<string, string> = {}
  ): Promise<IPFSUploadResult> {
    const timer = startTimer('ipfs.uploadJSON', { name })
    const json  = JSON.stringify(obj, null, 2)

    const result = await this.pinata.pinJSONToIPFS(obj, {
      pinataMetadata: {
        name,
        // keyvalues removed — Pinata SDK type incompatibility,
      },
      pinataOptions: { cidVersion: 1 },
    })

    const ms = timer({ cid: result.IpfsHash })
    log.bfa.info({ name, cid: result.IpfsHash, ms }, '✓ IPFS JSON upload')

    return {
      cid:        result.IpfsHash,
      ipfsUrl:    ipfsUrl(result.IpfsHash),
      gatewayUrl: gatewayUrl(result.IpfsHash),
      size:       Buffer.byteLength(json),
      stub:       false,
    }
  }
}

// ══════════════════════════════════════════════════════════
// IPFS SERVICE STUB
// ══════════════════════════════════════════════════════════

class IPFSServiceStub {
  async uploadBuffer(buffer: Buffer, filename: string): Promise<IPFSUploadResult> {
    const cid = stubCID(buffer)
    log.bfa.warn({ stub: true, filename, cid: cid.slice(0, 20) + '...' }, '⚠️  IPFS STUB — no pinnado (configurar PINATA_JWT)')
    return { cid, ipfsUrl: ipfsUrl(cid), gatewayUrl: gatewayUrl(cid), size: buffer.length, stub: true }
  }

  async uploadJSON(obj: object, name: string): Promise<IPFSUploadResult> {
    const json = JSON.stringify(obj)
    const cid  = stubCID(json)
    log.bfa.warn({ stub: true, name, cid: cid.slice(0, 20) + '...' }, '⚠️  IPFS STUB JSON')
    return { cid, ipfsUrl: ipfsUrl(cid), gatewayUrl: gatewayUrl(cid), size: Buffer.byteLength(json), stub: true }
  }
}

// ══════════════════════════════════════════════════════════
// EXPORTAR INSTANCIA
// ══════════════════════════════════════════════════════════

const hasIPFS = !!env.PINATA_JWT
const _ipfs: IPFSServiceReal | IPFSServiceStub = hasIPFS
  ? new IPFSServiceReal(env.PINATA_JWT!)
  : new IPFSServiceStub()

if (!hasIPFS) {
  log.bfa.warn({ faltante: 'PINATA_JWT' }, '⚠️  IPFS STUB activo — para subir a Pinata configurar PINATA_JWT')
}

// ══════════════════════════════════════════════════════════
// API PÚBLICA
// ══════════════════════════════════════════════════════════

/** Subir el PDF del CIT a IPFS */
export async function subirPDFCIT(
  pdfBuffer: Buffer,
  numeroCIT: string
): Promise<IPFSUploadResult> {
  return _ipfs.uploadBuffer(
    pdfBuffer,
    `cit-${numeroCIT}.pdf`,
    'application/pdf',
    { numeroCIT, contentType: 'certificate' }
  )
}

/** Subir una foto de inspección a IPFS */
export async function subirFotoCIT(
  imageBuffer: Buffer,
  filename: string,
  numeroCIT: string
): Promise<IPFSUploadResult> {
  return _ipfs.uploadBuffer(
    imageBuffer,
    filename,
    'image/jpeg',
    { numeroCIT, contentType: 'inspection-photo' }
  )
}

/** Construir y subir el metadata ERC-721 a IPFS */
export async function subirMetadataCIT(
  data:    CITMetadataInput,
  imageCID?: string,
  pdfCID?:   string
): Promise<IPFSUploadResult> {
  const metadata = buildNFTMetadata(data, imageCID, pdfCID)
  return _ipfs.uploadJSON(
    metadata,
    `metadata-${data.numeroCIT}.json`,
    { numeroCIT: data.numeroCIT, serial: data.serial }
  )
}

/** Construir el objeto metadata ERC-721 */
export function buildNFTMetadata(
  data:    CITMetadataInput,
  imageCID?: string,
  pdfCID?:   string
): NFTMetadata {
  const imageUri = imageCID
    ? ipfsUrl(imageCID)
    : `https://api.rodaid.com.ar/api/v1/cit/foto-placeholder.png`

  const fechaEmision = new Date(data.fechaEmision)

  return {
    name:         `CIT ${data.numeroCIT} — ${data.marca} ${data.modelo} ${data.anio}`,
    description:  [
      `Certificado de Identidad Técnica de Bicicleta emitido por RODAID`,
      `conforme a la Ley Provincial Mendoza N° 9556.`,
      `Inspector: ${data.inspectorNombre} | Taller: ${data.tallerNombre} (${data.tallerLocalidad}).`,
      `Hash SHA-256 anclado en la Blockchain Federal Argentina (BFA, ONTI).`,
    ].join(' '),
    image:         imageUri,
    external_url:  `https://rodaid.com.ar/verificar/${data.serial}`,
    background_color: '0F1E35',  // RODAID navy

    attributes: [
      { trait_type: 'Serial',             value: data.serial },
      { trait_type: 'Marca',              value: data.marca },
      { trait_type: 'Modelo',             value: data.modelo },
      { trait_type: 'Año',                value: data.anio,         display_type: 'number' },
      { trait_type: 'Tipo',               value: data.tipo.toUpperCase() },
      { trait_type: 'Color',              value: data.color },
      { trait_type: 'Inspector',          value: data.inspectorNombre },
      { trait_type: 'Taller',             value: `${data.tallerNombre} · ${data.tallerLocalidad}` },
      { trait_type: 'Puntos Inspección',  value: data.totalPuntos,  display_type: 'number' },
      { trait_type: 'Resultado',          value: data.totalPuntos >= 15 ? 'APROBADO' : 'RECHAZADO' },
      { trait_type: 'Ley',                value: 'N° 9556 Mendoza' },
      { trait_type: 'Fecha Emisión',      value: Math.floor(fechaEmision.getTime() / 1000), display_type: 'date' },
      ...(data.nftTokenId ? [{ trait_type: 'NFT Token ID', value: data.nftTokenId, display_type: 'number' }] : []),
    ],

    properties: {
      files: [
        { uri: imageUri, type: 'image/jpeg', cdn: false },
        ...(pdfCID ? [{
          uri:  ipfsUrl(pdfCID),
          type: 'application/pdf',
          cdn:  false,
        }] : []),
      ],
      category: 'certificate',
      creators: [{ address: '0x0000000000000000000000000000000000000000', share: 100 }],
    },

    rodaid: {
      ley:        'Ley Provincial Mendoza N° 9556',
      hashSHA256: data.hashSHA256,
      serial:     data.serial,
      numeroCIT:  data.numeroCIT,
      version:    '2.0.0',
    },
  }
}

/** URL de metadatos para el tokenURI del contrato */
export function buildTokenURI(metadataCID: string): string {
  return ipfsUrl(metadataCID)
}

/** Resolver CID a URL de gateway pública */
export function resolveGatewayUrl(cid: string, gateway = 'pinata'): string {
  return gateway === 'public'
    ? `${PUBLIC_GATEWAY}/${cid}`
    : `${PINATA_GATEWAY}/${cid}`
}
