// ─── RODAID · PDF Controller — POST /api/v1/cit/pdf ──────
// Genera el PDF del CIT con Puppeteer (Chrome headless) o
// PDFKit (fallback automático) y lo devuelve al cliente.
//
// Flujo:
//   1. Validar body (citId, formato, regenerar)
//   2. Autorización: propietario, inspector, o admin
//   3. Cache hit Redis → retornar directo (TTL 24h)
//   4. Cargar datos completos del CIT desde PostgreSQL
//   5. generarPDFPuppeteer() → Puppeteer | PDFKit fallback
//   6. Guardar en caché Redis (24h)
//   7. Fire-and-forget: subir PDF a IPFS si no está aún
//   8. Responder según formato: stream | base64 | url
//
// Rate limit: 2 req/30s por usuario (PDFs son costosos)
// Caché:      Redis key `pdf:cit:{citId}:{motor}`, TTL 86400s
// Timeout:    30s (configurable PUPPETEER_TIMEOUT_MS)

import { Router, Request, Response, NextFunction }  from 'express'
import { z }                          from 'zod'
import { query, queryOne }            from '../config/database'
import { log }                        from '../middleware/logger'
import { getRedis }                   from '../config/redis'
import {
  generarPDFPuppeteer,
  cargarCITParaPDF,
  getHTMLParaPreview,
  browserPool,
}                                     from '../services/pdf.puppeteer.service'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

interface AuthRequest extends Request {
  user?: { sub: string; rol: string }
}

const BodySchema = z.object({
  citId:      z.string().uuid('citId debe ser un UUID válido'),
  formato:    z.enum(['attachment', 'inline', 'base64']).default('attachment'),
  regenerar:  z.boolean().default(false),   // forzar re-generación ignorando caché
})

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

const CACHE_TTL_S = 86_400   // 24 horas

function cacheKey(citId: string, motor: 'PUPPETEER' | 'PDFKIT') {
  return `pdf:cit:${citId}:${motor.toLowerCase()}`
}

async function getCached(citId: string): Promise<{ buffer: Buffer; motor: string } | null> {
  const redis = getRedis()
  for (const motor of ['puppeteer', 'pdfkit'] as const) {
    const key  = `pdf:cit:${citId}:${motor}`
    const data = await redis.getBuffer(key).catch(() => null)
    if (data) {
      return { buffer: data, motor: motor.toUpperCase() }
    }
  }
  return null
}

async function setCache(citId: string, motor: string, buffer: Buffer): Promise<void> {
  try {
    const redis = getRedis()
    const key   = `pdf:cit:${citId}:${motor.toLowerCase()}`
    await redis.set(key, buffer, 'EX', CACHE_TTL_S)
  } catch (err) {
    log.pdf.warn({ err: (err as Error).message }, 'PDF cache write falló')
  }
}

async function invalidarCache(citId: string): Promise<void> {
  try {
    const redis = getRedis()
    await redis.del(`pdf:cit:${citId}:puppeteer`, `pdf:cit:${citId}:pdfkit`)
  } catch { /* best-effort */ }
}

function enviarPDF(
  res: Response,
  buffer: Buffer,
  numeroCIT: string,
  formato: 'attachment' | 'inline' | 'base64',
  motor: string,
  duracionMs: number,
  fromCache: boolean
): void {
  res.setHeader('X-PDF-Motor',     motor)
  res.setHeader('X-PDF-Ms',        String(duracionMs))
  res.setHeader('X-PDF-FromCache', fromCache ? '1' : '0')
  res.setHeader('X-PDF-Bytes',     String(buffer.length))

  if (formato === 'base64') {
    res.json({
      ok:        true,
      data: {
        base64:    buffer.toString('base64'),
        mimeType:  'application/pdf',
        filename:  `CIT-${numeroCIT}.pdf`,
        bytes:     buffer.length,
        motor,
        fromCache,
        duracionMs,
      },
    })
    return
  }

  const disposition = formato === 'inline' ? 'inline' : 'attachment'
  res.setHeader('Content-Type',        'application/pdf')
  res.setHeader('Content-Disposition', `${disposition}; filename="CIT-${numeroCIT}.pdf"`)
  res.setHeader('Content-Length',      String(buffer.length))
  res.setHeader('Cache-Control',       'private, max-age=3600')
  res.send(buffer)
}

