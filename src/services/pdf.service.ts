import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getStore } from '@netlify/blobs'
import QRCode from 'qrcode'
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { SignPdf } from '@signpdf/signpdf'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import { SUBFILTER_ADOBE_PKCS7_DETACHED } from '@signpdf/utils'
import {
  crearSignerRodaid,
  getFirmaModo,
  sha256Hex,
} from '@/src/services/firma.service'

/**
 * RODAID — Servicio de generacion del Certificado Digital de Propiedad y
 * Verificacion (PDF).
 *
 * Genera, en el entorno serverless de Netlify, un PDF de certificado con:
 *   - la identidad de la bici (marca, modelo, tipo, serie, etc.),
 *   - el codigo CIT y su estado,
 *   - la fecha de emision y el SELLO TEMPORAL del sistema,
 *   - un QR que apunta al Verificador Publico (/verificar/:serial),
 *   - un sello de seguridad de la marca,
 *   - la huella SHA-256 de la identidad y, si existe, el anclaje en la BFA.
 *
 * El PDF se FIRMA con una firma detached PKCS#7 de la autoridad de RODAID
 * (`firma.service.ts`), incrustada como firma estandar de PDF: si el documento
 * se altera, la firma se rompe; y es verificable offline / con herramientas
 * estandar de PDF.
 *
 * Se eligio una libreria liviana de PDF (`pdf-lib`, JS puro, sin Chromium) en
 * lugar de Puppeteer porque el entorno es serverless: Puppeteer + un Chromium
 * headless excede los limites de tamano y arranque de una funcion. El template
 * se compone de forma vectorial, sin navegador.
 *
 * El resultado se cachea en Netlify Blobs por CIT: si el certificado ya existe y
 * los datos de origen no cambiaron, se recupera del bucket en lugar de
 * regenerarse y re-firmarse.
 */

// ── Tipos de entrada ─────────────────────────────────────────────────────────

export interface CertificadoBici {
  marca: string
  modelo: string
  tipo: string
  numeroSerie: string
  anio: number | null
  color: string | null
  rodado: number | null
  talleCuadro: string | null
}

export interface CertificadoBfa {
  estado: string
  /** 'ONCHAIN' (anclaje real) | 'STUB' (registro interno, no blockchain) | null. */
  modo: string | null
  txHash: string | null
  tokenId: string | null
  ancladoEn: string | null
}

/**
 * Nota tecnica de la inspeccion fisica (Hito 11). Cuando un inspector aprueba la
 * bici presencialmente, el certificado deja constancia del taller (si aplica) y
 * del inspector que la realizo.
 */
export interface CertificadoInspeccion {
  /** Nombre del taller/aliado, o null si la hizo un inspector global. */
  taller: string | null
  inspector: string
  /** Firma del acta (SHA-256). */
  firmaHash: string
  aprobadaEn: string | null
}

export interface CertificadoDatos {
  citId: string
  codigoCit: string
  estado: string
  hashSha256: string | null
  fechaVencimiento: string | null
  bici: CertificadoBici
  bfa: CertificadoBfa
  /** Nombre/identificacion del titular (documento privado del propietario). */
  titular: string | null
  /** URL absoluta del Verificador Publico para esta bici (destino del QR). */
  verifierUrl: string
  /** Nota tecnica de la inspeccion fisica, si la bici fue inspeccionada. */
  inspeccion?: CertificadoInspeccion | null
}

export interface CertificadoGenerado {
  pdf: Uint8Array
  /** Numero de certificado legible y estable por CIT. */
  numero: string
  /** Fecha de emision (sello temporal del sistema), ISO. */
  emitidoEn: string
  /** Huella SHA-256 del PDF firmado (sello de integridad del documento). */
  documentoHash: string
  /** Modo de la firma: 'AUTORIDAD' (real) o 'DEV' (autofirmado de preview). */
  modoFirma: ReturnType<typeof getFirmaModo>
  /** true si se recupero del almacenamiento (Netlify Blobs). */
  fromCache: boolean
}

