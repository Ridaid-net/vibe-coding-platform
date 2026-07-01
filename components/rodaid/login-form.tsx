'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, LogIn, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { login, register } from '@/lib/session'


// Detecta si el input es un CUIL (solo dígitos, con o sin guiones) o un email
function esCuil(valor: string): boolean {
  return /^[0-9]{2}[-]?[0-9]{8}[-]?[0-9]$/.test(valor.replace(/s/g, ''))
}
function normalizarIdentificador(valor: string): string {
  return esCuil(valor) ? valor.replace(/[-s]/g, '') : valor.trim()
}
const inputClass =
  'w-full rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-slate-warm/60 focus:border-ink/40 focus:ring-4 focus:ring-lime/25'

type Modo = 'login' | 'registro'

/**
 * Pantalla de ingreso de RODAID (Hito 9). Ofrece dos vias equivalentes:
 *   - El login local (email + contrasena), que se mantiene para casos de
 *     excepcion y para quienes no usan la identidad del Gobierno.
 *   - "Ingresar con Mendoza por Mí": delega la autenticacion al IDP del Gobierno
 *     (OIDC). Quien ingresa asi recibe el sello gubernamental en su perfil.
 *
 * Sea cual sea la via, la sesion resultante es identica: mismos tokens y misma
 * estructura de usuario.
 */
export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const returnTo = sanitizeReturnTo(params.get('returnTo'))
  const mxmError = params.get('mxm_error')

  const [modo, setModo] = useState<Modo>('login')
  const [identificador, setIdentificador] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre] = useState('')
  const [cuil, setCuil] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [redirigiendo, setRedirigiendo] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (enviando) return
    if (!normalizarIdentificador(identificador) || !password) {
      toast.error('Completá tu CUIL o email y contraseña.')
      return
    }
    setEnviando(true)
    try {
      if (modo === 'login') {
        await login(normalizarIdentificador(identificador), password)
      } else {
        await register(normalizarIdentificador(identificador), password, nombre.trim() || undefined, cuil.replace(/[-s]/g, "") || undefined)
      }
      router.push(returnTo)
    } catch (err) {
      toast.error('No pudimos iniciar sesión', {
        description: (err as Error).message ?? 'Revisá tus datos e intentá de nuevo.',
      })
      setEnviando(false)
    }
  }

  const ingresarConMxm = () => {
    setRedirigiendo(true)
    window.location.href = `/api/v1/auth/mxm/login?returnTo=${encodeURIComponent(returnTo)}`
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
          Tu cuenta
        </span>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
          {modo === 'login' ? 'Ingresá a RODAID' : 'Creá tu cuenta'}
        </h1>
        <p className="mt-2 text-sm text-slate-warm">
          Gestioná la identidad de tus bicicletas y operá con confianza.
        </p>
      </div>

      {mxmError && (
        <div className="mt-6 rounded-2xl border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-ink">
          {mxmError}
        </div>
      )}

      {/* Ingreso institucional: Mendoza por Mí */}
      <button
        type="button"
        onClick={ingresarConMxm}
        disabled={redirigiendo}
        className="mt-6 flex w-full items-center justify-center gap-3 rounded-2xl border border-[#0a7d5a]/30 bg-gradient-to-r from-[#0a7d5a] to-[#06b6a3] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-70"
      >
        {redirigiendo ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="grid size-6 place-items-center rounded-md bg-white/20">
            <ShieldCheck className="size-4" />
          </span>
        )}
        Ingresar con Mendoza por Mí
      </button>
      <p className="mt-2 text-center text-xs text-slate-warm">
        Verificá tu identidad con el Gobierno de Mendoza y obtené el sello
        gubernamental en tu perfil.
      </p>

      <div className="my-6 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-slate-warm/70">
        <span className="h-px flex-1 bg-ink/10" />
        o con tu CUIL o email
        <span className="h-px flex-1 bg-ink/10" />
      </div>

      <form onSubmit={submit} noValidate className="space-y-4">
        {modo === 'registro' && (
          <label className="block">
            <span className="text-sm font-semibold text-ink">Nombre</span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Tu nombre"
              className={`mt-1.5 ${inputClass}`}
            />
          </label>
        )}
        {modo === "registro" && (
          <label className="block">
            <span className="text-sm font-semibold text-ink">CUIL <span className="font-normal text-slate-warm">(opcional)</span></span>
            <input
              type="text"
              autoComplete="off"
              value={cuil}
              onChange={(e) => setCuil(e.target.value)}
              placeholder="20-12345678-9"
              className={`mt-1.5 ${inputClass}`}
            />
          </label>
        )}
        <label className="block">
          <span className="text-sm font-semibold text-ink">CUIL o Email</span>
          <input
            type="text"
            autoComplete="username"
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
            placeholder="20-12345678-9 o vos@email.com"
            className={`mt-1.5 ${inputClass}`}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-ink">Contraseña</span>
          <input
            type="password"
            autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={`mt-1.5 ${inputClass}`}
          />
        </label>

        <button
          type="submit"
          disabled={enviando}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <LogIn className="size-4 text-lime" />
          )}
          {modo === 'login' ? 'Ingresar' : 'Crear cuenta'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-warm">
        {modo === 'login' ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?'}{' '}
        <button
          type="button"
          onClick={() => setModo(modo === 'login' ? 'registro' : 'login')}
          className="font-semibold text-ink underline-offset-2 hover:underline"
        >
          {modo === 'login' ? 'Creá una' : 'Ingresá'}
        </button>
      </p>
    </div>
  )
}

function sanitizeReturnTo(value: string | null): string {
  if (value && value.startsWith('/') && !value.startsWith('//')) return value
  return '/garaje'
}
