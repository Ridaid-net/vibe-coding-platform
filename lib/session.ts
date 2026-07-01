'use client'

/**
 * Sesion de usuario de RODAID (cliente).
 *
 * Hito 1 — Autenticacion Definitiva. La sesion guarda un AccessToken corto y un
 * RefreshToken largo. `authedFetch` adjunta el AccessToken y, ante un 401, lo
 * renueva con el RefreshToken (`/api/v1/auth/refresh`) de forma transparente. Si
 * el RefreshToken es invalido o expiro, se descarta la sesion y el usuario debe
 * autenticarse nuevamente.
 *
 * En los entornos de preview (sin pagos reales) y mientras no haya una pantalla
 * de login, `ensureSession` arranca una sesion demo real contra
 * `/api/v1/auth/demo-session` (que ahora crea un usuario persistido). Para una
 * cuenta real se usan `login` / `register`.
 */

export interface RodaidSession {
  /** AccessToken (Bearer). Se renueva con el RefreshToken. */
  token: string
  accessToken: string
  refreshToken: string | null
  userId: string
  nombre: string
  /** Rol del usuario (ciclista/inspector/aliado/admin), si se conoce. */
  rol: string | null
}

const STORAGE_KEY = 'rodaid.session.v2'

/**
 * Evento de cambio de sesión (mismo tab). El `storage` event del navegador solo
 * se dispara entre pestañas; este evento permite que `useAuth` reaccione en la
 * misma pestaña tras login/logout/refresh.
 */
export const SESSION_EVENT = 'rodaid:session-change'

/**
 * Nombre de la cookie que refleja el AccessToken. La usa la Edge Function
 * `auth-admin` para validar la sesión en las NAVEGACIONES de página (donde no
 * viaja el header Authorization, que solo adjunta `authedFetch` en las XHR).
 *
 * Seguridad: el token también vive en localStorage; espejarlo a una cookie no
 * añade exposición (mismo modelo de confianza del cliente) y el control de
 * acceso real lo hace el borde validando la FIRMA del JWT. La cookie no es
 * httpOnly porque debe escribirse desde el cliente; lleva SameSite=Lax.
 */
const NF_JWT_COOKIE = 'nf_jwt'

function setJwtCookie(token: string) {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${NF_JWT_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=86400; SameSite=Lax${secure}`
}

function clearJwtCookie() {
  if (typeof document === 'undefined') return
  document.cookie = `${NF_JWT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}

function notifySessionChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SESSION_EVENT))
}

interface StoredSession {
  accessToken: string
  refreshToken: string | null
  userId: string
  nombre: string
  rol: string | null
}

function read(): StoredSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredSession>
    if (parsed?.accessToken && parsed?.userId) {
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken ?? null,
        userId: parsed.userId,
        nombre: parsed.nombre ?? 'Usuario',
        rol: parsed.rol ?? null,
      }
    }
  } catch {
    // Sesion corrupta: se descarta.
  }
  return null
}

function write(session: StoredSession) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  setJwtCookie(session.accessToken)
  notifySessionChange()
}

function toSession(stored: StoredSession): RodaidSession {
  return {
    token: stored.accessToken,
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    userId: stored.userId,
    nombre: stored.nombre,
    rol: stored.rol,
  }
}

export function getSession(): RodaidSession | null {
  const stored = read()
  return stored ? toSession(stored) : null
}

export function clearSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
  clearJwtCookie()
  notifySessionChange()
}

/** Arranca una sesion demo real (preview) si no hay ninguna. */
export async function ensureSession(): Promise<RodaidSession> {
  const existing = read()
  if (existing) return toSession(existing)

  const res = await fetch('/api/v1/auth/demo-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) {
    throw new Error('No se pudo iniciar la sesion.')
  }
  const data = (await res.json()) as {
    accessToken?: string
    token?: string
    refreshToken?: string | null
    userId: string
    nombre?: string
    rol?: string
  }
  const stored: StoredSession = {
    accessToken: data.accessToken ?? data.token ?? '',
    refreshToken: data.refreshToken ?? null,
    userId: data.userId,
    nombre: data.nombre ?? 'Usuario',
    rol: data.rol ?? null,
  }
  write(stored)
  return toSession(stored)
}

/**
 * Garantiza una sesion cuyo rol este dentro de `permitidos`. Si la sesion actual
 * no alcanza, en preview arranca una sesion demo con el rol `demoRol` (los
 * endpoints de demo solo operan fuera de LIVE). Pensado para los paneles de
 * inspector / admin (Hito 11).
 */