// ── Paleta de marca RODAID (de app/globals.css) ──────────────────────────────

const C = {
  ink: rgb(0x14 / 255, 0x16 / 255, 0x0e / 255),
  inkSoft: rgb(0x21 / 255, 0x24 / 255, 0x1a / 255),
  paper: rgb(0xf2 / 255, 0xef / 255, 0xe4 / 255),
  paperDim: rgb(0xe7 / 255, 0xe2 / 255, 0xd2 / 255),
  lime: rgb(0xc8 / 255, 0xf2 / 255, 0x4e / 255),
  limeDeep: rgb(0xaa / 255, 0xdb / 255, 0x2f / 255),
  clay: rgb(0xd8 / 255, 0x54 / 255, 0x2f / 255),
  slate: rgb(0x6f / 255, 0x73 / 255, 0x63 / 255),
  white: rgb(1, 1, 1),
}

// A4 vertical (puntos PDF).
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 48

const STORE_CERTIFICADOS = 'rodaid-certificados'

// ── Tipografia ───────────────────────────────────────────────────────────────

interface Fuentes {
  display: PDFFont
  bodyBold: PDFFont
  body: PDFFont
  mono: PDFFont
  /** Nombre de la tipografia de marca usada en titulos. */
  displayNombre: string
}

/**
 * Carga la tipografia de marca (Bianco Sport) si hay un archivo de fuente
 * disponible (variable `RODAID_PDF_FONT_PATH` o `public/fonts/`). En su defecto
 * usa una fuente estandar limpia, de modo que el certificado se genera siempre,
 * con o sin el archivo de marca.
 */
function leerFuenteMarca(): Buffer | null {
  const candidatos = [
    process.env.RODAID_PDF_FONT_PATH,
    path.join(process.cwd(), 'public', 'fonts', 'BiancoSport.ttf'),
    path.join(process.cwd(), 'public', 'fonts', 'BiancoSport.otf'),
    path.join(process.cwd(), 'public', 'fonts', 'bianco-sport.ttf'),
  ].filter((p): p is string => Boolean(p))

  for (const ruta of candidatos) {
    try {
      return readFileSync(ruta)
    } catch {
      // Probar el siguiente candidato.
    }
  }
  return null
}

async function cargarFuentes(doc: PDFDocument): Promise<Fuentes> {
  const body = await doc.embedFont(StandardFonts.Helvetica)
  const bodyBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.Courier)

  const fuenteMarca = leerFuenteMarca()
  if (fuenteMarca) {
    doc.registerFontkit(fontkit)
    try {
      const display = await doc.embedFont(fuenteMarca, { subset: true })
      return { display, bodyBold, body, mono, displayNombre: 'Bianco Sport' }
    } catch {
      // Si el archivo no es una fuente valida, caemos al estandar.
    }
  }
  return { display: bodyBold, bodyBold, body, mono, displayNombre: 'RODAID Display' }
}

// ── API publica ──────────────────────────────────────────────────────────────

/** Numero de certificado estable y legible derivado del CIT. */
export function numeroCertificado(citId: string): string {
  const huella = sha256Hex(Buffer.from(citId)).slice(0, 10).toUpperCase()
  return `RODAID-CERT-${huella}`
}

/**
 * Huella de los datos que determinan el contenido del certificado. Si cambia,
 * el certificado cacheado se considera obsoleto y se regenera.
 */
function fingerprintDatos(d: CertificadoDatos): string {
  return sha256Hex(
    Buffer.from(
      JSON.stringify({
        codigoCit: d.codigoCit,
        estado: d.estado,
        hash: d.hashSha256,
        venc: d.fechaVencimiento,
        bici: d.bici,
        bfa: d.bfa,
        titular: d.titular,
        url: d.verifierUrl,
        insp: d.inspeccion ?? null,
      })
    )
  )
}

/**
 * Obtiene el certificado del CIT: lo recupera de Netlify Blobs si ya existe y
 * los datos no cambiaron; si no, lo genera bajo demanda, lo firma y lo almacena.
 */
