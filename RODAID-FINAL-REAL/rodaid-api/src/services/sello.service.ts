// ─── RODAID · Sello Temporal — RFC 3161 + Gobierno Mendoza ─
// Emite y verifica sellos temporales criptográficos sobre los PDFs de CITs.
//
// Estándar: RFC 3161 — Time-Stamp Protocol (TSP)
//           RFC 5816 — ESSCertIDv2 in Time-Stamp Token
//
// Flujo de sellado:
//   1. Computar SHA-256 del PDF del CIT
//   2. Construir TSP Request (imprint = SHA-256 del PDF)
//   3. POST a la TSA configurada (o stub local)
//   4. Parsear TST response (Time Stamp Token)
//   5. Generar Código de Verificación único
//   6. Persistir TST en DB + actualizar CIT
//
// TSA configuradas (prioridad):
//   RODAID_TSA_URL=http://tsa.gob.mendoza.gov.ar/tsp  (Gobierno Mendoza)
//   RODAID_TSA_URL=http://tsa.izenpe.com/              (alternativa pública)
//   STUB: genera sello local firmado por RODAID (desarrollo)
//
// Código de Verificación RODAID (CVRC):
//   Formato: {PREFIX}-{CIT_ID_6}-{HASH_6}-{TS_4}
//   Ejemplo: RCIT-2026-00049 / A3B9C7-F12D44-8E3A
//   Se imprime en el CIT y se usa para verificación rápida sin PDF
//
// Verificación offline:
//   openssl ts -verify -in sello.tst -data pdf_original.pdf
//     -CAfile gob_mendoza_ca.pem

import crypto        from 'crypto'
import forge         from 'node-forge'
import { query, queryOne } from '../config/database'
import { log }       from '../middleware/logger'
import { env }       from '../config/env'

// ══════════════════════════════════════════════════════════
// OIDs RFC 3161
// ══════════════════════════════════════════════════════════
const OID_TSP_CONTENT_TYPE  = '1.2.840.113549.1.9.16.1.4'   // TSTInfo
const OID_SHA256             = '2.16.840.1.101.3.4.2.1'
const OID_RSA_SHA256         = '1.2.840.113549.1.1.11'
const OID_SIGNED_DATA        = '1.2.840.113549.1.7.2'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface SelloInput {
  citId:         string
  numeroCIT:     string
  documentoHash: string   // SHA-256 (hex) del PDF
  pdfBuffer:     Buffer   // para sellar el contenido real
}

export interface SelloResult {
  selloId:       string
  codigoVerif:   string   // código legible para imprimir
  selladoEn:     Date     // timestamp del TST
  tsaUrl:        string
  modo:          'RFC3161' | 'STUB' | 'GOB_MENDOZA'
  tstDER?:       Buffer   // Time Stamp Token DER
  tstB64?:       string   // TST en base64 para el PDF/API
  documentoHash: string
}

export interface VerificacionSello {
  valida:        boolean
  motivo:        string
  codigoVerif:   string | null
  selladoEn:     Date | null
  tsaUrl:        string | null
  modo:          string | null
  hashCoincide:  boolean
  pdfHash:       string
  hashEnSello:   string | null
}

// ══════════════════════════════════════════════════════════
// CÓDIGO DE VERIFICACIÓN RODAID
// ══════════════════════════════════════════════════════════

/**
 * Genera un código de verificación único y legible.
 *
 * Formato: RCIT-2026-00049 / A3B9C7-F12D44-8E3A
 *   · Parte A (6 chars): primeros 6 chars hex del hash del PDF (uppercase)
 *   · Parte B (6 chars): 6 chars hex del hash del citId
 *   · Parte C (4 chars): timestamp hex compacto (mod 65536 → 4 hex)
 *
 * Propiedades:
 *   · Determinista: mismo CIT + mismo PDF → mismo código
 *   · Único: colisión improbable (48 bits de entropía)
 *   · Legible: 16 caracteres hexadecimales en grupos
 *   · Verificable: dado el CIT, se puede recomponer y comparar
 */