// ══════════════════════════════════════════════════════════
// AUTORIZACIÓN
// ══════════════════════════════════════════════════════════

async function verificarAcceso(
  citId: string,
  userId: string,
  rol: string
): Promise<{ numeroCIT: string; propietarioId: string; inspectorUserId: string | null } | null> {
  return queryOne<{ numeroCIT: string; propietarioId: string; inspectorUserId: string | null }>(
    `SELECT c.numero_cit AS "numeroCIT",
            c.propietario_id AS "propietarioId",
            i.usuario_id AS "inspectorUserId"
     FROM cits c
     LEFT JOIN inspectores i ON i.id = c.inspector_id
     WHERE c.id = $1`,
    [citId]
  )
}

// ══════════════════════════════════════════════════════════
// HANDLER PRINCIPAL: POST /api/v1/cit/pdf
// ══════════════════════════════════════════════════════════

export async function postCITPdf(req: AuthRequest, res: Response): Promise<void> {
  const t0 = Date.now()

  // 1. Validar body
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'BODY_INVALIDO',
      message: parsed.error.issues[0]?.message ?? 'body inválido' } })
    return
  }
  const { citId, formato, regenerar } = parsed.data
  const userId = req.user?.sub
  const rol    = req.user?.rol ?? 'anonimo'

  // 2. Verificar que el CIT existe y el usuario tiene acceso
  const cit = await verificarAcceso(citId, userId ?? '', rol)
  if (!cit) {
    res.status(404).json({ ok: false, error: { code: 'CIT_NO_ENCONTRADO',
      message: 'El CIT no existe o no tiene permiso para descargarlo' } })
    return
  }

  const esAdmin     = rol === 'admin'
  const esPropietario = cit.propietarioId === userId
  const esInspector   = cit.inspectorUserId === userId

  if (!esAdmin && !esPropietario && !esInspector) {
    res.status(403).json({ ok: false, error: { code: 'ACCESO_DENEGADO',
      message: 'Solo el propietario, inspector o admin pueden descargar este CIT' } })
    return
  }

  // 3. Buscar en caché Redis (si no se fuerza regeneración)
  if (!regenerar) {
    try {
      const cached = await getCached(citId)
      if (cached) {
        log.pdf.info({ citId, numeroCIT: cit.numeroCIT, fromCache: true,
          motor: cached.motor, bytes: cached.buffer.length }, '✓ PDF desde caché Redis')
        enviarPDF(res, cached.buffer, cit.numeroCIT, formato,
          cached.motor, Date.now() - t0, true)
        return
      }
    } catch (err) {
      log.pdf.warn({ err: (err as Error).message }, 'PDF cache read falló — generando de nuevo')
    }
  }

  // 4. Cargar datos completos del CIT
  const datos = await cargarCITParaPDF(citId)
  if (!datos) {
    res.status(404).json({ ok: false, error: { code: 'CIT_DATOS_INCOMPLETOS',
      message: 'No se pudieron cargar los datos del CIT' } })
    return
  }

  // 5. Generar PDF (Puppeteer → PDFKit fallback automático)
  log.pdf.info({ citId, numeroCIT: datos.numeroCIT,
    motor: browserPool.disponible ? 'PUPPETEER' : 'PDFKIT_FALLBACK' }, '⚙ Generando PDF CIT')

  const resultado = await generarPDFPuppeteer(datos)

  log.pdf.info({
    citId, numeroCIT: datos.numeroCIT,
    motor: resultado.motor, bytes: resultado.bytes, ms: resultado.duracionMs,
  }, `✓ PDF generado · ${resultado.motor}`)

  // 6. Guardar en caché Redis
  await setCache(citId, resultado.motor, resultado.buffer)

  // 7. Si es Puppeteer y no tiene IPFS → subir en background
  if (resultado.motor === 'PUPPETEER') {
    const citConIPFS = await queryOne<{ ipfs_pdf_cid: string | null }>(
      `SELECT ipfs_pdf_cid FROM cits WHERE id = $1`, [citId]
    )
    if (!citConIPFS?.ipfs_pdf_cid) {
      _subirIPFSBackground(citId, datos.numeroCIT, resultado.buffer)
        .catch(err => log.pdf.warn({ err: err.message }, 'PDF IPFS upload falló'))
    }
  }

  // 8. Responder
  enviarPDF(res, resultado.buffer, datos.numeroCIT, formato,
    resultado.motor, resultado.duracionMs, false)
}

