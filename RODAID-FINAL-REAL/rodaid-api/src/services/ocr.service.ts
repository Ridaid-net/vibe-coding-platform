// ─── RODAID · OCR Service — Número de Serie desde Foto ───
// Extrae el número de serie de una foto del cuadro de la bicicleta.
//
// Arquitectura de motores (prioridad):
//   1. Claude Vision (claude-sonnet-4-20250514) — principal
//      · Prompt especializado en seriales de bicicletas
//      · Maneja O/0, I/1, S/5, B/8 correctamente
//      · Retorna candidatos ordenados por confianza
//
//   2. Tesseract.js — secundario cuando Claude no disponible
//      · Requiere tessdata instalado localmente
//      · PSM 6 (bloque) + PSM 8 (línea)
//      · Whitelist alfanumérico
//
//   3. FALLBACK — retorna vacío para confirmación manual
//
// El OCR no bloquea la emisión del CIT.
// Si falla → el inspector confirma el serial manualmente.
// Todos los resultados se guardan en ocr_resultados (auditoría).

import crypto      from 'crypto'
import Anthropic   from '@anthropic-ai/sdk'
import sharp       from 'sharp'
import { query }   from '../config/database'
import { log }     from '../middleware/logger'
import { env }     from '../config/env'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface OCRInput {
  imageBuffer:   Buffer
  mimeType:      'image/jpeg' | 'image/png' | 'image/webp'
  fotoUrl?:      string
  inspectorId?:  string
  bicicletaId?:  string
  citId?:        string
  serialManual?: string
}

export interface CandidatoSerial {
  texto:      string
  confianza:  number
  region?:    string
}

export interface OCRResult {
  serialDetectado:  string | null
  confianza:        number
  motor:            'CLAUDE' | 'TESSERACT' | 'FALLBACK'
  textoRaw:         string
  candidatos:       CandidatoSerial[]
  coincideManual:   boolean | null
  similitudManual:  number | null
  procesadoEn:      number
  ocrId?:           string
}

export interface ValidacionOCR {
  aprobado:      boolean
  motivo:        string
  serialOCR:     string | null
  serialManual:  string
  confianza:     number
  similitud:     number
  recomendacion: string
}

// ══════════════════════════════════════════════════════════
// NORMALIZACIÓN Y UTILIDADES
// ══════════════════════════════════════════════════════════

const SERIAL_RE = /[A-Z0-9][A-Z0-9\-_.]{3,58}[A-Z0-9]/g

export function normalizarSerial(raw: string): string {
  return raw.toUpperCase()
    .replace(/[^A-Z0-9\-_.]/g, '')
    .replace(/^[\-_.]+|[\-_.]+$/g, '')
    .trim()
}

function esSerialValido(s: string): boolean {
  return s.length >= 5 && s.length <= 60 &&
    /^[A-Z0-9]/.test(s) && /[A-Z0-9]$/.test(s)
}

function extraerCandidatosDeTexto(texto: string, confianza: number): CandidatoSerial[] {
  const seen = new Set<string>()
  return [...texto.toUpperCase().matchAll(SERIAL_RE)]
    .map(m => ({ texto: normalizarSerial(m[0]), confianza }))
    .filter(c => esSerialValido(c.texto) && !seen.has(c.texto) && seen.add(c.texto))
}

function levenshtein(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b)  return 100
  const la = a.length; const lb = b.length
  const dp = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  )
  for (let i = 1; i <= la; i++) for (let j = 1; j <= lb; j++) {
    dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1))
  }
  return Math.round((1 - dp[la][lb] / Math.max(la, lb)) * 100)
}

// ══════════════════════════════════════════════════════════
// PREPROCESAMIENTO
// ══════════════════════════════════════════════════════════

async function preprocesar(buffer: Buffer, mimeType: string): Promise<Buffer> {
  try {
    return await sharp(buffer)
      .rotate()                    // auto-rotate por EXIF
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: false })
      .greyscale()
      .normalise()
      .sharpen({ sigma: 1.5 })
      .toFormat(mimeType === 'image/png' ? 'png' : 'jpeg', { quality: 95 })
      .toBuffer()
  } catch {
    return buffer
  }
}