export async function obtenerCertificado(
  d: CertificadoDatos
): Promise<CertificadoGenerado> {
  const fingerprint = fingerprintDatos(d)
  const key = `certificados/${d.citId}.pdf`

  // 1. Intentar recuperar del almacenamiento (best-effort).
  const cacheado = await leerDeBlobs(key, fingerprint)
  if (cacheado) {
    return { ...cacheado, fromCache: true }
  }

  // 2. Generar + firmar bajo demanda.
  const generado = await generarCertificado(d)

  // 3. Persistir en el bucket para futuras descargas (best-effort).
  await guardarEnBlobs(key, generado, fingerprint)

  return { ...generado, fromCache: false }
}

/**
 * Genera y FIRMA el certificado, sin tocar el almacenamiento. Devuelve el PDF
 * firmado y los metadatos de emision. Expuesto por si se quiere regenerar
 * siempre (sin cache).
 */
export async function generarCertificado(
  d: CertificadoDatos
): Promise<Omit<CertificadoGenerado, 'fromCache'>> {
  const emitidoEn = new Date()
  const numero = numeroCertificado(d.citId)

  // 1. Componer el PDF (template vectorial).
  const doc = await PDFDocument.create()
  doc.setTitle(`Certificado de Propiedad y Verificacion — ${d.codigoCit}`)
  doc.setAuthor('RODAID')
  doc.setSubject('Certificado Digital de Propiedad y Verificacion (CIT)')
  doc.setProducer('RODAID')
  doc.setCreator('RODAID')
  doc.setCreationDate(emitidoEn)
  doc.setModificationDate(emitidoEn)

  const fuentes = await cargarFuentes(doc)
  const page = doc.addPage([PAGE_W, PAGE_H])

  const qrPng = await generarQrPng(d.verifierUrl)
  const qrImage = await doc.embedPng(qrPng)

  await componerCertificado(doc, page, fuentes, d, {
    numero,
    emitidoEn,
    qrImage,
  })

  // 2. Reservar el hueco de firma e incrustar la firma detached PKCS#7.
  const { signer, modo } = crearSignerRodaid()
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: 'Certificado de Propiedad y Verificacion RODAID',
    contactInfo: 'verificaciones@rodaid.ar',
    name: 'RODAID Autoridad Certificadora',
    location: 'Argentina',
    signingTime: emitidoEn,
    signatureLength: 8192,
    subFilter: SUBFILTER_ADOBE_PKCS7_DETACHED,
  })

  // `useObjectStreams: false` es obligatorio para que el placeholder de firma
  // quede como bytes localizables (lo exige el algoritmo de ByteRange).
  const sinFirmar = await doc.save({ useObjectStreams: false })
  const firmado = await new SignPdf().sign(Buffer.from(sinFirmar), signer, emitidoEn)
  const pdf = new Uint8Array(firmado)

  return {
    pdf,
    numero,
    emitidoEn: emitidoEn.toISOString(),
    documentoHash: sha256Hex(pdf),
    modoFirma: modo,
  }
}

// ── Composicion del template ─────────────────────────────────────────────────

interface RenderMeta {
  numero: string
  emitidoEn: Date
  qrImage: PDFImage
}

async function componerCertificado(
  _doc: PDFDocument,
  page: PDFPage,
  f: Fuentes,
  d: CertificadoDatos,
  meta: RenderMeta
): Promise<void> {
  // Fondo papel.
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C.paper })

  // Marco interior fino.
  page.drawRectangle({
    x: MARGIN - 14,
    y: MARGIN - 14,
    width: PAGE_W - (MARGIN - 14) * 2,
    height: PAGE_H - (MARGIN - 14) * 2,
    borderColor: C.ink,
    borderWidth: 1.2,
    color: undefined,
  })

  dibujarEncabezado(page, f, meta)
  dibujarEstado(page, f, d)
  dibujarDatosBici(page, f, d)
  dibujarIdentidad(page, f, d)
  dibujarQr(page, f, d, meta)
  dibujarNotaInspeccion(page, f, d)
  dibujarSello(page, f)
  dibujarPie(page, f, d, meta)
}

