// ─── RODAID · Sistema de errores del cliente ─────────────────────────────
//
// Clasifica cualquier error de la API (red, 4xx, 5xx, cancelación) en un
// `RodaidError` con un mensaje en español listo para mostrar, y resuelve la
// política de reintento con backoff exponencial.
//
// Adaptado al envoltorio de error real del backend RODAID, que devuelve
// `{ error: <CODIGO>, message: <texto> }` (ver `jsonError` en lib/marketplace.ts).
// También tolera el formato anidado `{ error: { code, message } }` por
// compatibilidad con material de referencia previo.

export type ErrorType =
  | 'NETWORK' // sin internet / DNS / timeout de fetch
  | 'CLIENT' // 4xx — error del usuario o de la solicitud
  | 'SERVER' // 5xx — error del servidor RODAID
  | 'STREAM' // corte de SSE / EventSource
  | 'CANCEL' // cancelado por el usuario (AbortController)
  | 'UNKNOWN'

export const ERROR_TYPE: Record<ErrorType, ErrorType> = {
  NETWORK: 'NETWORK',
  CLIENT: 'CLIENT',
  SERVER: 'SERVER',
  STREAM: 'STREAM',
  CANCEL: 'CANCEL',
  UNKNOWN: 'UNKNOWN',
}

interface MensajeError {
  titulo: string
  detalle: string | ((data: unknown) => string)
  accion?: string
  onAccion?: () => void
  retry: boolean
  retryMs?: number
}

const irAlLogin = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(TOKEN_KEY)
    window.localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* localStorage no disponible */
  }
  window.location.href = '/login'
}

// Mensajes específicos por código de error del backend. Incluye los códigos
// que la API RODAID emite hoy (AUTH_REQUIRED, INVALID_TOKEN, VALIDATION_ERROR,
// INVALID_QUERY, ADMIN_REQUIRED, INTERNAL_ERROR…) y los códigos de dominio
// previstos por el cliente de referencia.
const MENSAJES_ERROR: Record<string, MensajeError> = {
  // ── Autenticación ───────────────────────────────────────────────────────
  AUTH_REQUIRED: {
    titulo: 'Necesitás iniciar sesión',
    detalle: 'Esta acción requiere una sesión activa. Ingresá para continuar.',
    accion: 'Ir al login',
    onAccion: irAlLogin,
    retry: false,
  },
  INVALID_TOKEN: {
    titulo: 'Sesión inválida',
    detalle: 'Tu sesión no es válida o expiró. Volvé a iniciar sesión.',
    accion: 'Ir al login',
    onAccion: irAlLogin,
    retry: false,
  },
  TOKEN_EXPIRED: {
    titulo: 'Sesión expirada',
    detalle: 'Tu sesión venció. Ingresá de nuevo para continuar.',
    accion: 'Ir al login',
    onAccion: irAlLogin,
    retry: false,
  },
  ADMIN_REQUIRED: {
    titulo: 'Sin permisos de administrador',
    detalle: 'Esta operación solo está disponible para administradores.',
    retry: false,
  },
  ADMIN_NOT_CONFIGURED: {
    titulo: 'Administración no configurada',
    detalle: 'El servidor no tiene configurado el acceso administrativo.',
    retry: false,
  },
  AUTH_NOT_CONFIGURED: {
    titulo: 'Autenticación no configurada',
    detalle: 'El servidor no tiene configurada la autenticación.',
    retry: false,
  },

  // ── CIT ─────────────────────────────────────────────────────────────────
  CIT_NOT_FOUND: {
    titulo: 'CIT no encontrado',
    detalle: 'No existe un CIT con ese número o serie. Verificá el número RCIT-AAAA-NNNNN.',
    retry: false,
  },
  CIT_NO_ACTIVO: {
    titulo: 'CIT no activo',
    detalle: 'El CIT existe pero no está en estado ACTIVO.',
    retry: false,
  },
  CIT_YA_EXISTE: {
    titulo: 'La bicicleta ya tiene un CIT vigente',
    detalle: 'No se puede iniciar un nuevo CIT mientras exista uno activo.',
    retry: false,
  },

  // ── Validación de serie / inspección ─────────────────────────────────────
  VALIDACION_BLOQUEANTE: {
    titulo: 'La validación no pasó',
    detalle: 'Uno o más controles obligatorios fallaron. Revisá el detalle de la validación.',
    retry: false,
  },
  INSPECTOR_NO_HABILITADO: {
    titulo: 'Inspector no habilitado',
    detalle: 'Tu perfil de inspector no está certificado o su taller está deshabilitado.',
    retry: false,
  },

  // ── Marketplace ───────────────────────────────────────────────────────────
  DUPLICATE_LISTING: {
    titulo: 'Ya tenés una publicación activa para esta bicicleta',
    detalle: 'Solo se permite una publicación activa por bicicleta. Pausá o eliminá la existente.',
    retry: false,
  },
  INVALID_QUERY: {
    titulo: 'Búsqueda inválida',
    detalle: 'La búsqueda no contiene términos válidos. Probá con otras palabras.',
    retry: false,
  },

  // ── Pagos / escrow ────────────────────────────────────────────────────────
  MP_PAYMENT_FAILED: {
    titulo: 'El pago no pudo procesarse',
    detalle: 'MercadoPago rechazó el pago. Verificá el medio de pago e intentá de nuevo.',
    retry: true,
    retryMs: 3_000,
  },
  MP_CONNECT_FAILED: {
    titulo: 'No se pudo conectar con MercadoPago',
    detalle: 'Hubo un problema con la conexión a MercadoPago. Intentá de nuevo.',
    retry: true,
    retryMs: 5_000,
  },

  // ── Validación de datos (Zod / manual) ────────────────────────────────────
  VALIDATION_ERROR: {
    titulo: 'Datos inválidos',
    detalle: 'Algunos campos no tienen el formato correcto. Revisá el formulario.',
    retry: false,
  },

  // ── Servidor ──────────────────────────────────────────────────────────────
  INTERNAL_ERROR: {
    titulo: 'Error interno del servidor',
    detalle: 'Algo salió mal en el servidor RODAID. Ya estamos al tanto. Intentá en unos momentos.',
    retry: true,
    retryMs: 10_000,
  },
  SERVICE_UNAVAILABLE: {
    titulo: 'Servicio temporalmente no disponible',
    detalle: 'RODAID está realizando mantenimiento. Volvé en unos minutos.',
    retry: true,
    retryMs: 30_000,
  },
}

