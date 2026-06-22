// ─── RODAID · S3 Upload Service ───────────────────────────
// Gestiona el almacenamiento de fotos del proceso de inspección
// CIT en AWS S3 (o compatible: MinIO, Tigris, Cloudflare R2).
//
// Estructura de keys en S3:
//   cit-fotos/{citId}/{tipo}-{posicion}-{timestamp}.{ext}
//   -- Ej: cit-fotos/eeee-../serie-1-1748975553.jpg
//
// Modo LIVE (con credenciales AWS):
//   · Upload multipart para archivos > 5 MB
//   · Presigned URL para upload directo desde el cliente (opcional)
//   · ACL privada — acceso vía CloudFront o presigned GET
//
// Modo STUB (sin AWS_ACCESS_KEY_ID):
//   · Simula el upload, genera URL falsa
//   · Guarda referencia en DB igual que en modo LIVE
//   · Permite tests sin S3 real
//
// Variables de entorno:
//   AWS_ACCESS_KEY_ID        — IAM key con s3:PutObject + s3:GetObject
//   AWS_SECRET_ACCESS_KEY
//   AWS_REGION               — default: us-east-1
//   S3_BUCKET_FOTOS          — nombre del bucket (default: rodaid-fotos)
//   S3_CDN_URL               — CloudFront URL (opcional, para URLs públicas)
//   S3_ENDPOINT              — para compatibles S3 (MinIO, Tigris, R2)

import { createHash }          from 'crypto'
import { query, queryOne }     from '../config/database'
import { log }                 from '../middleware/logger'
import { env }                 from '../config/env'

// ══════════════════════════════════════════════════════════
// MODO DE OPERACIÓN
// ══════════════════════════════════════════════════════════

const MODO_LIVE   = !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
const BUCKET      = env.S3_BUCKET_FOTOS ?? 'rodaid-fotos'
const CDN_URL     = env.S3_CDN_URL ?? ''
const AWS_REGION  = env.AWS_REGION  ?? 'us-east-1'
const MAX_TAM_MB  = 10                    // máximo 10 MB por foto
const MAX_TAM     = MAX_TAM_MB * 1024 * 1024

const MIME_TIPOS_PERMITIDOS = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
]

// ══════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════

export type TipoFoto = 'serie' | 'cuadro' | 'componentes' | 'inspeccion' | 'firma' | 'general'

export interface ArchivoFoto {
  buffer:   Buffer
  mimetype: string
  size:     number
  originalname: string
}

export interface FotoSubida {
  fotoId:     string
  s3Key:      string
  url:        string
  tipo:       TipoFoto
  posicion:   number
  tamBytes:   number
  hashSHA256: string
  stub:       boolean
}

// ══════════════════════════════════════════════════════════
// VALIDACIÓN
// ══════════════════════════════════════════════════════════

export function validarFoto(archivo: ArchivoFoto): void {
  if (!MIME_TIPOS_PERMITIDOS.includes(archivo.mimetype)) {
    throw Object.assign(
      new Error(`Tipo de archivo no permitido: ${archivo.mimetype}. Usar JPEG, PNG o WebP.`),
      { code: 'FOTO_TIPO_INVALIDO', status: 422 }
    )
  }
  if (archivo.size > MAX_TAM) {
    throw Object.assign(
      new Error(`Foto demasiado grande: ${(archivo.size / 1024 / 1024).toFixed(1)} MB. Máximo ${MAX_TAM_MB} MB.`),
      { code: 'FOTO_DEMASIADO_GRANDE', status: 422 }
    )
  }
  if (archivo.size === 0) {
    throw Object.assign(
      new Error('Foto vacía — archivo sin contenido.'),
      { code: 'FOTO_VACIA', status: 422 }
    )
  }
}

// ══════════════════════════════════════════════════════════
// UPLOAD A S3
// ══════════════════════════════════════════════════════════

/**
 * Subir una foto al bucket S3 y registrarla en DB.
 */