export async function ensureRoleSession(
  permitidos: string[],
  demoRol: string
): Promise<RodaidSession> {
  const current = read()
  if (current?.rol && permitidos.includes(current.rol)) {
    return toSession(current)
  }

  const res = await fetch('/api/v1/auth/demo-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rol: demoRol }),
  })
  if (!res.ok) {
    // No se pudo elevar (p. ej. modo LIVE): devolvemos lo que haya.
    if (current) return toSession(current)
    throw new Error('No se pudo iniciar la sesion con el rol requerido.')
  }
  const data = (await res.json()) as {
    accessToken?: string
    token?: string
    refreshToken?: string | null
    userId: string
    nombre?: string
    rol?: string
  }
  const stored: StoredSession = {
    accessToken: data.accessToken ?? data.token ?? '',
    refreshToken: data.refreshToken ?? null,
    userId: data.userId,
    nombre: data.nombre ?? 'Usuario',
    rol: data.rol ?? demoRol,
  }
  write(stored)
  return toSession(stored)
}

/** Inicia sesion con email + contrasena y persiste la sesion. */
export async function login(
  email: string,
  password: string
): Promise<RodaidSession> {
  return authenticate('/api/v1/auth/login', { email, password })
}

/** Registra una cuenta nueva y persiste la sesion. */
export async function register(
  email: string,
  password: string,
  nombre?: string
): Promise<RodaidSession> {
  return authenticate('/api/v1/auth/registro', { email, password, nombre })
}

/**
 * Completa el ingreso con Mendoza por Mí (Hito 9). Tras el callback OIDC, el
 * servidor entrega un ticket de un solo uso; aca se canjea por la sesion real
 * (mismos tokens que el login local) y se persiste. La estructura de la sesion
 * es identica sin importar el origen.
 */
export async function completarSesionMxm(ticket: string): Promise<RodaidSession> {
  const res = await fetch('/api/v1/auth/mxm/sesion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    accessToken?: string
    refreshToken?: string | null
    userId?: string
    nombre?: string
    rol?: string
    message?: string
  }
  if (!res.ok || !data.accessToken || !data.userId) {
    throw new Error(data.message ?? 'No se pudo completar el ingreso con Mendoza por Mí.')
  }
  const stored: StoredSession = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? null,
    userId: data.userId,
    nombre: data.nombre ?? 'Usuario',
    rol: data.rol ?? null,
  }
  write(stored)
  return toSession(stored)
}

async function authenticate(
  url: string,
  body: Record<string, unknown>
): Promise<RodaidSession> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as {
    accessToken?: string
    refreshToken?: string | null
    usuario?: { id: string; rol?: string; datosPerfil?: { nombre?: string }; email?: string }
    error?: string
    message?: string
  }
  if (!res.ok || !data.accessToken || !data.usuario) {
    throw new Error(data.message ?? 'No se pudo iniciar sesion.')
  }
  const stored: StoredSession = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? null,
    userId: data.usuario.id,
    nombre: data.usuario.datosPerfil?.nombre ?? data.usuario.email ?? 'Usuario',
    rol: data.usuario.rol ?? null,
  }
  write(stored)
  return toSession(stored)
}

/**
 * Intenta renovar el AccessToken con el RefreshToken. Devuelve la sesion
 * renovada o `null` si el RefreshToken es invalido/expiro (en cuyo caso la
 * sesion se descarta y hay que volver a autenticarse).
 */
async function tryRefresh(): Promise<StoredSession | null> {
  const current = read()
  if (!current?.refreshToken) {
    clearSession()
    return null
  }
  const res = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  })
  if (!res.ok) {
    // RefreshToken invalido o expirado: forzar nuevo login.
    clearSession()
    return null
  }
  const data = (await res.json()) as {
    accessToken?: string
    refreshToken?: string | null
  }
  if (!data.accessToken) {
    clearSession()
    return null
  }
  const updated: StoredSession = {
    ...current,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? current.refreshToken,
  }
  write(updated)
  return updated
}

/**
 * fetch con el AccessToken adjunto. Crea la sesion si falta. Ante un 401
 * renueva el token con el RefreshToken y reintenta una vez; si la renovacion
 * falla, arranca una sesion demo nueva (preview) y reintenta, de modo que el
 * usuario quede siempre forzado a una sesion valida.
 */
export async function authedFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  let session = await ensureSession()

  const doFetch = (token: string) => {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers })
  }

  let res = await doFetch(session.accessToken)
  if (res.status !== 401) {
    return res
  }

  // 1) Renovar con el RefreshToken.
  const refreshed = await tryRefresh()
  if (refreshed) {
    res = await doFetch(refreshed.accessToken)
    if (res.status !== 401) {
      return res
    }
  }

  // 2) Sesion vencida sin refresh valido: arrancar una nueva y reintentar.
  clearSession()
  session = await ensureSession()
  return doFetch(session.accessToken)
}