// Mensajes genéricos por código HTTP, usados cuando no hay un código específico.
const MENSAJES_HTTP: Record<number, MensajeError> = {
  400: { titulo: 'Datos incorrectos', detalle: 'Revisá los datos ingresados e intentá de nuevo.', retry: false },
  401: { titulo: 'No autenticado', detalle: 'Necesitás iniciar sesión para acceder a esta función.', retry: false },
  403: { titulo: 'Sin permiso', detalle: 'No tenés permiso para realizar esta acción.', retry: false },
  404: { titulo: 'No encontrado', detalle: 'El recurso que buscás no existe o fue eliminado.', retry: false },
  409: { titulo: 'Conflicto', detalle: 'Ya existe un registro similar. Verificá antes de crear uno nuevo.', retry: false },
  422: { titulo: 'Datos no procesables', detalle: 'Los datos enviados no pudieron procesarse.', retry: false },
  429: { titulo: 'Demasiadas solicitudes', detalle: 'Esperá un momento antes de volver a intentar.', retry: true, retryMs: 5_000 },
  500: { titulo: 'Error del servidor RODAID', detalle: 'El servidor tuvo un problema. Ya estamos trabajando en ello.', retry: true, retryMs: 10_000 },
  502: { titulo: 'Gateway caído', detalle: 'El servidor de RODAID no está respondiendo. Intentá en un momento.', retry: true, retryMs: 15_000 },
  503: { titulo: 'Servicio no disponible', detalle: 'RODAID está en mantenimiento. Volvé en unos minutos.', retry: true, retryMs: 30_000 },
  504: { titulo: 'Tiempo de espera agotado', detalle: 'El servidor tardó demasiado. Revisá tu conexión e intentá de nuevo.', retry: true, retryMs: 10_000 },
}

const MENSAJE_NETWORK: MensajeError = {
  titulo: 'Sin conexión',
  detalle: 'No podemos conectar con el servidor RODAID. Revisá tu conexión a internet.',
  retry: true,
  retryMs: 5_000,
}

function clasificarError(status: number | null, raw: unknown): ErrorType {
  if (isAbortError(raw)) return ERROR_TYPE.CANCEL
  if (status === null) {
    if (raw instanceof TypeError || mensajeIncluyeFetch(raw)) return ERROR_TYPE.NETWORK
    return ERROR_TYPE.UNKNOWN
  }
  if (status >= 400 && status < 500) return ERROR_TYPE.CLIENT
  if (status >= 500) return ERROR_TYPE.SERVER
  return ERROR_TYPE.UNKNOWN
}

function isAbortError(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as { name?: string }).name === 'AbortError'
}

function mensajeIncluyeFetch(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { message?: unknown }).message === 'string' &&
    (raw as { message: string }).message.toLowerCase().includes('fetch')
  )
}

// ─── RodaidError ─────────────────────────────────────────────────────────
// Extiende Error con la metadata necesaria para la UI: tipo, status, código,
// mensaje en español y política de reintento.
export class RodaidError extends Error {
  readonly tipo: ErrorType
  readonly status: number | null
  readonly code: string | null
  readonly mensaje: MensajeError
  readonly data: unknown
  retryCount: number

  constructor(message: string, status: number | null = null, code: string | null = null, data: unknown = null, raw: unknown = null) {
    super(message)
    this.name = 'RodaidError'
    this.status = status
    this.code = code
    this.data = data
    this.retryCount = 0
    this.tipo = clasificarError(status, raw)

    const porCodigo = code ? MENSAJES_ERROR[code] : undefined
    const porHttp = status ? MENSAJES_HTTP[status] : undefined
    const porRed = this.tipo === ERROR_TYPE.NETWORK ? MENSAJE_NETWORK : undefined

    this.mensaje =
      porCodigo ??
      porHttp ??
      porRed ?? {
        titulo: 'Error inesperado',
        detalle: message,
        retry: this.tipo === ERROR_TYPE.SERVER || this.tipo === ERROR_TYPE.NETWORK,
      }
  }

