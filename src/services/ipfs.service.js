"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.subirPDFCIT = subirPDFCIT;
exports.subirFotoCIT = subirFotoCIT;
exports.subirMetadataCIT = subirMetadataCIT;
exports.buildNFTMetadata = buildNFTMetadata;
exports.buildTokenURI = buildTokenURI;
exports.resolveGatewayUrl = resolveGatewayUrl;
const sdk_1 = __importDefault(require("@pinata/sdk"));
const stream_1 = require("stream");
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
const logger_1 = require("../middleware/logger");
// ══════════════════════════════════════════════════════════
// GATEWAY IPFS
// ══════════════════════════════════════════════════════════
const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';
const PUBLIC_GATEWAY = 'https://ipfs.io/ipfs';
function ipfsUrl(cid) { return `ipfs://${cid}`; }
function gatewayUrl(cid) { return `${PINATA_GATEWAY}/${cid}`; }
// ══════════════════════════════════════════════════════════
// STUB — CIDs determinísticos sin pinning real
// ══════════════════════════════════════════════════════════
function stubCID(content) {
    const hash = crypto_1.default.createHash('sha256')
        .update(typeof content === 'string' ? content : content)
        .digest('hex');
    // Simular formato CIDv0 (Qm + base58)
    const prefix = 'QmRODAIDStub';
    return prefix + hash.slice(0, 34).toUpperCase();
}
// ══════════════════════════════════════════════════════════
// IPFS SERVICE REAL — Pinata SDK
// ══════════════════════════════════════════════════════════
class IPFSServiceReal {
    pinata;
    constructor(jwt) {
        this.pinata = new sdk_1.default(null, null, { pinataJWTKey: jwt });
        logger_1.log.bfa.info('✓ IPFSService Pinata inicializado');
    }
    async uploadBuffer(buffer, filename, mimeType, metadata = {}) {
        const timer = (0, logger_1.startTimer)('ipfs.upload', { filename, size: buffer.length });
        const readable = stream_1.Readable.from(buffer);
        readable.path = filename;
        const result = await this.pinata.pinFileToIPFS(readable, {
            pinataMetadata: {
                name: filename,
                // keyvalues removed — Pinata SDK type incompatibility,
            },
            pinataOptions: { cidVersion: 1 },
        });
        const ms = timer({ cid: result.IpfsHash });
        logger_1.log.bfa.info({ filename, cid: result.IpfsHash, size: buffer.length, ms }, '✓ IPFS upload');
        return {
            cid: result.IpfsHash,
            ipfsUrl: ipfsUrl(result.IpfsHash),
            gatewayUrl: gatewayUrl(result.IpfsHash),
            size: buffer.length,
            stub: false,
        };
    }
    async uploadJSON(obj, name, metadata = {}) {
        const timer = (0, logger_1.startTimer)('ipfs.uploadJSON', { name });
        const json = JSON.stringify(obj, null, 2);
        const result = await this.pinata.pinJSONToIPFS(obj, {
            pinataMetadata: {
                name,
                // keyvalues removed — Pinata SDK type incompatibility,
            },
            pinataOptions: { cidVersion: 1 },
        });
        const ms = timer({ cid: result.IpfsHash });
        logger_1.log.bfa.info({ name, cid: result.IpfsHash, ms }, '✓ IPFS JSON upload');
        return {
            cid: result.IpfsHash,
            ipfsUrl: ipfsUrl(result.IpfsHash),
            gatewayUrl: gatewayUrl(result.IpfsHash),
            size: Buffer.byteLength(json),
            stub: false,
        };
    }
}
// ══════════════════════════════════════════════════════════
// IPFS SERVICE STUB
// ══════════════════════════════════════════════════════════
class IPFSServiceStub {
    async uploadBuffer(buffer, filename) {
        const cid = stubCID(buffer);
        logger_1.log.bfa.warn({ stub: true, filename, cid: cid.slice(0, 20) + '...' }, '⚠️  IPFS STUB — no pinnado (configurar PINATA_JWT)');
        return { cid, ipfsUrl: ipfsUrl(cid), gatewayUrl: gatewayUrl(cid), size: buffer.length, stub: true };
    }
    async uploadJSON(obj, name) {
        const json = JSON.stringify(obj);
        const cid = stubCID(json);
        logger_1.log.bfa.warn({ stub: true, name, cid: cid.slice(0, 20) + '...' }, '⚠️  IPFS STUB JSON');
        return { cid, ipfsUrl: ipfsUrl(cid), gatewayUrl: gatewayUrl(cid), size: Buffer.byteLength(json), stub: true };
    }
}
// ══════════════════════════════════════════════════════════
// EXPORTAR INSTANCIA
// ══════════════════════════════════════════════════════════
const hasIPFS = !!env_1.env.PINATA_JWT;
const _ipfs = hasIPFS
    ? new IPFSServiceReal(env_1.env.PINATA_JWT)
    : new IPFSServiceStub();