export function generarCodigoVerificacion(
  numeroCIT:     string,
  documentoHash: string,
  citId:         string,
  timestamp:     Date
): string {
  const hashA = documentoHash.slice(0, 6).toUpperCase()
  const hashB = crypto.createHash('sha256').update(citId).digest('hex').slice(0, 6).toUpperCase()
  const tsHex = (timestamp.getTime() % 65536).toString(16).toUpperCase().padStart(4, '0')

  return `${numeroCIT} / ${hashA}-${hashB}-${tsHex}`
}

/**
 * Código corto para QR alternativo (16 chars alfanumérico sin separadores)
 * Compatible con sistemas de escaneo de código de barras
 */
export function generarCodigoCorto(documentoHash: string, citId: string, timestamp: Date): string {
  const combined = crypto.createHash('sha256')
    .update(`${documentoHash}:${citId}:${timestamp.getTime()}`)
    .digest('hex')
  return combined.slice(0, 16).toUpperCase()
}

// ══════════════════════════════════════════════════════════
// CONSTRUCCIÓN TSP REQUEST (RFC 3161 §2.4.1)
// ══════════════════════════════════════════════════════════

function buildTSPRequest(documentoHash: string): Buffer {
  // Crear nonce aleatorio (64 bits)
  const nonce = crypto.randomBytes(8)

  // MessageImprint = HashAlgorithm + hashedMessage
  // TimeStampReq ::= SEQUENCE {
  //   version          INTEGER  { v1(1) },
  //   messageImprint   MessageImprint,
  //   reqPolicy        TSAPolicyId          OPTIONAL,
  //   nonce            INTEGER              OPTIONAL,
  //   certReq          BOOLEAN              DEFAULT FALSE,
  //   extensions  [0]  IMPLICIT Extensions  OPTIONAL
  // }

  const hashBytes = Buffer.from(documentoHash, 'hex')

  const request = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      // version: INTEGER v1(1)
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
        forge.asn1.integerToDer(1).getBytes()),

      // messageImprint: SEQUENCE { hashAlgorithm, hashedMessage }
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        // hashAlgorithm: AlgorithmIdentifier { OID, NULL }
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
          forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
            forge.asn1.oidToDer(OID_SHA256).getBytes()),
          forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
        ]),
        // hashedMessage: OCTET STRING (SHA-256 del documento)
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false,
          hashBytes.toString('binary')),
      ]),

      // nonce: INTEGER (8 bytes aleatorio)
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
        nonce.toString('binary')),

      // certReq: BOOLEAN TRUE (queremos el certificado de la TSA)
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.BOOLEAN, false,
        String.fromCharCode(0xff)),
    ]
  )

  return Buffer.from(forge.asn1.toDer(request).getBytes(), 'binary')
}

// ══════════════════════════════════════════════════════════
// PARSEO TST RESPONSE
// ══════════════════════════════════════════════════════════

interface TSTInfo {
  genTime:    Date
  serialNumber: string
  policy:     string | null
  hashAlg:    string
  hashedMsg:  string   // hex
}