  get titulo(): string {
    return this.mensaje.titulo
  }

  get detalle(): string {
    const d = this.mensaje.detalle
    return typeof d === 'function' ? d(this.data) : d
  }

  get accion(): string | null {
    return this.mensaje.accion ?? null
  }

  ejecutarAccion(): void {
    this.mensaje.onAccion?.()
  }

  get puedeReintentar(): boolean {
    return this.mensaje.retry === true
  }

  get retryMs(): number {
    return this.mensaje.retryMs ?? 5_000
  }

  get esAuth(): boolean {
    return this.status === 401 || ['AUTH_REQUIRED', 'INVALID_TOKEN', 'TOKEN_EXPIRED'].includes(this.code ?? '')
  }

  get esRateLimit(): boolean {
    return this.status === 429 || this.code === 'RATE_LIMITED'
  }

  get esServidor(): boolean {
    return this.tipo === ERROR_TYPE.SERVER
  }

  get esRed(): boolean {
    return this.tipo === ERROR_TYPE.NETWORK
  }
}

interface CuerpoError {
  error?: string | { code?: string; message?: string }
  message?: string
}

function leerCodigoYMensaje(body: CuerpoError | null): { code: string | null; message: string | null } {
  if (!body) return { code: null, message: null }
  // Formato real del backend: { error: "<CODIGO>", message: "<texto>" }
  if (typeof body.error === 'string') {
    return { code: body.error, message: body.message ?? null }
  }
  // Formato anidado de referencia: { error: { code, message } }
  if (body.error && typeof body.error === 'object') {
    return { code: body.error.code ?? null, message: body.error.message ?? body.message ?? null }
  }
  return { code: null, message: body.message ?? null }
}

// ─── parseApiError ─────────────────────────────────────────────────────────
// Convierte cualquier error crudo (TypeError de red, AbortError, Response no-ok,
// o un objeto con `status`/`code`) en un `RodaidError`.
export async function parseApiError(err: unknown, response: Response | null = null): Promise<RodaidError> {
  if (err instanceof RodaidError) return err

  if (isAbortError(err)) {
    return new RodaidError('Cancelado por el usuario', null, 'CANCELLED', null, err)
  }

  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
    return new RodaidError(err.message, null, 'NETWORK_ERROR', null, err)
  }

  let body: CuerpoError | null = null
  if (response) {
    try {
      body = (await response.clone().json()) as CuerpoError
    } catch {
      /* respuesta sin cuerpo JSON */
    }
  } else if (err && typeof err === 'object' && 'data' in err) {
    body = (err as { data?: CuerpoError }).data ?? null
  }

  const { code, message } = leerCodigoYMensaje(body)
  const status =
    response?.status ??
    (err && typeof err === 'object' && typeof (err as { status?: number }).status === 'number'
      ? (err as { status: number }).status
      : null)
  const finalMessage =
    message ?? (err instanceof Error ? err.message : typeof err === 'string' ? err : 'Error desconocido')

  return new RodaidError(finalMessage, status, code, body, err)
}

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface ReintentoInfo {
  intento: number
  espera: number
  error: RodaidError
}

export interface FetchConErroresOpts {
  retries?: number
  onRetry?: (info: ReintentoInfo) => void
}

// ─── fetchConErrores ─────────────────────────────────────────────────────────
// Envoltorio de fetch que adjunta el Bearer token, parsea los errores como
// `RodaidError` y reintenta automáticamente, con backoff exponencial topeado en
// 30s, solo los errores de red y 5xx (y 429).
export async function fetchConErrores<T = unknown>(
  path: string,
  opts: RequestInit = {},
  { retries = 2, onRetry }: FetchConErroresOpts = {}
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((opts.headers as Record<string, string>) ?? {}),
  }

  let ultimo: RodaidError | null = null

  for (let intento = 0; intento <= retries; intento++) {
    let res: Response
    try {
      res = await fetch(`${API_BASE}${path}`, { ...opts, headers })
    } catch (networkErr) {
      const re = await parseApiError(networkErr)
      re.retryCount = intento
      ultimo = re
      if (intento < retries && re.puedeReintentar) {
        const espera = Math.min(re.retryMs * 2 ** intento, 30_000)
        onRetry?.({ intento, espera, error: re })
        await delay(espera)
        continue
      }
      throw re
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    }

    const err = await parseApiError(null, res)
    err.retryCount = intento
    ultimo = err

    if (err.puedeReintentar && intento < retries) {
      const espera = Math.min(err.retryMs * 2 ** intento, 30_000)
      onRetry?.({ intento, espera, error: err })
      await delay(espera)
      continue
    }

    throw err
  }

  throw ultimo ?? new RodaidError('Error desconocido')
}

const API_BASE = '/api/v1'
const TOKEN_KEY = 'rodaid_token'
const REFRESH_KEY = 'rodaid_refresh'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* localStorage no disponible */
  }
}
