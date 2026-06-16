'use client'

/**
 * Sesion de comprador de RODAID.
 *
 * Mientras el sistema de cuentas (Hito 1) todavia no existe, el frontend
 * obtiene un token de comprador de prueba desde /api/v1/auth/demo-session y lo
 * guarda en localStorage. Cuando se implemente el login real, basta reemplazar
 * `ensureSession` por el flujo de autenticacion definitivo: el resto del
 * checkout ya consume el token via `authedFetch`.
 */

export interface RodaidSession {
  token: string
  userId: string
  nombre: string
}

const STORAGE_KEY = 'rodaid.session.v1'

export function getSession(): RodaidSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RodaidSession>
    if (parsed?.token && parsed?.userId) {
      return {
        token: parsed.token,
        userId: parsed.userId,
        nombre: parsed.nombre ?? 'Comprador',
      }
    }
  } catch {
    // Sesion corrupta: se descarta y se vuelve a crear.
  }
  return null
}

export async function ensureSession(): Promise<RodaidSession> {
  const existing = getSession()
  if (existing) return existing

  const res = await fetch('/api/v1/auth/demo-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) {
    throw new Error('No se pudo iniciar la sesion de comprador.')
  }
  const data = (await res.json()) as {
    token: string
    userId: string
    nombre: string
  }
  const session: RodaidSession = {
    token: data.token,
    userId: data.userId,
    nombre: data.nombre,
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  return session
}

/** fetch con el Bearer token del comprador adjunto. Crea la sesion si falta. */
export async function authedFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const session = await ensureSession()
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${session.token}`)
  return fetch(input, { ...init, headers })
}

export function clearSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}