function parseTSTInfo(tstDER: Buffer): TSTInfo | null {
  try {
    // TimeStampResp ::= SEQUENCE { status, timeStampToken OPTIONAL }
    // timeStampToken = ContentInfo { OID signedData, SignedData }
    // SignedData.encapContentInfo.eContent = TSTInfo
    const asn1     = forge.asn1.fromDer(tstDER.toString('binary'))
    const respSeq  = (asn1 as any)

    // Navigate: TimeStampResp → timeStampToken → SignedData → encapContentInfo → eContent
    const tsToken = respSeq.value[1]   // timeStampToken (ContentInfo)
    if (!tsToken) return null

    const signedData = tsToken.value[1]?.value[0]
    if (!signedData) return null

    const encapCI   = signedData.value[2]   // encapContentInfo
    const eContent  = encapCI?.value[1]?.value[0]?.value[0]   // DER-encoded TSTInfo
    if (!eContent) return null

    // TSTInfo ::= SEQUENCE {
    //   version       INTEGER,
    //   policy        TSAPolicyId OID,
    //   messageImprint MessageImprint,
    //   serialNumber  INTEGER,
    //   genTime       GeneralizedTime,
    //   ...
    // }
    const tstInfoASN1  = forge.asn1.fromDer(eContent)
    const tstInfoValue = (tstInfoASN1 as any).value

    const policy      = forge.asn1.derToOid(tstInfoValue[1]?.value ?? '')
    const hashAlg     = forge.asn1.derToOid(tstInfoValue[2]?.value[0]?.value[0]?.value ?? '')
    const hashedMsg   = Buffer.from(tstInfoValue[2]?.value[1]?.value ?? '', 'binary').toString('hex')
    const serialBytes = tstInfoValue[3]?.value ?? ''
    const serialHex   = Buffer.from(serialBytes, 'binary').toString('hex').toUpperCase()
    const genTimeRaw  = tstInfoValue[4]?.value ?? ''   // "20260526201234Z"

    // Parse GeneralizedTime: YYYYMMDDHHMMSSZ
    const gt    = String(genTimeRaw)
    const year  = parseInt(gt.slice(0, 4))
    const month = parseInt(gt.slice(4, 6)) - 1
    const day   = parseInt(gt.slice(6, 8))
    const hour  = parseInt(gt.slice(8, 10))
    const min   = parseInt(gt.slice(10, 12))
    const sec   = parseInt(gt.slice(12, 14))
    const genTime = new Date(Date.UTC(year, month, day, hour, min, sec))

    return { genTime, serialNumber: serialHex, policy, hashAlg, hashedMsg }

  } catch (err) {
    log.sello.warn({ err: (err as Error).message }, 'Error parseando TSTInfo')
    return null
  }
}

// ══════════════════════════════════════════════════════════
// STUB SELLO (cuando no hay TSA configurada)
// ══════════════════════════════════════════════════════════

async function generarSelloStub(documentoHash: string, timestamp: Date): Promise<Buffer> {
  // Construir un TSTInfo simplificado auto-firmado por RODAID
  // No es RFC 3161 completo pero tiene la misma estructura legible

  const { obtenerParLlaves } = await import('./firma.service')
  const { privateKey, certificate } = await obtenerParLlaves()

  const hashBytes = Buffer.from(documentoHash, 'hex')
  const serialNum = crypto.randomBytes(8).toString('hex').toUpperCase()
  const genTimeStr = timestamp.toISOString()
    .replace(/[-T:]/g, '').replace(/\.\d+Z/, 'Z')  // → "20260526201234Z"

  // TSTInfo ASN.1
  const tstInfo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    // version v1(1)
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
      forge.asn1.integerToDer(1).getBytes()),
    // policy: RODAID stub OID (1.3.6.1.4.1.99999.1.1 — private arc placeholder)
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
      forge.asn1.oidToDer('1.3.6.1.4.1.99999.1.1').getBytes()),
    // messageImprint: SHA-256
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false,
          forge.asn1.oidToDer(OID_SHA256).getBytes()),
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
      ]),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false,
        hashBytes.toString('binary')),
    ]),
    // serialNumber
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
      Buffer.from(serialNum, 'hex').toString('binary')),
    // genTime: GeneralizedTime
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, 24 /* GeneralizedTime */, false, genTimeStr),
  ])

  const tstInfoDER = Buffer.from(forge.asn1.toDer(tstInfo).getBytes(), 'binary')

  // Firmar el TSTInfo con la clave RODAID (RSA-SHA256)
  const sig = crypto.createSign('RSA-SHA256')
  sig.update(tstInfoDER)
  const signature = sig.sign(forge.pki.privateKeyToPem(privateKey))

  // Empaquetar como ContentInfo → SignedData (simplificado)
  const stubTST = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    // status: SEQUENCE { status: 0 (GRANTED) }
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false,
        forge.asn1.integerToDer(0).getBytes()),
    ]),
    // timeStampToken: CONTEXT[0] { TSTInfo, signature, certSerial }
    forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      tstInfo,
      // signature raw
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false,
        signature.toString('binary')),
      // cert serial
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.UTF8, false,
        certificate.serialNumber),
    ]),
  ])

  return Buffer.from(forge.asn1.toDer(stubTST).getBytes(), 'binary')
}

// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — solicitar sello temporal
// ══════════════════════════════════════════════════════════

