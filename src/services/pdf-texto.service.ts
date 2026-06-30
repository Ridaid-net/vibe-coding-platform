import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib'

/**
 * RODAID — Hito 18: Extraccion de texto del PDF oficial del MPF.
 *
 * Para validar la integridad de la denuncia (que contenga el numero de
 * expediente, la fecha y los datos del propietario) hay que LEER el texto del
 * PDF. La denuncia del Ministerio Publico Fiscal es un documento DIGITAL
 * (texto), por lo que su texto vive en los content streams del PDF. Este
 * servicio lo extrae sin dependencias pesadas ni navegador (apto para el entorno
 * serverless de Netlify), decodificando los streams (FlateDecode via pdf-lib) y
 * parseando los operadores de texto (`Tj`, `TJ`, `'`, `"`), tanto cadenas
 * literales `(...)` como hexadecimales `<...>`.
 *
 * OCR (si es necesario): si el PDF es una IMAGEN escaneada (no trae texto), la
 * extraccion devuelve poco o nada. En ese caso se intenta un OCR externo
 * configurable (`RODAID_OCR_URL`); si no hay OCR configurado, se informa que el
 * documento requiere revision (no se puede validar la estructura). Esto respeta
 * el patron del proyecto: opera de punta a punta en preview y, al configurar el
 * servicio real, opera en produccion sin tocar codigo.
 */

/** Umbral (caracteres) por debajo del cual se considera que no se pudo leer. */
const MIN_TEXTO_UTIL = 40

export interface ExtraccionTexto {
  texto: string
  /** Fuente del texto: 'pdf' (content streams) u 'ocr' (servicio externo). */
  fuente: 'pdf' | 'ocr' | 'ninguna'
  /** true si hubo que recurrir al OCR (PDF escaneado / sin texto). */
  usoOcr: boolean
  /** true si no se pudo obtener texto util (ni del PDF ni del OCR). */
  ilegible: boolean
}

// ── Decodificacion de cadenas PDF ─────────────────────────────────────────────

/** Decodifica una cadena literal PDF (sin los parentesis), resolviendo escapes. */
function decodeLiteral(s: string): string {
  const out: string[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      const n = s[i + 1]
      if (n === 'n') {
        out.push('\n')
        i++
      } else if (n === 'r') {
        out.push('\r')
        i++
      } else if (n === 't') {
        out.push('\t')
        i++
      } else if (n === 'b' || n === 'f') {
        out.push(' ')
        i++
      } else if (n >= '0' && n <= '7') {
        // Codigo octal de 1 a 3 digitos.
        let oct = n
        i++
        for (let k = 0; k < 2; k++) {
          if (s[i + 1] >= '0' && s[i + 1] <= '7') {
            oct += s[i + 1]
            i++
          }
        }
        out.push(String.fromCharCode(parseInt(oct, 8) & 0xff))
      } else if (n !== undefined) {
        out.push(n)
        i++
      }
    } else {
      out.push(c)
    }
  }
  return out.join('')
}

/** Decodifica una cadena hexadecimal PDF (sin los `<` `>`). */
function decodeHex(h: string): string {
  const clean = h.replace(/\s+/g, '')
  const even = clean.length % 2 ? clean + '0' : clean
  let out = ''
  for (let i = 0; i < even.length; i += 2) {
    out += String.fromCharCode(parseInt(even.substr(i, 2), 16) & 0xff)
  }
  return out
}

/**
 * Extrae el texto visible de un content stream ya decodificado. Reconoce los
 * operadores de muestra de texto y acumula las cadenas que muestran.
 */