const HEADER_H = 96

function dibujarEncabezado(page: PDFPage, f: Fuentes, meta: RenderMeta): void {
  const top = PAGE_H - MARGIN - HEADER_H
  // Banda oscura de marca.
  page.drawRectangle({
    x: MARGIN,
    y: top,
    width: PAGE_W - MARGIN * 2,
    height: HEADER_H,
    color: C.ink,
  })
  // Acento lima a la izquierda.
  page.drawRectangle({ x: MARGIN, y: top, width: 8, height: HEADER_H, color: C.lime })

  page.drawText('RODAID', {
    x: MARGIN + 28,
    y: top + HEADER_H - 40,
    size: 28,
    font: f.display,
    color: C.lime,
  })
  page.drawText('Certificado Digital de Propiedad y Verificacion', {
    x: MARGIN + 28,
    y: top + HEADER_H - 60,
    size: 11,
    font: f.bodyBold,
    color: C.white,
  })
  page.drawText('Cedula de Identidad de la bicicleta (CIT)', {
    x: MARGIN + 28,
    y: top + HEADER_H - 76,
    size: 9,
    font: f.body,
    color: C.paperDim,
  })

  // Numero de certificado, alineado a la derecha de la banda.
  const numLabel = 'N° de certificado'
  const numW = f.body.widthOfTextAtSize(numLabel, 8)
  page.drawText(numLabel, {
    x: PAGE_W - MARGIN - 24 - numW,
    y: top + HEADER_H - 34,
    size: 8,
    font: f.body,
    color: C.paperDim,
  })
  const numVal = meta.numero
  const numValW = f.bodyBold.widthOfTextAtSize(numVal, 11)
  page.drawText(numVal, {
    x: PAGE_W - MARGIN - 24 - numValW,
    y: top + HEADER_H - 50,
    size: 11,
    font: f.bodyBold,
    color: C.lime,
  })
}

interface EstadoVisual {
  etiqueta: string
  color: RGB
  texto: RGB
}

function estadoVisual(estado: string): EstadoVisual {
  switch (estado) {
    case 'activo':
      return { etiqueta: 'IDENTIDAD VERIFICADA', color: C.lime, texto: C.ink }
    case 'bloqueado':
      return { etiqueta: 'REPORTADA COMO ROBADA', color: C.clay, texto: C.white }
    case 'pendiente':
      return { etiqueta: 'EN VALIDACION', color: C.paperDim, texto: C.ink }
    default:
      return { etiqueta: estado.toUpperCase(), color: C.paperDim, texto: C.ink }
  }
}

function dibujarEstado(page: PDFPage, f: Fuentes, d: CertificadoDatos): void {
  const v = estadoVisual(d.estado)
  const y = PAGE_H - MARGIN - HEADER_H - 44
  const padX = 14
  const textW = f.bodyBold.widthOfTextAtSize(v.etiqueta, 11)
  page.drawRectangle({
    x: MARGIN,
    y,
    width: textW + padX * 2,
    height: 26,
    color: v.color,
  })
  page.drawText(v.etiqueta, {
    x: MARGIN + padX,
    y: y + 8,
    size: 11,
    font: f.bodyBold,
    color: v.texto,
  })

  // Codigo CIT destacado a la derecha del badge.
  const citLabel = 'Codigo CIT'
  page.drawText(citLabel, {
    x: MARGIN + textW + padX * 2 + 22,
    y: y + 16,
    size: 8,
    font: f.body,
    color: C.slate,
  })
  page.drawText(d.codigoCit, {
    x: MARGIN + textW + padX * 2 + 22,
    y: y + 2,
    size: 13,
    font: f.mono,
    color: C.ink,
  })
}