// ══════════════════════════════════════════════════════════
// MOTOR 1: CLAUDE VISION (principal)
// ══════════════════════════════════════════════════════════

const CLAUDE_PROMPT = `Analizá esta foto del cuadro de una bicicleta para leer el número de serie grabado en el metal.

El número de serie suele estar en:
- La parte inferior del tubo del asiento (bottom bracket shell)
- El tubo del asiento o tubo inferior
- La cabeza del cuadro (head tube)

Características:
- Alfanumérico: letras A-Z y números 0-9, a veces con guiones
- Longitud: 5 a 20 caracteres
- Está grabado/estampado en el metal

⚠️ CUIDADO con confusiones visuales comunes en metal grabado:
- O (letra O) vs 0 (cero)  
- I (i mayúscula) vs 1 (uno) vs l (ele)
- S vs 5, B vs 8, Z vs 2

Devolvé SOLO este JSON exacto (sin texto antes ni después):
{
  "candidatos": [
    {"texto": "SERIAL-AQUI", "confianza": 95, "region": "tubo inferior"}
  ],
  "observaciones": "descripción breve de lo visible"
}

Si no hay número de serie visible: {"candidatos": [], "observaciones": "No se detectó número de serie en la imagen"}`

async function ocr_claude(buffer: Buffer, mimeType: string): Promise<{
  texto: string; confianza: number; candidatos: CandidatoSerial[]
}> {
  const client = new Anthropic()

  const msg = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        {
          type:   'image',
          source: {
            type:       'base64',
            media_type: mimeType as 'image/jpeg',
            data:       buffer.toString('base64'),
          },
        },
        { type: 'text', text: CLAUDE_PROMPT },
      ],
    }],
  })

  const rawText = msg.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')

  // Extraer JSON de la respuesta
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    log.ocr.warn({ raw: rawText.slice(0, 80) }, 'Claude: respuesta sin JSON válido')
    // Intentar extraer candidatos del texto libre
    const candidatosLibres = extraerCandidatosDeTexto(rawText, 50)
    return { texto: rawText, confianza: candidatosLibres.length > 0 ? 50 : 0, candidatos: candidatosLibres }
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    candidatos: Array<{ texto: string; confianza: number; region?: string }>
    observaciones?: string
  }

  const candidatos: CandidatoSerial[] = (parsed.candidatos ?? [])
    .map(c => ({
      texto:     normalizarSerial(c.texto),
      confianza: Math.min(100, Math.max(0, c.confianza ?? 80)),
      region:    c.region,
    }))
    .filter(c => esSerialValido(c.texto))

  const confianza = candidatos.length > 0 ? Math.max(...candidatos.map(c => c.confianza)) : 0

  log.ocr.debug({
    candidatos:    candidatos.length,
    confianza,
    observaciones: (parsed.observaciones ?? '').slice(0, 80),
  }, 'Claude Vision: resultado')

  return {
    texto:      parsed.observaciones ?? rawText,
    confianza,
    candidatos,
  }
}

// ══════════════════════════════════════════════════════════
// MOTOR 2: TESSERACT.JS (secundario — requiere tessdata)
// ══════════════════════════════════════════════════════════

async function ocr_tesseract(buffer: Buffer): Promise<{
  texto: string; confianza: number; candidatos: CandidatoSerial[]
} | null> {
  try {
    const { createWorker, PSM } = await import('tesseract.js')

    const tessdataPath = env.TESSERACT_DATA_PATH ?? undefined

    const worker = await createWorker('eng', 1, {
      logger:      () => {},
      ...(tessdataPath ? {
        langPath:  tessdataPath,
        cachePath: tessdataPath,
        gzip:      false,
      } : {}),
    })

    try {
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.',
        preserve_interword_spaces: '1',
      })

      // Dos pasadas: bloque y línea única
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
      const p1 = await worker.recognize(buffer)
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD })
      const p2 = await worker.recognize(buffer)

      const texto    = `${p1.data.text.trim()}\n${p2.data.text.trim()}`
      const confianza = Math.max(p1.data.confidence, p2.data.confidence)
      const candidatos = extraerCandidatosDeTexto(texto, confianza)

      log.ocr.debug({ confianza: confianza.toFixed(1), candidatos: candidatos.length }, 'Tesseract: resultado')
      return { texto, confianza, candidatos }

    } finally {
      await worker.terminate()
    }
  } catch (err) {
    log.ocr.warn({ err: (err as Error).message.slice(0, 80) }, 'Tesseract no disponible — usando solo Claude Vision')
    return null
  }
}