export async function sellarDocumento(input: SelloInput): Promise<SelloResult> {
  const t0 = Date.now()

  // Idempotencia
  const existente = await queryOne<{
    id: string; codigo_verif: string; sellado_en: Date; modo: string
    tst_hex: string | null; tsa_url: string
  }>(
    `SELECT id, codigo_verif, sellado_en, modo, tst_hex, tsa_url
     FROM sellos_temporales
     WHERE cit_id=$1 AND documento_hash=$2`,
    [input.citId, input.documentoHash]
  )

  if (existente) {
    log.sello.info({ citId: input.citId, id: existente.id }, '✓ Sello reutilizado (idempotente)')
    return {
      selloId:       existente.id,
      codigoVerif:   existente.codigo_verif,
      selladoEn:     new Date(existente.sellado_en),
      tsaUrl:        existente.tsa_url,
      modo:          existente.modo as SelloResult['modo'],
      tstDER:        existente.tst_hex ? Buffer.from(existente.tst_hex, 'hex') : undefined,
      tstB64:        existente.tst_hex ? Buffer.from(existente.tst_hex, 'hex').toString('base64') : undefined,
      documentoHash: input.documentoHash,
    }
  }

  const tsaUrl  = env.RODAID_TSA_URL ?? null
  let modo:  SelloResult['modo'] = 'STUB'
  let tstDER:    Buffer | null = null
  let selladoEn: Date = new Date()
  let tsaSerial: string | null = null
  let tsaPolicy: string | null = null

  // ── Intentar TSA real ──────────────────────────────────────
  if (tsaUrl) {
    try {
      const reqDER     = buildTSPRequest(input.documentoHash)
      const controller = new AbortController()
      const timer      = setTimeout(() => controller.abort(), 8_000)

      const response = await fetch(tsaUrl, {
        method:  'POST',
        headers: {
          'Content-Type':   'application/timestamp-query',
          'Content-Length': String(reqDER.length),
        },
        body:   reqDER,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer))

      if (!response.ok) {
        throw new Error(`TSA respondió HTTP ${response.status}`)
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('timestamp-reply') && !contentType.includes('octet-stream')) {
        throw new Error(`Content-Type inesperado: ${contentType}`)
      }

      const respBuf = Buffer.from(await response.arrayBuffer())
      tstDER        = respBuf

      const tstInfo = parseTSTInfo(respBuf)
      if (tstInfo) {
        selladoEn = tstInfo.genTime
        tsaSerial = tstInfo.serialNumber
        tsaPolicy = tstInfo.policy
      }

      modo = tsaUrl.includes('mendoza.gov.ar') ? 'GOB_MENDOZA' : 'RFC3161'

      log.sello.info({
        citId: input.citId, tsaUrl, modo,
        serial: tsaSerial, selladoEn: selladoEn.toISOString(),
      }, `✓ Sello temporal RFC 3161 obtenido (${tstDER.length}B)`)

    } catch (err) {
      log.sello.warn({ tsaUrl, err: (err as Error).message },
        'TSA falló — usando sello STUB local')
      tstDER = null
    }
  }

  // ── Sello STUB (desarrollo o fallback) ─────────────────────
  if (!tstDER) {
    tstDER = await generarSelloStub(input.documentoHash, selladoEn)
    modo   = 'STUB'
  }

  // ── Generar código de verificación ────────────────────────
  const codigoVerif = generarCodigoVerificacion(
    input.numeroCIT, input.documentoHash, input.citId, selladoEn
  )
  const codigoCorto = generarCodigoCorto(input.documentoHash, input.citId, selladoEn)

  const tstHex = tstDER.toString('hex')
  const ms     = Date.now() - t0

  // ── Persistir en DB ───────────────────────────────────────
  const row = await queryOne<{ id: string }>(
    `INSERT INTO sellos_temporales
       (cit_id, documento_hash, tst_der, tst_hex, tsa_url,
        tsa_serial, tsa_policy, sellado_en, codigo_verif, modo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (cit_id, documento_hash) DO UPDATE
       SET tst_der=EXCLUDED.tst_der, tst_hex=EXCLUDED.tst_hex
     RETURNING id`,
    [
      input.citId, input.documentoHash,
      tstDER, tstHex,
      tsaUrl ?? 'rodaid://stub',
      tsaSerial, tsaPolicy,
      selladoEn, codigoVerif, modo,
    ]
  )

  // Actualizar el CIT con el código de verificación
  await query(
    `UPDATE cits
     SET sello_id=$2, codigo_verif=$3, sello_sellado_en=$4
     WHERE id=$1`,
    [input.citId, row?.id, codigoVerif, selladoEn]
  )

  log.sello.info({
    citId: input.citId, numeroCIT: input.numeroCIT,
    modo, codigoVerif, selladoEn: selladoEn.toISOString(),
    bytes: tstDER.length, ms,
  }, '✓ Sello temporal persistido')

  return {
    selloId:       row?.id ?? '',
    codigoVerif,
    selladoEn,
    tsaUrl:        tsaUrl ?? 'rodaid://stub',
    modo,
    tstDER,
    tstB64:        tstDER.toString('base64'),
    documentoHash: input.documentoHash,
  }
}