export async function subirFotoCIT(opts: {
  citId:       string
  archivo:     ArchivoFoto
  tipo:        TipoFoto
  posicion:    number
  inspectorId?: string
}): Promise<FotoSubida> {

  validarFoto(opts.archivo)

  // Calcular hash para deduplicación
  const hashSHA256 = createHash('sha256').update(opts.archivo.buffer).digest('hex')

  // Verificar si ya existe la misma foto (por hash)
  const existente = await queryOne<{ id: string; s3_key: string; url_publica: string }>(
    `SELECT id, s3_key, url_publica FROM cit_fotos
     WHERE cit_id=$1 AND hash_sha256=$2 LIMIT 1`,
    [opts.citId, hashSHA256]
  )
  if (existente) {
    log.cit.info({ citId: opts.citId, hash: hashSHA256.slice(0, 8) }, 'Foto ya existente — retornando existente')
    return {
      fotoId:     existente.id,
      s3Key:      existente.s3_key,
      url:        existente.url_publica,
      tipo:       opts.tipo,
      posicion:   opts.posicion,
      tamBytes:   opts.archivo.size,
      hashSHA256,
      stub:       false,
    }
  }

  // Generar key S3
  const ext    = extFromMime(opts.archivo.mimetype)
  const ts     = Date.now()
  const s3Key  = `cit-fotos/${opts.citId}/${opts.tipo}-${opts.posicion}-${ts}${ext}`

  if (!MODO_LIVE) {
    // STUB: simular upload
    const urlStub = `https://stub-s3.rodaid.com.ar/${s3Key}`
    log.cit.warn({ citId: opts.citId, tipo: opts.tipo, s3Key },
      '⚠ S3 STUB — configurar AWS_ACCESS_KEY_ID para uploads reales')

    const row = await queryOne<{ id: string }>(
      `INSERT INTO cit_fotos
         (cit_id, inspector_id, s3_key, s3_bucket, url_publica, tipo, posicion, mime_type, tam_bytes, hash_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING RETURNING id`,
      [opts.citId, opts.inspectorId ?? null, s3Key, BUCKET, urlStub,
       opts.tipo, opts.posicion, opts.archivo.mimetype, opts.archivo.size, hashSHA256]
    )

    return {
      fotoId:     row?.id ?? 'stub-' + ts,
      s3Key,
      url:        urlStub,
      tipo:       opts.tipo,
      posicion:   opts.posicion,
      tamBytes:   opts.archivo.size,
      hashSHA256,
      stub:       true,
    }
  }

  // LIVE: upload real a S3
  const { Upload } = await import('@aws-sdk/lib-storage')
  const { S3Client } = await import('@aws-sdk/client-s3')

  const s3 = new S3Client({
    region:      AWS_REGION,
    credentials: {
      accessKeyId:     env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  })

  const upload = new Upload({
    client:  s3,
    params: {
      Bucket:      BUCKET,
      Key:         s3Key,
      Body:        opts.archivo.buffer,
      ContentType: opts.archivo.mimetype,
      Metadata: {
        citId:       opts.citId,
        tipo:        opts.tipo,
        inspectorId: opts.inspectorId ?? '',
        sha256:      hashSHA256,
      },
    },
  })

  await upload.done()

  // URL pública: CloudFront o S3
  const url = CDN_URL
    ? `${CDN_URL}/${s3Key}`
    : `https://${BUCKET}.s3.${AWS_REGION}.amazonaws.com/${s3Key}`

  // Persistir en DB
  const row = await queryOne<{ id: string }>(
    `INSERT INTO cit_fotos
       (cit_id, inspector_id, s3_key, s3_bucket, url_publica, tipo, posicion, mime_type, tam_bytes, hash_sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [opts.citId, opts.inspectorId ?? null, s3Key, BUCKET, url,
     opts.tipo, opts.posicion, opts.archivo.mimetype, opts.archivo.size, hashSHA256]
  )

  log.cit.info({
    citId:   opts.citId,
    tipo:    opts.tipo,
    s3Key,
    tamKB:   Math.round(opts.archivo.size / 1024),
  }, `📸 Foto subida a S3: ${opts.tipo}-${opts.posicion}`)

  return {
    fotoId:     row!.id,
    s3Key,
    url,
    tipo:       opts.tipo,
    posicion:   opts.posicion,
    tamBytes:   opts.archivo.size,
    hashSHA256,
    stub:       false,
  }
}

/**
 * Subir múltiples fotos en paralelo (máx. 3 concurrentes).
 */
export async function subirFotosCIT(opts: {
  citId:        string
  archivos:     Array<{ archivo: ArchivoFoto; tipo: TipoFoto }>
  inspectorId?: string
  maxConcurrencia?: number
}): Promise<FotoSubida[]> {
  if (opts.archivos.length === 0) return []
  if (opts.archivos.length > 10) {
    throw Object.assign(
      new Error('Máximo 10 fotos por inspección'),
      { code: 'DEMASIADAS_FOTOS', status: 422 }
    )
  }

  const concurrencia = opts.maxConcurrencia ?? 3
  const resultados: FotoSubida[] = []

  for (let i = 0; i < opts.archivos.length; i += concurrencia) {
    const lote = opts.archivos.slice(i, i + concurrencia)
    const parciales = await Promise.all(
      lote.map((a, j) =>
        subirFotoCIT({
          citId:       opts.citId,
          archivo:     a.archivo,
          tipo:        a.tipo,
          posicion:    i + j + 1,
          inspectorId: opts.inspectorId,
        })
      )
    )
    resultados.push(...parciales)
  }

  return resultados
}

// ══════════════════════════════════════════════════════════
// PRESIGNED URL (upload directo desde el cliente)
// ══════════════════════════════════════════════════════════

/**
 * Generar presigned URL para upload directo desde el browser.
 * El cliente sube directamente a S3 sin pasar por el servidor.
 */
export async function generarPresignedUpload(opts: {
  citId:    string
  tipo:     TipoFoto
  posicion: number
  mimetype: string
  ttlSeg?:  number  // TTL de la URL (default 10 minutos)
}): Promise<{ url: string; s3Key: string; expiresAt: Date }> {

  if (!MIME_TIPOS_PERMITIDOS.includes(opts.mimetype)) {
    throw Object.assign(
      new Error(`Tipo no permitido: ${opts.mimetype}`),
      { code: 'FOTO_TIPO_INVALIDO', status: 422 }
    )
  }

  const ext    = extFromMime(opts.mimetype)
  const s3Key  = `cit-fotos/${opts.citId}/${opts.tipo}-${opts.posicion}-${Date.now()}${ext}`
  const ttl    = opts.ttlSeg ?? 600

  if (!MODO_LIVE) {
    const expiresAt = new Date(Date.now() + ttl * 1000)
    return {
      url:       `https://stub-s3.rodaid.com.ar/upload?key=${encodeURIComponent(s3Key)}&stub=1`,
      s3Key,
      expiresAt,
    }
  }

  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

  const s3 = new S3Client({
    region:      AWS_REGION,
    credentials: {
      accessKeyId:     env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  })

  const cmd = new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         s3Key,
    ContentType: opts.mimetype,
    Metadata: { citId: opts.citId, tipo: opts.tipo },
  })

  const url       = await getSignedUrl(s3, cmd, { expiresIn: ttl })
  const expiresAt = new Date(Date.now() + ttl * 1000)

  return { url, s3Key, expiresAt }
}