// Bloque de datos de la bici (columna izquierda).
const BODY_TOP = PAGE_H - MARGIN - HEADER_H - 96
const COL_LEFT = MARGIN
const COL_LEFT_W = 300

function dibujarDatosBici(page: PDFPage, f: Fuentes, d: CertificadoDatos): void {
  seccionTitulo(page, f, COL_LEFT, BODY_TOP, 'Datos de la bicicleta')

  const filas: Array<[string, string]> = [
    ['Marca', d.bici.marca],
    ['Modelo', d.bici.modelo],
    ['Tipo', d.bici.tipo],
    ['Numero de serie', d.bici.numeroSerie],
    ['Rodado', d.bici.rodado ? `R${d.bici.rodado}` : '—'],
    ['Talle de cuadro', d.bici.talleCuadro ?? '—'],
    ['Ano', d.bici.anio ? String(d.bici.anio) : '—'],
    ['Color', d.bici.color ?? '—'],
  ]
  if (d.titular) {
    filas.push(['Titular', d.titular])
  }

  let y = BODY_TOP - 28
  for (const [label, valor] of filas) {
    page.drawText(label.toUpperCase(), {
      x: COL_LEFT,
      y,
      size: 7.5,
      font: f.body,
      color: C.slate,
    })
    page.drawText(recortar(valor, f.bodyBold, 12, COL_LEFT_W), {
      x: COL_LEFT,
      y: y - 13,
      size: 12,
      font: f.bodyBold,
      color: C.ink,
    })
    // Linea separadora tenue.
    page.drawLine({
      start: { x: COL_LEFT, y: y - 22 },
      end: { x: COL_LEFT + COL_LEFT_W, y: y - 22 },
      thickness: 0.5,
      color: C.paperDim,
    })
    y -= 36
  }
}

// Bloque de identidad / integridad (huella + BFA), debajo de los datos.
function dibujarIdentidad(page: PDFPage, f: Fuentes, d: CertificadoDatos): void {
  const top = BODY_TOP - 28 - 36 * (d.titular ? 9 : 8) - 8
  seccionTitulo(page, f, COL_LEFT, top, 'Integridad y registro')

  let y = top - 26

  // Huella SHA-256 de la identidad.
  page.drawText('HUELLA SHA-256 DE LA IDENTIDAD', {
    x: COL_LEFT,
    y,
    size: 7.5,
    font: f.body,
    color: C.slate,
  })
  y -= 12
  const hash = d.hashSha256 ?? 'No disponible'
  // Partir el hash en dos lineas para que entre.
  const mitad = Math.ceil(hash.length / 2)
  page.drawText(hash.slice(0, mitad), {
    x: COL_LEFT,
    y,
    size: 8.5,
    font: f.mono,
    color: C.ink,
  })
  if (hash.length > mitad) {
    y -= 11
    page.drawText(hash.slice(mitad), {
      x: COL_LEFT,
      y,
      size: 8.5,
      font: f.mono,
      color: C.ink,
    })
  }

  // Anclaje en la BFA. Honestidad de estado (auditoria 2026-07-11): sin
  // BFA_RPC_URL/BFA_PRIVATE_KEY/BFA_CIT_CONTRACT configuradas, ningun anclaje
  // es ONCHAIN real todavia -- el titulo y el texto solo afirman "Blockchain
  // Federal Argentina" cuando bfa.modo lo confirma.
  const onchain = d.bfa.estado === 'ACUNADO' && d.bfa.modo === 'ONCHAIN' && !!d.bfa.txHash
  const stub = d.bfa.estado === 'ACUNADO' && d.bfa.modo !== 'ONCHAIN'

  y -= 20
  page.drawText(
    onchain ? 'ANCLAJE EN LA BLOCKCHAIN FEDERAL ARGENTINA (BFA)' : 'REGISTRO DE IDENTIDAD RODAID',
    {
      x: COL_LEFT,
      y,
      size: 7.5,
      font: f.body,
      color: C.slate,
    }
  )
  y -= 12
  if (onchain) {
    page.drawText(recortar(d.bfa.txHash ?? '', f.mono, 8.5, COL_LEFT_W), {
      x: COL_LEFT,
      y,
      size: 8.5,
      font: f.mono,
      color: C.ink,
    })
    if (d.bfa.tokenId) {
      y -= 12
      page.drawText(`Token CIT #${d.bfa.tokenId}`, {
        x: COL_LEFT,
        y,
        size: 8.5,
        font: f.body,
        color: C.slate,
      })
    }
  } else if (stub) {
    page.drawText('Identidad registrada en RODAID.', {
      x: COL_LEFT,
      y,
      size: 9,
      font: f.body,
      color: C.slate,
    })
    y -= 11
    page.drawText('El anclaje en la Blockchain Federal Argentina está en proceso', {
      x: COL_LEFT,
      y,
      size: 7,
      font: f.body,
      color: C.slate,
    })
    y -= 9
    page.drawText('de habilitación institucional.', {
      x: COL_LEFT,
      y,
      size: 7,
      font: f.body,
      color: C.slate,
    })
  } else {
    page.drawText('Anclaje pendiente / no disponible.', {
      x: COL_LEFT,
      y,
      size: 9,
      font: f.body,
      color: C.slate,
    })
  }
}