function extraerDeContentStream(content: string): string {
  const trozos: string[] = []
  let pendientes: string[] = []
  let i = 0
  const n = content.length

  while (i < n) {
    const c = content[i]
    // Cadena literal: ( ... ) con parentesis balanceados y escapes.
    if (c === '(') {
      i++
      let s = ''
      let depth = 1
      while (i < n && depth > 0) {
        const ch = content[i]
        if (ch === '\\') {
          s += ch + (content[i + 1] ?? '')
          i += 2
          continue
        }
        if (ch === '(') depth++
        if (ch === ')') {
          depth--
          if (depth === 0) {
            i++
            break
          }
        }
        s += ch
        i++
      }
      pendientes.push(decodeLiteral(s))
      continue
    }
    // Cadena hexadecimal: < ... > (no confundir con el diccionario << >>).
    if (c === '<' && content[i + 1] !== '<') {
      const j = content.indexOf('>', i)
      if (j === -1) break
      pendientes.push(decodeHex(content.slice(i + 1, j)))
      i = j + 1
      continue
    }
    if (c === '<' && content[i + 1] === '<') {
      i += 2
      continue
    }
    // Operador (secuencia de letras / *, ', ").
    if (/[A-Za-z'"]/.test(c)) {
      let op = ''
      while (i < n && /[A-Za-z0-9*'"]/.test(content[i])) {
        op += content[i]
        i++
      }
      if (op === 'Tj' || op === "'" || op === '"') {
        if (pendientes.length) trozos.push(pendientes[pendientes.length - 1])
        pendientes = []
      } else if (op === 'TJ') {
        if (pendientes.length) trozos.push(pendientes.join(''))
        pendientes = []
      } else if (op === 'Td' || op === 'TD' || op === 'T*') {
        // Salto de linea/posicion: separa palabras para no pegarlas.
        trozos.push(' ')
      }
      continue
    }
    i++
  }
  return trozos.join('')
}

/**
 * Extrae el texto de un PDF leyendo sus content streams. Devuelve cadena vacia
 * si el PDF no trae texto (p. ej. escaneado) o no se pudo parsear.
 */
export async function extraerTextoDePdf(bytes: Uint8Array): Promise<string> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch {
    return ''
  }
  const partes: string[] = []
  try {
    doc.context.enumerateIndirectObjects().forEach(([, obj]) => {
      if (obj instanceof PDFRawStream) {
        try {
          const decoded = decodePDFRawStream(obj).decode()
          const raw = Buffer.from(decoded).toString('latin1')
          // Solo nos interesan los content streams (los que traen operadores de
          // texto). Un filtro rapido evita parsear imagenes/fuentes embebidas.
          if (/(\bTj\b|\bTJ\b|\bBT\b)/.test(raw)) {
            partes.push(extraerDeContentStream(raw))
          }
        } catch {
          // Stream no decodificable (filtro no soportado): se ignora.
        }
      }
    })
  } catch {
    return ''
  }
  return normalizar(partes.join(' '))
}

/** Normaliza el texto extraido: colapsa espacios y recorta. */
function normalizar(texto: string): string {
  return texto
    .replace(/ /g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim()
}

// ── OCR externo (si es necesario) ─────────────────────────────────────────────

/** URL del servicio OCR externo (opcional). Sin ella, no hay OCR. */
function ocrUrl(): string | null {
  const raw = process.env.RODAID_OCR_URL
  return raw && raw.trim().length > 0 ? raw.trim() : null
}

/**
 * Intenta extraer texto de un PDF escaneado con un servicio OCR externo. Es
 * best-effort: si no hay OCR configurado o falla, devuelve null. El contrato
 * esperado del servicio: POST del PDF (application/pdf) -> JSON `{ text }`.
 */
async function intentarOcr(bytes: Uint8Array): Promise<string | null> {
  const url = ocrUrl()
  if (!url) return null
  try {
    const apiKey = process.env.RODAID_OCR_API_KEY
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: Buffer.from(bytes),
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { text?: unknown } | null
    const texto = typeof data?.text === 'string' ? normalizar(data.text) : ''
    return texto.length > 0 ? texto : null
  } catch (error) {
    console.error('[denuncia] el servicio OCR fallo', error)
    return null
  }
}

/**
 * Obtiene el texto del PDF: primero desde sus content streams; si no hay texto
 * util (PDF escaneado), recurre al OCR externo si esta configurado. Informa la
 * fuente y si el documento quedo ilegible (caso en que la denuncia debe ir a
 * revision en lugar de bloquear automaticamente).
 */
export async function obtenerTextoDocumento(
  bytes: Uint8Array
): Promise<ExtraccionTexto> {
  const delPdf = await extraerTextoDePdf(bytes)
  if (delPdf.length >= MIN_TEXTO_UTIL) {
    return { texto: delPdf, fuente: 'pdf', usoOcr: false, ilegible: false }
  }
  const ocr = await intentarOcr(bytes)
  if (ocr && ocr.length >= MIN_TEXTO_UTIL) {
    return { texto: ocr, fuente: 'ocr', usoOcr: true, ilegible: false }
  }
  // No se pudo leer ni del PDF ni del OCR: el mejor texto disponible (si hay).
  const mejor = (ocr ?? delPdf).trim()
  return {
    texto: mejor,
    fuente: ocr ? 'ocr' : delPdf ? 'pdf' : 'ninguna',
    usoOcr: Boolean(ocr),
    ilegible: true,
  }
}