/**
 * Confirmar que el cliente subió una foto directamente a S3.
 * Llamar después de que el cliente completa el presigned upload.
 */
export async function confirmarPresignedFoto(opts: {
  citId:       string
  s3Key:       string
  tipo:        TipoFoto
  posicion:    number
  inspectorId?: string
  tamBytes?:   number
  mimetype?:   string
}): Promise<{ fotoId: string; url: string }> {
  const url = CDN_URL
    ? `${CDN_URL}/${opts.s3Key}`
    : `https://${BUCKET}.s3.${AWS_REGION}.amazonaws.com/${opts.s3Key}`

  const row = await queryOne<{ id: string }>(
    `INSERT INTO cit_fotos
       (cit_id, inspector_id, s3_key, s3_bucket, url_publica, tipo, posicion, mime_type, tam_bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT DO NOTHING RETURNING id`,
    [opts.citId, opts.inspectorId ?? null, opts.s3Key, BUCKET, url,
     opts.tipo, opts.posicion, opts.mimetype ?? 'image/jpeg', opts.tamBytes ?? 0]
  )

  return { fotoId: row?.id ?? 'confirmed-' + Date.now(), url }
}

// ══════════════════════════════════════════════════════════
// LISTAR Y ELIMINAR
// ══════════════════════════════════════════════════════════