// Columna derecha: QR al Verificador Publico.
const COL_RIGHT_X = MARGIN + COL_LEFT_W + 34
const QR_SIZE = 150

function dibujarQr(
  page: PDFPage,
  f: Fuentes,
  d: CertificadoDatos,
  meta: RenderMeta
): void {
  const x = COL_RIGHT_X
  const top = BODY_TOP

  seccionTitulo(page, f, x, top, 'Verificacion publica')

  const qrY = top - 28 - QR_SIZE
  // Marco del QR.
  page.drawRectangle({
    x: x - 8,
    y: qrY - 8,
    width: QR_SIZE + 16,
    height: QR_SIZE + 16,
    color: C.white,
    borderColor: C.ink,
    borderWidth: 1,
  })
  page.drawImage(meta.qrImage, { x, y: qrY, width: QR_SIZE, height: QR_SIZE })

  const sub = 'Escanea para verificar el estado'
  page.drawText(sub, {
    x,
    y: qrY - 22,
    size: 8.5,
    font: f.bodyBold,
    color: C.ink,
  })
  page.drawText('de esta bici en RODAID, gratis y', {
    x,
    y: qrY - 33,
    size: 8.5,
    font: f.body,
    color: C.slate,
  })
  page.drawText('sin cuenta.', {
    x,
    y: qrY - 44,
    size: 8.5,
    font: f.body,
    color: C.slate,
  })
  // URL legible (recortada).
  page.drawText(recortar(d.verifierUrl, f.mono, 7.5, QR_SIZE + 16), {
    x,
    y: qrY - 60,
    size: 7.5,
    font: f.mono,
    color: C.slate,
  })
}

// Nota tecnica de la inspeccion fisica (Hito 11), en el hueco de la columna
// derecha (entre el QR y el sello). Solo se dibuja si la bici fue inspeccionada.
function dibujarNotaInspeccion(
  page: PDFPage,
  f: Fuentes,
  d: CertificadoDatos
): void {
  const insp = d.inspeccion
  if (!insp) return

  const x = COL_RIGHT_X
  const w = QR_SIZE + 16
  const boxX = x - 8
  const boxH = 70
  const boxY = 286
  const innerW = w - 20

  // Tarjeta con acento de marca.
  page.drawRectangle({ x: boxX, y: boxY, width: w, height: boxH, color: C.white, borderColor: C.ink, borderWidth: 1 })
  page.drawRectangle({ x: boxX, y: boxY, width: 4, height: boxH, color: C.limeDeep })

  page.drawText('INSPECCION FISICA', {
    x,
    y: boxY + boxH - 16,
    size: 7.5,
    font: f.bodyBold,
    color: C.ink,
  })

  // Texto requerido: realizada por Taller [Nombre], Inspector [Nombre].
  const nota = insp.taller
    ? `Realizada por Taller ${insp.taller}, Inspector ${insp.inspector}.`
    : `Realizada por Inspector ${insp.inspector}.`
  const lineas = envolver(nota, f.body, 8, innerW).slice(0, 3)
  let y = boxY + boxH - 30
  for (const linea of lineas) {
    page.drawText(linea, { x, y, size: 8, font: f.body, color: C.inkSoft })
    y -= 10
  }

  // Firma del acta (huella).
  page.drawText(`Firma ${insp.firmaHash.slice(0, 12)}…`, {
    x,
    y: boxY + 8,
    size: 6.5,
    font: f.mono,
    color: C.slate,
  })
}

