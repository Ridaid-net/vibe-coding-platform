'use client'

/**
 * RODAID — Contexto de autenticación del cliente (Hito 19).
 *
 * Expone el estado de sesión a la UI (cabecera, controles de admin, etc.) con un
 * estado de carga (`loading`) para evitar saltos visuales durante la hidratación:
 * en el primer render del servidor y hasta leer la sesión del cliente, `loading`
 * es `true` y `user` es `null`.
 *
 * IMPORTANTE — defensa en profundidad: este contexto es solo para la EXPERIENCIA
 * de usuario (mostrar u ocultar enlaces). NO es un control de seguridad: el rol
 * vive en el cliente y podría manipularse. La autorización real la imponen la
 * Edge Function `auth-admin` (valida la firma del JWT en el borde) y los guards
 * del backend (`requireRole('admin')` / `requireAdminPanel`).
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { getSession, SESSION_EVENT } from '@/lib/session'

export interface AuthUser {
  id: string
  /** Rol del usuario; `admin` habilita los controles de administración. */
  role: string | null
  nombre: string
}

interface AuthState {
  user: AuthUser | null
  /** `true` mientras aún no se leyó la sesión del cliente. */
  loading: boolean
}

const AuthContext = createContext<AuthState>({ user: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true })

  useEffect(() => {
    const sync = () => {
      const session = getSession()
      setState({
        loading: false,
        user: session
          ? { id: session.userId, role: session.rol, nombre: session.nombre }
          : null,
      })
    }

    sync()
    // `storage`: cambios desde otra pestaña. `SESSION_EVENT`: login/logout/refresh
    // en la misma pestaña.
    window.addEventListener('storage', sync)
    window.addEventListener(SESSION_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(SESSION_EVENT, sync)
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

/** Estado de autenticación del cliente: `{ user, loading }`. */
export function useAuth(): AuthState {
  return useContext(AuthContext)
}