async function _subirIPFSBackground(citId: string, numeroCIT: string, buffer: Buffer): Promise<void> {
  const { subirPDFCIT, buildTokenURI } = await import('../services/ipfs.service')
  const result = await subirPDFCIT(buffer, numeroCIT)
  await query(
    `UPDATE cits SET ipfs_pdf_cid=$2, token_uri=COALESCE(token_uri,$3), ipfs_subido_en=NOW() WHERE id=$1`,
    [citId, result.cid, buildTokenURI(result.cid)]
  )
  log.pdf.info({ citId, numeroCIT, cid: result.cid }, '✓ PDF subido a IPFS')
}

// ══════════════════════════════════════════════════════════
// HANDLER: GET /api/v1/cit/pdf/preview/:citId
// HTML puro para previsualizar en el navegador sin generar PDF
// ══════════════════════════════════════════════════════════

export async function getCITPdfPreview(req: AuthRequest, res: Response): Promise<void> {
  const { citId } = req.params

  if (!/^[0-9a-f-]{36}$/.test(citId)) {
    res.status(400).json({ ok: false, error: 'citId inválido' })
    return
  }

  const datos = await cargarCITParaPDF(citId)
  if (!datos) {
    res.status(404).json({ ok: false, error: 'CIT no encontrado' })
    return
  }

  const html = await getHTMLParaPreview(datos)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'private, max-age=300')
  res.send(html)
}

// ══════════════════════════════════════════════════════════
// HANDLER: DELETE /admin/cit/:citId/pdf/cache
// Invalida la caché del PDF (útil después de rectificar datos)
// ══════════════════════════════════════════════════════════

export async function deleteCITPdfCache(req: AuthRequest, res: Response): Promise<void> {
  const { citId } = req.params
  await invalidarCache(citId)
  res.json({ ok: true, data: { message: `Caché invalidada para CIT ${citId}` } })
}

// ══════════════════════════════════════════════════════════
// HANDLER: GET /admin/pdf/status
// Estado del BrowserPool y estadísticas de caché
// ══════════════════════════════════════════════════════════

export async function getPdfStatus(req: Request, res: Response): Promise<void> {
  const browserStatus = browserPool.status()

  // Contar PDFs en caché
  const redis = getRedis()
  let cachedPDFs = 0
  try {
    const keys = await redis.keys('pdf:cit:*')
    cachedPDFs = keys.length
  } catch { /* Redis no disponible */ }

  res.json({
    ok: true,
    data: {
      puppeteer: {
        ...browserStatus,
        ejecutable: browserStatus.rutaChrome ?? 'No encontrado — fallback a PDFKit',
        hint:       browserStatus.disponible ? null : 'apt-get install chromium-browser',
      },
      cache: {
        pdfsEnCache: cachedPDFs,
        ttlSegundos: CACHE_TTL_S,
        backend:     'Redis',
      },
      modos: {
        actual:   browserStatus.disponible ? 'PUPPETEER' : 'PDFKIT',
        fallback: 'PDFKIT',
      },
    },
  })
}