// Sello de seguridad (emblema vectorial), columna derecha inferior.
function dibujarSello(page: PDFPage, f: Fuentes): void {
  const cx = COL_RIGHT_X + QR_SIZE / 2
  const cy = MARGIN + 150
  const r = 58

  // Aureola lima.
  page.drawCircle({ x: cx, y: cy, size: r + 6, color: C.lime })
  // Disco oscuro.
  page.drawCircle({ x: cx, y: cy, size: r, color: C.ink })
  // Anillos.
  page.drawCircle({ x: cx, y: cy, size: r - 6, borderColor: C.lime, borderWidth: 1.2 })
  page.drawCircle({ x: cx, y: cy, size: r - 14, borderColor: C.paperDim, borderWidth: 0.6 })

  // Ticks radiales (estetica de sello oficial).
  const ticks = 36
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2
    const r1 = r - 2
    const r2 = r - 7
    page.drawLine({
      start: { x: cx + Math.cos(a) * r1, y: cy + Math.sin(a) * r1 },
      end: { x: cx + Math.cos(a) * r2, y: cy + Math.sin(a) * r2 },
      thickness: 0.7,
      color: C.lime,
    })
  }

  // Texto central.
  centrarTexto(page, f.display, 'RODAID', 15, cx, cy + 6, C.lime)
  centrarTexto(page, f.bodyBold, 'VERIFICADO', 8, cx, cy - 9, C.white)
  centrarTexto(page, f.body, 'CIT • IDENTIDAD', 6.5, cx, cy - 20, C.paperDim)
}

function dibujarPie(
  page: PDFPage,
  f: Fuentes,
  d: CertificadoDatos,
  meta: RenderMeta
): void {
  const y = MARGIN + 6
  // Linea superior del pie.
  page.drawLine({
    start: { x: MARGIN, y: y + 58 },
    end: { x: PAGE_W - MARGIN, y: y + 58 },
    thickness: 0.8,
    color: C.ink,
  })

  const emision = meta.emitidoEn
  const sello = `Sello temporal del sistema: ${emision.toISOString()}`
  const venc = d.fechaVencimiento
    ? `Vigencia del CIT hasta: ${new Date(d.fechaVencimiento).toISOString().slice(0, 10)}`
    : 'Vigencia del CIT: —'

  page.drawText('Documento firmado digitalmente', {
    x: MARGIN,
    y: y + 44,
    size: 9,
    font: f.bodyBold,
    color: C.ink,
  })
  page.drawText(
    'Firma detached PKCS#7 (CMS) de la Autoridad Certificadora de RODAID, incrustada como firma estandar de PDF.',
    { x: MARGIN, y: y + 32, size: 7.5, font: f.body, color: C.slate }
  )
  page.drawText(
    'Si el documento se altera, la firma se invalida. Verificable offline con un lector de PDF estandar.',
    { x: MARGIN, y: y + 22, size: 7.5, font: f.body, color: C.slate }
  )
  page.drawText(sello, {
    x: MARGIN,
    y: y + 8,
    size: 7.5,
    font: f.mono,
    color: C.ink,
  })

  // Vigencia, alineada a la derecha.
  const vencW = f.body.widthOfTextAtSize(venc, 7.5)
  page.drawText(venc, {
    x: PAGE_W - MARGIN - vencW,
    y: y + 8,
    size: 7.5,
    font: f.body,
    color: C.slate,
  })
}

