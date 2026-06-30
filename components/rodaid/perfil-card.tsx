'use client'

import { useEffect, useState } from 'react'
import { BadgeCheck, ShieldCheck, User } from 'lucide-react'
import { authedFetch } from '@/lib/session'

interface Perfil {
  nombre: string | null
  email: string
  rol: string
  selloGubernamental: boolean
  emailVerificado: boolean
}

/**
 * "Mi Perfil" — identidad de la cuenta (Hito 9).
 *
 * Muestra el "sello gubernamental": el check de verificado especial que recibe
 * quien validó su identidad con Mendoza por Mí. Es una señal de confianza
 * reforzada, distinta de la verificación de email.
 */
export function PerfilCard() {
  const [perfil, setPerfil] = useState<Perfil | null>(null)

  useEffect(() => {
    let activo = true
    authedFetch('/api/v1/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!activo || !data?.usuario) return
        const u = data.usuario
        setPerfil({
          nombre: (u.datosPerfil?.nombre as string | undefined) ?? null,
          email: u.email,
          rol: u.rol,
          selloGubernamental: Boolean(u.selloGubernamental),
          emailVerificado: Boolean(u.emailVerificado),
        })
      })
      .catch(() => undefined)
    return () => {
      activo = false
    }
  }, [])

  if (!perfil) return null

  return (
    <section className="mt-6 rounded-3xl border border-ink/12 bg-white p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-paper-dim text-ink/40">
          <User className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-bold text-ink">
            {perfil.nombre ?? perfil.email}
          </h2>
          <p className="truncate text-sm text-slate-warm">{perfil.email}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {perfil.selloGubernamental && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0a7d5a]/10 px-3 py-1.5 text-xs font-semibold text-[#0a7d5a]">
                <ShieldCheck className="size-3.5" />
                Identidad verificada por Mendoza por Mí
              </span>
            )}
            {perfil.emailVerificado && !perfil.selloGubernamental && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-lime/25 px-3 py-1.5 text-xs font-semibold text-ink">
                <BadgeCheck className="size-3.5" />
                Email verificado
              </span>
            )}
          </div>

          {perfil.selloGubernamental && (
            <p className="mt-3 text-xs text-slate-warm">
              Tu identidad fue confirmada con el Estado. Este sello acelera la
              confianza de tus operaciones en RODAID.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
