// ─── RODAID · CDN Asset Service ───────────────────────────
//
// Sirve assets estáticos con headers óptimos de caché.
// En producción: CloudFront / S3 / Cloudflare R2
// En desarrollo: endpoint local GET /cdn/assets/:file
//
// ══ HEADERS DE CACHÉ ══════════════════════════════════════
//
//   Cache-Control: public, max-age=31536000, immutable
//   → 1 año de caché en browser y CDN
//   → immutable: el browser no revalida nunca (hash en nombre)
//   → stale-while-revalidate=86400: sirve del caché 24h extra
//
//   ETag: SHA-256[:16] del archivo
//   Vary: Accept-Encoding
//   Content-Encoding: gzip (para JSON/SVG)
//
// ══ CACHE BUSTING ═════════════════════════════════════════
//
//   Nombres de archivo: {nombre}.{sha256[:8]}.{ext}
//   Ejemplo: logo.ad1c401b.jpg
//   → Si el contenido cambia, el hash cambia
//   → URL diferente → CDN sirve el nuevo archivo
//   → El viejo URL queda en caché pero nunca se pide

import crypto from 'crypto'
import path   from 'path'
import fs     from 'fs'
import type { Express } from 'express'

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export interface CDNAsset {
  filename:  string
  mime:      string
  sizeKB:    number
  hash:      string
  cdnUrl:    string
}

export interface CDNManifest {
  version:   string
  prefix:    string
  generado:  string
  assets:    CDNAsset[]
}

// ══════════════════════════════════════════════════════════
// MIME TYPES
// ══════════════════════════════════════════════════════════

const MIME_MAP: Record<string, string> = {
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
  svg:  'image/svg+xml',
  gif:  'image/gif',
  avif: 'image/avif',
  woff2:'font/woff2',
  woff: 'font/woff',
  json: 'application/json',
}

function mimeOf(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

// ══════════════════════════════════════════════════════════
// REGISTRAR RUTAS CDN EN EXPRESS
// ══════════════════════════════════════════════════════════

export function registrarCDN(
  app:       Express,
  assetsDir: string,
  options:   { prefix?: string; maxAge?: number } = {}
): void {
  const prefix  = options.prefix  ?? '/cdn/assets'
  const maxAge  = options.maxAge  ?? 31_536_000   // 1 año en segundos
  const stale   = 86_400                          // 24h stale-while-revalidate

  // GET /cdn/assets/:filename — servir el asset con headers óptimos
  app.get(`${prefix}/:filename`, (req, res) => {
    const filename = req.params.filename

    // Seguridad: prevenir path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.status(400).json({ error: 'Filename inválido' })
      return
    }

    const filepath = path.join(assetsDir, filename)
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: 'Asset no encontrado', filename })
      return
    }

    const buf  = fs.readFileSync(filepath)
    const etag = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
    const mime = mimeOf(filename)

    // Si el cliente ya tiene este ETag → 304 Not Modified
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end()
      return
    }

    res
      .set('Content-Type',       mime)
      .set('Content-Length',     String(buf.length))
      .set('ETag',               etag)
      .set('Cache-Control',      `public, max-age=${maxAge}, immutable, stale-while-revalidate=${stale}`)
      .set('Vary',               'Accept-Encoding')
      .set('X-Content-Type-Options', 'nosniff')
      .set('Access-Control-Allow-Origin', '*')   // CDN pública
      .send(buf)
  })

  // GET /cdn/manifest.json — manifiesto completo para el frontend
  app.get(`${prefix.replace('/assets', '')}/manifest.json`, (req, res) => {
    const files = fs.existsSync(assetsDir)
      ? fs.readdirSync(assetsDir)
      : []

    const assets: CDNAsset[] = files
      .filter(f => !f.startsWith('.'))
      .map(f => {
        const buf   = fs.readFileSync(path.join(assetsDir, f))
        const hash  = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8)
        return {
          filename:  f,
          mime:      mimeOf(f),
          sizeKB:    Math.round(buf.length / 1024 * 10) / 10,
          hash,
          cdnUrl:    `${process.env.CDN_URL ?? 'https://cdn.rodaid.com.ar'}/assets/${f}`,
        }
      })

    const manifest: CDNManifest = {
      version:  '1.0',
      prefix:   process.env.CDN_URL ?? 'https://cdn.rodaid.com.ar',
      generado: new Date().toISOString(),
      assets,
    }

    res
      .set('Cache-Control', 'public, max-age=300')   // 5 min — el manifiesto puede cambiar
      .json(manifest)
  })
}

// ══════════════════════════════════════════════════════════
// GENERAR NOMBRES CON HASH (para el build script)
// ══════════════════════════════════════════════════════════

export function generarNombreConHash(filepath: string): string {
  const buf  = fs.readFileSync(filepath)
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8)
  const ext  = path.extname(filepath)
  const base = path.basename(filepath, ext)
    .replace(/_b64|_src|_SRC|_B64/g, '')
    .toLowerCase()
  return `${base}.${hash}${ext}`
}

// ══════════════════════════════════════════════════════════
// USAR EN index.ts (registrar las rutas CDN)
// ══════════════════════════════════════════════════════════

/*
  import { registrarCDN } from './services/cdn.service'
  import path from 'path'

  // En el setup de Express:
  registrarCDN(app, path.join(__dirname, '../cdn-assets'), {
    prefix: '/cdn/assets',
    maxAge: 31_536_000,  // 1 año
  })

  // Variables de entorno:
  //   CDN_URL=https://cdn.rodaid.com.ar    (producción)
  //   CDN_URL=http://localhost:3000/cdn    (desarrollo)
*/