if (!hasIPFS) {
    logger_1.log.bfa.warn({ faltante: 'PINATA_JWT' }, '⚠️  IPFS STUB activo — para subir a Pinata configurar PINATA_JWT');
}
// ══════════════════════════════════════════════════════════
// API PÚBLICA
// ══════════════════════════════════════════════════════════
/** Subir el PDF del CIT a IPFS */
async function subirPDFCIT(pdfBuffer, numeroCIT) {
    return _ipfs.uploadBuffer(pdfBuffer, `cit-${numeroCIT}.pdf`, 'application/pdf', { numeroCIT, contentType: 'certificate' });
}
/** Subir una foto de inspección a IPFS */
async function subirFotoCIT(imageBuffer, filename, numeroCIT) {
    return _ipfs.uploadBuffer(imageBuffer, filename, 'image/jpeg', { numeroCIT, contentType: 'inspection-photo' });
}
/** Construir y subir el metadata ERC-721 a IPFS */
async function subirMetadataCIT(data, imageCID, pdfCID) {
    const metadata = buildNFTMetadata(data, imageCID, pdfCID);
    return _ipfs.uploadJSON(metadata, `metadata-${data.numeroCIT}.json`, { numeroCIT: data.numeroCIT, serial: data.serial });
}
/** Construir el objeto metadata ERC-721 */
function buildNFTMetadata(data, imageCID, pdfCID) {
    const imageUri = imageCID
        ? ipfsUrl(imageCID)
        : `https://api.rodaid.com.ar/api/v1/cit/foto-placeholder.png`;
    const fechaEmision = new Date(data.fechaEmision);
    return {
        name: `CIT ${data.numeroCIT} — ${data.marca} ${data.modelo} ${data.anio}`,
        description: [
            `Certificado de Identidad Técnica de Bicicleta emitido por RODAID`,
            `conforme a la Ley Provincial Mendoza N° 9556.`,
            `Inspector: ${data.inspectorNombre} | Taller: ${data.tallerNombre} (${data.tallerLocalidad}).`,
            `Hash SHA-256 anclado en la Blockchain Federal Argentina (BFA, ONTI).`,
        ].join(' '),
        image: imageUri,
        external_url: `https://rodaid.com.ar/verificar/${data.serial}`,
        background_color: '0F1E35', // RODAID navy
        attributes: [
            { trait_type: 'Serial', value: data.serial },
            { trait_type: 'Marca', value: data.marca },
            { trait_type: 'Modelo', value: data.modelo },
            { trait_type: 'Año', value: data.anio, display_type: 'number' },
            { trait_type: 'Tipo', value: data.tipo.toUpperCase() },
            { trait_type: 'Color', value: data.color },
            { trait_type: 'Inspector', value: data.inspectorNombre },
            { trait_type: 'Taller', value: `${data.tallerNombre} · ${data.tallerLocalidad}` },
            { trait_type: 'Puntos Inspección', value: data.totalPuntos, display_type: 'number' },
            { trait_type: 'Resultado', value: data.totalPuntos >= 15 ? 'APROBADO' : 'RECHAZADO' },
            { trait_type: 'Ley', value: 'N° 9556 Mendoza' },
            { trait_type: 'Fecha Emisión', value: Math.floor(fechaEmision.getTime() / 1000), display_type: 'date' },
            ...(data.nftTokenId ? [{ trait_type: 'NFT Token ID', value: data.nftTokenId, display_type: 'number' }] : []),
        ],
        properties: {
            files: [
                { uri: imageUri, type: 'image/jpeg', cdn: false },
                ...(pdfCID ? [{
                        uri: ipfsUrl(pdfCID),
                        type: 'application/pdf',
                        cdn: false,
                    }] : []),
            ],
            category: 'certificate',
            creators: [{ address: '0x0000000000000000000000000000000000000000', share: 100 }],
        },
        rodaid: {
            ley: 'Ley Provincial Mendoza N° 9556',
            hashSHA256: data.hashSHA256,
            serial: data.serial,
            numeroCIT: data.numeroCIT,
            version: '2.0.0',
        },
    };
}
/** URL de metadatos para el tokenURI del contrato */
function buildTokenURI(metadataCID) {
    return ipfsUrl(metadataCID);
}
/** Resolver CID a URL de gateway pública */
function resolveGatewayUrl(cid, gateway = 'pinata') {
    return gateway === 'public'
        ? `${PUBLIC_GATEWAY}/${cid}`
        : `${PINATA_GATEWAY}/${cid}`;
}
