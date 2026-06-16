'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { completarSesionMxm } from '@/lib/session'

/**
 * Handoff del login con Mendoza por Mí (Hito 9). El callback del servidor redirige
 * aca con un ticket de un solo uso; esta pantalla lo canjea por la sesion real
 * (sin exponer los tokens en la URL) y lleva al usuario a su destino.
 */
function HandoffInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const corrio = useRef(false)

  useEffect(() => {
    if (corrio.current) return
    corrio.current = true

    const ticket = params.get('ticket')
    const returnTo = sanitizeReturnTo(params.get('returnTo'))
    if (!ticket) {
      setError('No recibimos el acceso. Volvé a intentar el ingreso.')
      return
    }
    completarSesionMxm(ticket)
      .then(() => router.replace(returnTo))
      .catch((err: Error) => setError(err.message))
  }, [params, router])

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-[#0a7d5a]/10 text-[#0a7d5a]">
        <ShieldCheck className="size-8" />
      </span>
      {error ? (
        <>
          <h1 className="mt-6 font-display text-2xl font-bold text-ink">
            No pudimos completar el ingreso
          </h1>
          <p className="mt-2 text-sm text-slate-warm">{error}</p>
          <a
            href="/ingresar"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            Volver a ingresar
          </a>
        </>
      ) : (
        <>
          <h1 className="mt-6 font-display text-2xl font-bold text-ink">
            Verificando tu identidad…
          </h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-warm">
            <Loader2 className="size-4 animate-spin" />
            Estamos confirmando tu identidad con Mendoza por Mí.
          </p>
        </>
      )}
    </div>
  )
}

export default function MxmHandoffPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Suspense fallback={null}>
        <HandoffInner />
      </Suspense>
    </div>
  )
}

function sanitizeReturnTo(value: string | null): string {
  if (value && value.startsWith('/') && !value.startsWith('//')) return value
  return '/garaje'
}