// ── Helpers de dibujo ────────────────────────────────────────────────────────

function seccionTitulo(
  page: PDFPage,
  f: Fuentes,
  x: number,
  y: number,
  texto: string
): void {
  page.drawText(texto, { x, y, size: 12, font: f.display, color: C.ink })
  page.drawRectangle({ x, y: y - 6, width: 28, height: 2.5, color: C.limeDeep })
}

function centrarTexto(
  page: PDFPage,
  font: PDFFont,
  texto: string,
  size: number,
  cx: number,
  y: number,
  color: RGB
): void {
  const w = font.widthOfTextAtSize(texto, size)
  page.drawText(texto, { x: cx - w / 2, y, size, font, color })
}

/** Recorta un texto con elipsis para que no exceda un ancho dado. */
function recortar(texto: string, font: PDFFont, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(texto, size) <= maxW) return texto
  let out = texto
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxW) {
    out = out.slice(0, -1)
  }
  return `${out}…`
}

/** Envuelve un texto en varias lineas para que cada una entre en `maxW`. */
function envolver(
  texto: string,
  font: PDFFont,
  size: number,
  maxW: number
): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean)
  const lineas: string[] = []
  let actual = ''
  for (const palabra of palabras) {
    const tentativa = actual ? `${actual} ${palabra}` : palabra
    if (font.widthOfTextAtSize(tentativa, size) <= maxW) {
      actual = tentativa
    } else {
      if (actual) lineas.push(actual)
      actual = palabra
    }
  }
  if (actual) lineas.push(actual)
  return lineas
}

// ── QR ───────────────────────────────────────────────────────────────────────

/** Genera el QR (PNG) al vuelo apuntando al Verificador Publico. */
async function generarQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    color: { dark: '#14160eff', light: '#ffffffff' },
  })
}

// ── Almacenamiento (Netlify Blobs) ───────────────────────────────────────────

function getCertStore() {
  return getStore(STORE_CERTIFICADOS)
}

/** Copia el contenido de un Uint8Array a un ArrayBuffer (input de Blobs). */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u8.byteLength)
  new Uint8Array(out).set(u8)
  return out
}

interface BlobMeta {
  [key: string]: string | undefined
  fingerprint?: string
  numero?: string
  emitidoEn?: string
  documentoHash?: string
  modoFirma?: string
}

async function leerDeBlobs(
  key: string,
  fingerprint: string
): Promise<Omit<CertificadoGenerado, 'fromCache'> | null> {
  try {
    const store = getCertStore()
    const res = await store.getWithMetadata(key, { type: 'arrayBuffer' })
    if (!res) return null
    const meta = (res.metadata ?? {}) as BlobMeta
    // Si el contenido de origen cambio, el cacheado es obsoleto.
    if (meta.fingerprint !== fingerprint) return null
    return {
      pdf: new Uint8Array(res.data as ArrayBuffer),
      numero: meta.numero ?? '',
      emitidoEn: meta.emitidoEn ?? '',
      documentoHash: meta.documentoHash ?? '',
      modoFirma: (meta.modoFirma as CertificadoGenerado['modoFirma']) ?? 'DEV',
    }
  } catch {
    // Sin Blobs disponibles (p. ej. local sin config): se genera on-demand.
    return null
  }
}

async function guardarEnBlobs(
  key: string,
  generado: Omit<CertificadoGenerado, 'fromCache'>,
  fingerprint: string
): Promise<void> {
  try {
    const store = getCertStore()
    const meta: BlobMeta = {
      fingerprint,
      numero: generado.numero,
      emitidoEn: generado.emitidoEn,
      documentoHash: generado.documentoHash,
      modoFirma: generado.modoFirma,
    }
    await store.set(key, toArrayBuffer(generado.pdf), { metadata: meta })
  } catch {
    // El almacenamiento es best-effort: nunca frena la descarga.
  }
}
