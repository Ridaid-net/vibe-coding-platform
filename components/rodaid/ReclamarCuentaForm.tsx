'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { KeyRound, Loader2 } from 'lucide-react'
import { reclamarCuenta } from '@/lib/session'

/**
 * Página pública donde una cuenta creada por otra persona (un Taller Aliado
 * via "Iniciar Certificación", o un admin invitando a un inspector) reclama
 * su cuenta: elige su propia contraseña usando el link que le llegó por
 * mail. El token en sí es la credencial -- sin login previo. El destino
 * post-activación depende del rol de la cuenta reclamada.
 */
export function ReclamarCuentaForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return (
      <div className="rounded-3xl border border-clay/30 bg-clay/5 px-6 py-12 text-center">
        <p className="font-display text-lg font-bold text-ink">Link inválido</p>
        <p className="mt-1 text-sm text-slate-warm">
          Falta el token de invitación. Pedile a quien te invitó que te genere un link nuevo.
        </p>
      </div>
    )
  }

  const enviar = async () => {
    if (enviando) return
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmar) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setEnviando(true)
    setError(null)
    try {
      const sesion = await reclamarCuenta(token, password)
      const destino = sesion.rol === 'inspector' || sesion.rol === 'aliado' ? '/admin/inspecciones' : '/garaje'
      router.replace(destino)
    } catch (err) {
      setError((err as Error).message || 'No pudimos activar tu cuenta. Probá de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="rounded-3xl border border-ink/10 bg-white p-6 sm:p-8">
      <span className="flex size-12 items-center justify-center rounded-xl bg-lime/20 text-ink">
        <KeyRound className="size-6" />
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold text-ink">Activá tu cuenta</h1>
      <p className="mt-2 text-sm text-slate-warm">
        Elegí tu contraseña para activar tu cuenta RODAID.
      </p>

      <div className="mt-6 space-y-3">
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña (mínimo 8 caracteres)"
          className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
        />
        <input
          type="password"
          value={confirmar}
          onChange={(e) => setConfirmar(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && enviar()}
          placeholder="Repetí la contraseña"
          className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink/40"
        />
        {error && <p className="text-xs text-clay">{error}</p>}
        <button
          type="button"
          onClick={enviar}
          disabled={enviando || !password || !confirmar}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Activando…
            </>
          ) : (
            'Activar cuenta'
          )}
        </button>
      </div>
    </div>
  )
}