export async function getFotosCIT(citId: string) {
  return query<{
    id: string; tipo: string; posicion: number; url_publica: string
    mime_type: string; tam_bytes: number; creado_en: Date
  }>(
    `SELECT id, tipo, posicion, url_publica, mime_type, tam_bytes, creado_en
     FROM cit_fotos WHERE cit_id=$1 ORDER BY posicion`,
    [citId]
  )
}

export async function eliminarFotoCIT(fotoId: string, citId: string): Promise<boolean> {
  // Obtener key S3 antes de eliminar el registro
  const foto = await queryOne<{ s3_key: string }>(
    `SELECT s3_key FROM cit_fotos WHERE id=$1 AND cit_id=$2`, [fotoId, citId]
  )
  if (!foto) return false

  if (MODO_LIVE) {
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId:     env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
    })
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: foto.s3_key })).catch(() => {})
  }

  await query(`DELETE FROM cit_fotos WHERE id=$1`, [fotoId])
  return true
}

// ── Stats ────────────────────────────────────────────────
export async function getEstadisticasFotos(dias = 30): Promise<{
  totalFotos: number; totalMB: number; modo: string
}> {
  const row = await queryOne<{ count: string; bytes: string }>(
    `SELECT COUNT(*)::text AS count, COALESCE(SUM(tam_bytes),0)::text AS bytes
     FROM cit_fotos WHERE creado_en > NOW()-($1||' days')::interval`, [dias]
  )
  return {
    totalFotos: parseInt(row?.count ?? '0'),
    totalMB:    Math.round(parseInt(row?.bytes ?? '0') / 1024 / 1024 * 100) / 100,
    modo:       MODO_LIVE ? 'LIVE' : 'STUB',
  }
}

export function getModoS3(): 'LIVE' | 'STUB' { return MODO_LIVE ? 'LIVE' : 'STUB' }

// ── Helper ───────────────────────────────────────────────
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg':  '.jpg',
    'image/png':  '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
  }
  return map[mime] ?? '.jpg'
}

// ══════════════════════════════════════════════════════════
// VINCULAR FOTOS (uploadIds) AL CIT — POST-UPLOAD
// ══════════════════════════════════════════════════════════

/**
 * Vincula los uploadIds pre-subidos al CIT y registra en cit_fotos.
 * Se llama desde POST /inspector/cit después de que el inspector
 * sube las fotos vía presigned URL o multipart.
 */
export async function vincularFotosACIT(opts: {
  citId:       string
  inspectorId: string
  uploadIds:   string[]     // IDs de cit_fotos ya registradas vía subirFotoCIT
}): Promise<Array<{ id: string; url: string; posicion: number }>> {
  if (opts.uploadIds.length === 0) return []
  if (opts.uploadIds.length > 10) {
    throw Object.assign(new Error('Máximo 10 fotos por CIT'), { code: 'TOO_MANY_PHOTOS', status: 400 })
  }

  // Las fotos ya están en cit_fotos sin cit_id (subidas como "pending")
  // Vincularlas al CIT
  await query(
    `UPDATE cit_fotos SET cit_id=$1, posicion=(row_number() OVER (ORDER BY creado_en) - 1)
     WHERE id = ANY($2::uuid[]) AND cit_id IS NULL`,
    [opts.citId, opts.uploadIds]
  )

  // Actualizar fotos_count en cits
  const fotos = await query<{ id: string; url_publica: string; posicion: number }>(
    `SELECT id, url_publica, posicion FROM cit_fotos WHERE cit_id=$1 ORDER BY posicion`,
    [opts.citId]
  )
  await query(`UPDATE cits SET fotos_count=$2, actualizado_en=NOW() WHERE id=$1`,
    [opts.citId, fotos.length])

  log.firma.info({ citId: opts.citId.slice(0, 8), count: fotos.length },
    `✓ ${fotos.length} fotos vinculadas al CIT`)
  return fotos.map(f => ({ id: f.id, url: f.url_publica, posicion: f.posicion }))
}
