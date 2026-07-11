import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'

/**
 * RODAID — Servicio de almacenamiento de objetos (Netlify Blobs).
 *
 * Las fotos de las bicicletas son datos no estructurados (binarios), por lo que
 * viven en Netlify Blobs y no en la base relacional. Este servicio sube la foto,
 * la guarda con una clave estable y devuelve la URL publica con la que se sirve,
 * lista para persistir en `bicicletas.foto_url`.
 *
 * Las imagenes se exponen a traves de la ruta `GET /api/v1/marketplace/fotos/[...key]`,
 * que lee el blob por su clave. El `content-type` se deriva de la extension de la
 * clave (no se guardan metadatos en el blob).
 */

// Nombre del store de Netlify Blobs para las fotos de las bicicletas.
const STORE_FOTOS = 'rodaid-bicicletas-fotos'

// Tamano maximo aceptado para una foto (8 MB).
const MAX_BYTES = 8 * 1024 * 1024

// Tipos de imagen aceptados y su extension de archivo.
const EXTENSION_POR_TIPO: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

// Mapa inverso: extension -> content-type, usado al servir la foto.
const TIPO_POR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
}

/** Error de almacenamiento con un codigo estable para mapear a la respuesta HTTP. */
export class StorageError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export interface FotoSubida {
  /** Clave del blob (incluye el prefijo `bicicletas/<id>/`). */
  key: string
  /** URL publica servible, para guardar en `bicicletas.foto_url`. */
  url: string
  /** Content-type con el que se almaceno la foto. */
  contentType: string
  /** Tamano de la foto en bytes. */
  bytes: number
}

function getFotosStore() {
  return getStore(STORE_FOTOS)
}

/**
 * Construye la URL publica servible para una clave de blob. Si `RODAID_BASE_URL`
 * esta definida devuelve una URL absoluta; si no, una ruta relativa (que el
 * navegador resuelve igual contra el mismo host).
 */
export function urlPublicaFoto(key: string): string {
  const path = `/api/v1/marketplace/fotos/${key}`
  const base = process.env.RODAID_BASE_URL?.replace(/\/+$/, '')
  return base ? `${base}${path}` : path
}

/** Deriva el content-type de una clave a partir de su extension. */
export function contentTypeDeKey(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase() ?? ''
  return TIPO_POR_EXTENSION[extension] ?? 'application/octet-stream'
}

/**
 * Sube la foto de una bicicleta a Netlify Blobs y devuelve la URL publica para
 * guardar en `bicicletas.foto_url`.
 *
 * Valida el tipo (solo imagenes) y el tamano antes de escribir.
 */
export async function subirFotoBicicleta(
  bicicletaId: string,
  file: Blob
): Promise<FotoSubida> {
  const contentType = file.type || 'application/octet-stream'
  const extension = EXTENSION_POR_TIPO[contentType]
  if (!extension) {
    throw new StorageError(
      'TIPO_NO_SOPORTADO',
      'La foto debe ser una imagen JPEG, PNG, WEBP o AVIF.'
    )
  }
  if (file.size === 0) {
    throw new StorageError('FOTO_VACIA', 'La foto recibida esta vacia.')
  }
  if (file.size > MAX_BYTES) {
    throw new StorageError(
      'FOTO_DEMASIADO_GRANDE',
      'La foto no puede superar los 8 MB.'
    )
  }

  const key = `bicicletas/${bicicletaId}/${randomUUID()}.${extension}`
  const buffer = await file.arrayBuffer()

  const store = getFotosStore()
  await store.set(key, buffer)

  return { key, url: urlPublicaFoto(key), contentType, bytes: file.size }
}

/**
 * Lee una foto previamente subida. La consume la ruta publica que sirve las
 * imagenes. Devuelve `null` si la clave no existe.
 */
export async function leerFotoBicicleta(
  key: string
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const store = getFotosStore()
  const data = await store.get(key, { type: 'arrayBuffer' })
  if (data === null) {
    return null
  }
  return { data, contentType: contentTypeDeKey(key) }
}

// Nombre del store de Netlify Blobs para las imagenes de portada de noticias.
const STORE_NOTICIAS_IMAGENES = 'rodaid-noticias-imagenes'

function getNoticiasImagenesStore() {
  return getStore(STORE_NOTICIAS_IMAGENES)
}

export function urlPublicaImagenNoticia(key: string): string {
  const path = `/api/v1/admin/noticias/imagenes/${key}`
  const base = process.env.RODAID_BASE_URL?.replace(/\/+$/, '')
  return base ? `${base}${path}` : path
}

/** Sube la imagen de portada de una noticia. Mismas reglas que subirFotoBicicleta. */
export async function subirImagenNoticia(file: Blob): Promise<FotoSubida> {
  const contentType = file.type || 'application/octet-stream'
  const extension = EXTENSION_POR_TIPO[contentType]
  if (!extension) {
    throw new StorageError(
      'TIPO_NO_SOPORTADO',
      'La imagen debe ser JPEG, PNG, WEBP o AVIF.'
    )
  }
  if (file.size === 0) {
    throw new StorageError('IMAGEN_VACIA', 'La imagen recibida esta vacia.')
  }
  if (file.size > MAX_BYTES) {
    throw new StorageError(
      'IMAGEN_DEMASIADO_GRANDE',
      'La imagen no puede superar los 8 MB.'
    )
  }

  const key = `noticias/${randomUUID()}.${extension}`
  const buffer = await file.arrayBuffer()

  const store = getNoticiasImagenesStore()
  await store.set(key, buffer)

  return { key, url: urlPublicaImagenNoticia(key), contentType, bytes: file.size }
}

/**
 * Lee una imagen de noticia previamente subida. La consume la ruta publica que
 * sirve las imagenes. Devuelve `null` si la clave no existe.
 */
export async function leerImagenNoticia(
  key: string
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const store = getNoticiasImagenesStore()
  const data = await store.get(key, { type: 'arrayBuffer' })
  if (data === null) {
    return null
  }
  return { data, contentType: contentTypeDeKey(key) }
}