// ══════════════════════════════════════════════════════════
// VERIFICACIÓN DEL SELLO
// ══════════════════════════════════════════════════════════

export async function verificarSello(
  pdfBuffer:  Buffer,
  codigoVerif?: string,
  citId?:       string
): Promise<VerificacionSello> {
  const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex')

  // Buscar el sello en DB
  let sello: {
    codigo_verif: string; sellado_en: Date; modo: string
    tst_hex: string | null; tsa_url: string; documento_hash: string
  } | null = null

  if (citId) {
    sello = await queryOne(
      `SELECT codigo_verif, sellado_en, modo, tst_hex, tsa_url, documento_hash
       FROM sellos_temporales WHERE cit_id=$1 ORDER BY creado_en DESC LIMIT 1`,
      [citId]
    )
  } else if (codigoVerif) {
    sello = await queryOne(
      `SELECT codigo_verif, sellado_en, modo, tst_hex, tsa_url, documento_hash
       FROM sellos_temporales WHERE codigo_verif=$1`,
      [codigoVerif]
    )
  }

  if (!sello) {
    return {
      valida: false, motivo: 'No se encontró sello temporal para este documento',
      codigoVerif: codigoVerif ?? null, selladoEn: null,
      tsaUrl: null, modo: null, hashCoincide: false,
      pdfHash, hashEnSello: null,
    }
  }

  const hashCoincide = sello.documento_hash === pdfHash

  if (!hashCoincide) {
    return {
      valida: false,
      motivo: 'El PDF fue modificado después del sellado — hash SHA-256 no coincide',
      codigoVerif: sello.codigo_verif, selladoEn: new Date(sello.sellado_en),
      tsaUrl: sello.tsa_url, modo: sello.modo,
      hashCoincide: false, pdfHash, hashEnSello: sello.documento_hash,
    }
  }

  return {
    valida: true,
    motivo: `Sello temporal válido. PDF íntegro. Sellado el ${new Date(sello.sellado_en).toLocaleString('es-AR', { timeZone: 'America/Argentina/Mendoza' })} (ARG)`,
    codigoVerif: sello.codigo_verif,
    selladoEn:   new Date(sello.sellado_en),
    tsaUrl:      sello.tsa_url,
    modo:        sello.modo,
    hashCoincide: true,
    pdfHash,
    hashEnSello: sello.documento_hash,
  }
}

// ══════════════════════════════════════════════════════════
// CONSULTA POR CÓDIGO DE VERIFICACIÓN
// ══════════════════════════════════════════════════════════

export async function buscarPorCodigo(codigoVerif: string) {
  return queryOne<{
    id: string; cit_id: string; codigo_verif: string
    sellado_en: Date; modo: string; tsa_url: string; documento_hash: string
  }>(
    `SELECT id, cit_id, codigo_verif, sellado_en, modo, tsa_url, documento_hash
     FROM sellos_temporales WHERE codigo_verif=$1`,
    [codigoVerif]
  )
}

export async function getSelloCIT(citId: string) {
  return queryOne<{
    id: string; codigo_verif: string; sellado_en: Date
    modo: string; tsa_url: string; tst_hex: string | null; documento_hash: string
  }>(
    `SELECT id, codigo_verif, sellado_en, modo, tsa_url, tst_hex, documento_hash
     FROM sellos_temporales WHERE cit_id=$1 ORDER BY creado_en DESC LIMIT 1`,
    [citId]
  )
}