// ══════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — Cascada de motores
// ══════════════════════════════════════════════════════════

export async function extraerSerialDeFoto(input: OCRInput): Promise<OCRResult> {
  const t0       = Date.now()
  const fotoHash = crypto.createHash('sha256').update(input.imageBuffer).digest('hex')

  log.ocr.info({
    size:     input.imageBuffer.length,
    mime:     input.mimeType,
    hash:     fotoHash.slice(0, 16) + '...',
  }, '🔍 OCR: iniciando extracción de serial')

  // Preprocesar imagen
  const imgProcesada = await preprocesar(input.imageBuffer, input.mimeType)

  let motor:      OCRResult['motor'] = 'FALLBACK'
  let textoRaw   = ''
  let confianza  = 0
  let candidatos: CandidatoSerial[] = []

  // ── Motor 1: Claude Vision (siempre intentar primero) ────
  try {
    const c = await ocr_claude(imgProcesada, input.mimeType)
    textoRaw   = c.texto
    confianza  = c.confianza
    candidatos = c.candidatos
    motor      = 'CLAUDE'
    log.ocr.info({ candidatos: candidatos.length, confianza: confianza.toFixed(1) }, 'Claude Vision OK')
  } catch (err) {
    log.ocr.warn({ err: (err as Error).message.slice(0, 80) }, 'Claude Vision falló — intentando Tesseract')
  }

  // ── Motor 2: Tesseract (si Claude falla o baja confianza) ─
  if (candidatos.length === 0 || confianza < 50) {
    const t = await ocr_tesseract(imgProcesada)
    if (t && t.candidatos.length > 0) {
      textoRaw   += '\n' + t.texto
      // Combinar candidatos de ambos motores
      const seen = new Set(candidatos.map(c => c.texto))
      candidatos = [...candidatos, ...t.candidatos.filter(c => !seen.has(c.texto))]
        .sort((a, b) => b.confianza - a.confianza)
      if (candidatos.length > 0) {
        confianza = Math.max(confianza, t.confianza)
        motor = motor === 'CLAUDE' ? 'CLAUDE' : 'TESSERACT'
      }
    }
  }

  // ── Seleccionar el mejor candidato ───────────────────────
  let serialDetectado = candidatos[0]?.texto ?? null
  let similitudManual: number | null = null
  let coincideManual:  boolean | null = null

  if (input.serialManual && candidatos.length > 0) {
    const manual = normalizarSerial(input.serialManual)
    const ranked = candidatos
      .map(c => ({ ...c, sim: levenshtein(c.texto, manual) }))
      .sort((a, b) => a.texto === manual ? -1 : b.texto === manual ? 1 : b.sim - a.sim)

    serialDetectado = ranked[0]?.texto ?? null
    similitudManual = ranked[0]?.sim ?? null
    coincideManual  = serialDetectado === manual
    candidatos      = ranked
  }

  const ms = Date.now() - t0
  log.ocr.info({
    motor, confianza: confianza.toFixed(1),
    serial: serialDetectado?.slice(0, 20),
    coincide: coincideManual, ms,
  }, '✓ OCR completado')

  // ── Persistir en DB ───────────────────────────────────────
  let ocrId: string | undefined
  try {
    const row = await query<{ id: string }>(
      `INSERT INTO ocr_resultados
         (foto_url, foto_hash, texto_raw, serial_detectado, serial_manual,
          confianza, motor, coincide, bicicleta_id, cit_id, inspector_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        input.fotoUrl ?? null,
        fotoHash,
        textoRaw.slice(0, 2000),
        serialDetectado,
        input.serialManual ?? null,
        confianza,
        motor,
        coincideManual,
        input.bicicletaId ?? null,
        input.citId ?? null,
        input.inspectorId ?? null,
        JSON.stringify({
          candidatos: candidatos.slice(0, 10),
          ms,
          bytes:   input.imageBuffer.length,
          mime:    input.mimeType,
        }),
      ]
    )
    ocrId = row[0]?.id
  } catch (err) {
    log.ocr.warn({ err: (err as Error).message }, 'OCR: persist falló')
  }

  return {
    serialDetectado,
    confianza,
    motor,
    textoRaw: textoRaw.slice(0, 500),
    candidatos: candidatos.slice(0, 10),
    coincideManual,
    similitudManual,
    procesadoEn: ms,
    ocrId,
  }
}

// ══════════════════════════════════════════════════════════
// VALIDACIÓN OCR vs SERIAL MANUAL
// ══════════════════════════════════════════════════════════

export function validarOCRvsManual(ocr: OCRResult, serialManual: string): ValidacionOCR {
  const manual = normalizarSerial(serialManual)
  const det    = ocr.serialDetectado

  if (!det) {
    return {
      aprobado:      false,
      motivo:        'OCR no detectó ningún número de serie en la imagen',
      serialOCR:     null,
      serialManual:  manual,
      confianza:     0,
      similitud:     0,
      recomendacion: 'Tomar foto más nítida del número de serie grabado en el cuadro. Asegurar buena iluminación y foco en el metal.',
    }
  }

  const sim = levenshtein(det, manual)

  if (det === manual) {
    return {
      aprobado:      true,
      motivo:        `Serial verificado por ${ocr.motor} con ${ocr.confianza.toFixed(0)}% de confianza`,
      serialOCR:     det,
      serialManual:  manual,
      confianza:     ocr.confianza,
      similitud:     100,
      recomendacion: 'Serial confirmado por OCR ✓',
    }
  }

  if (sim >= 80) {
    return {
      aprobado:      false,
      motivo:        `Serial muy similar (${sim}%): OCR detectó "${det}" / Manual dice "${manual}"`,
      serialOCR:     det,
      serialManual:  manual,
      confianza:     ocr.confianza,
      similitud:     sim,
      recomendacion: `Posible confusión visual en caracteres similares. Verificar: ¿es "${det}" o "${manual}"? Confusiones comunes: O/0, I/1, S/5, B/8`,
    }
  }

  return {
    aprobado:      false,
    motivo:        `Serial OCR (${det}) diferente del manual (${manual}) — similitud ${sim}%`,
    serialOCR:     det,
    serialManual:  manual,
    confianza:     ocr.confianza,
    similitud:     sim,
    recomendacion: 'Verificar que la foto corresponde al cuadro correcto y que el serial fue ingresado correctamente',
  }
}

// ══════════════════════════════════════════════════════════
// STATS (admin)
// ══════════════════════════════════════════════════════════

export async function getOCRStats() {
  const [totales, porMotor, recientes] = await Promise.all([
    query<{ total: string; coincidencias: string; confianza_prom: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE coincide=TRUE)::text AS coincidencias,
              ROUND(AVG(confianza),1)::text AS confianza_prom
       FROM ocr_resultados`, []
    ),
    query<{ motor: string; count: string; confianza_prom: string }>(
      `SELECT motor, COUNT(*)::text AS count, ROUND(AVG(confianza),1)::text AS confianza_prom
       FROM ocr_resultados GROUP BY motor`, []
    ),
    query<{ serial_detectado: string | null; motor: string; confianza: number; coincide: boolean | null; creado_en: Date }>(
      `SELECT serial_detectado, motor, confianza, coincide, creado_en
       FROM ocr_resultados ORDER BY creado_en DESC LIMIT 5`, []
    ),
  ])

  return {
    total:             parseInt(totales[0]?.total ?? '0'),
    coincidencias:     parseInt(totales[0]?.coincidencias ?? '0'),
    confianzaPromedio: parseFloat(totales[0]?.confianza_prom ?? '0'),
    porMotor: Object.fromEntries(porMotor.map(r => [r.motor, {
      count:         parseInt(r.count),
      confianzaProm: parseFloat(r.confianza_prom),
    }])),
    recientes,
  }
}
