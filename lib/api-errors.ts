/**
 * Capa de manejo de errores de la API de RODAID (lado cliente).
 *
 * El backend de publicacion ya valida las reglas de negocio y responde con
 * codigos HTTP precisos (400, 403, 409, ...). Esta capa traduce esas respuestas
 * a mensajes claros y amigables en espanol, para que la UI los muestre de forma
 * no intrusiva (Toast / alerta) sin filtrar jerga tecnica al usuario.
 *
 * Pensada como un "interceptor" liviano: se envuelve la lectura de cualquier
 * Response fallida y se obtiene un objeto normalizado `{ status, code, message }`
 * con un mensaje listo para mostrar.
 */

export interface ApiErrorInfo {
  /** Codigo HTTP de la respuesta. */
  status: number
  /** Codigo de error estable del backend (p. ej. 'CIT_NOT_ACTIVE'), si vino. */
  code: string | null
  /** Mensaje amigable, ya traducido, listo para mostrar al usuario. */
  message: string
  /** Mensaje crudo del backend (util para depurar o como detalle secundario). */
  rawMessage: string | null
}

interface ApiErrorPayload {
  error?: unknown
  message?: unknown
}

/**
 * Mensajes por defecto del flujo de publicacion, segun el codigo HTTP.
 * Son los pedidos por el producto: 403 / 409 / 400 con texto amigable.
 */
const MENSAJES_PUBLICAR: Record<number, string> = {
  400: 'Revisá los datos ingresados (precio, descripción).',
  401: 'Tu sesión expiró. Recargá la página e intentá de nuevo.',
  403: 'Tu bicicleta no está verificada o no te pertenece.',
  404: 'No encontramos la bicicleta seleccionada.',
  409: 'Esta bicicleta ya tiene una publicación activa.',
  413: 'La foto es demasiado grande. Usá una imagen de hasta 8 MB.',
  415: 'El formato de la foto no es válido. Usá JPG, PNG, WEBP o AVIF.',
}

/**
 * Algunos codigos del backend ameritan un texto mas especifico que el generico
 * por status (p. ej. distinguir "no sos el dueno" de "CIT vencido", ambos 403).
 */
const MENSAJES_POR_CODIGO: Record<string, string> = {
  CIT_NOT_ACTIVE: 'Tu bicicleta no está verificada con un CIT activo.',
  CIT_EXPIRED: 'El CIT de tu bicicleta está vencido. Solicitá una nueva verificación.',
  NOT_OWNER: 'Esta bicicleta no te pertenece.',
  DUPLICATE_LISTING: 'Esta bicicleta ya tiene una publicación activa.',
  NUMERO_SERIE_DUPLICADO: 'Ya existe una bicicleta registrada con ese número de serie.',
  TIPO_NO_SOPORTADO: 'El formato de la foto no es válido. Usá JPG, PNG, WEBP o AVIF.',
  FOTO_DEMASIADO_GRANDE: 'La foto es demasiado grande. Usá una imagen de hasta 8 MB.',
}

const MENSAJE_GENERICO =
  'No pudimos completar la operación. Probá de nuevo en unos instantes.'

/**
 * Lee una Response fallida y devuelve la informacion de error normalizada y
 * traducida. Usa, en orden de prioridad: el mensaje por codigo del backend, el
 * mensaje por status del flujo, y un generico como ultimo recurso.
 *
 * `mensajesPorStatus` permite a cada pantalla afinar los textos (por defecto
 * usa los del flujo de publicacion).
 */
export async function parseApiError(
  res: Response,
  mensajesPorStatus: Record<number, string> = MENSAJES_PUBLICAR
): Promise<ApiErrorInfo> {
  let payload: ApiErrorPayload = {}
  try {
    payload = (await res.json()) as ApiErrorPayload
  } catch {
    // El cuerpo no era JSON (p. ej. un 500 con HTML). Seguimos con lo que haya.
  }

  const code = typeof payload.error === 'string' ? payload.error : null
  const rawMessage =
    typeof payload.message === 'string' ? payload.message : null

  const message =
    (code && MENSAJES_POR_CODIGO[code]) ||
    mensajesPorStatus[res.status] ||
    (res.status >= 500
      ? 'Tuvimos un problema de nuestro lado. Probá de nuevo en unos minutos.'
      : rawMessage) ||
    MENSAJE_GENERICO

  return { status: res.status, code, message, rawMessage }
}

export { MENSAJES_PUBLICAR }
