'use client'
import { useState, useEffect } from 'react'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { User, Mail, Shield, Star, Calendar, Edit3, Save, X } from 'lucide-react'
import { getSession, authedFetch } from '@/lib/session'

interface Perfil {
  id: string
  email: string
  rol: string
  datosPerfil: { nombre?: string; avatar?: string }
  emailVerificado: boolean
  createdAt: string
}

const ROL_BADGE: Record<string, { label: string; color: string }> = {
  admin: { label: 'Administrador', color: 'bg-purple-100 text-purple-700' },
  aliado: { label: 'Taller Aliado', color: 'bg-orange-100 text-orange-700' },
  inspector: { label: 'Inspector', color: 'bg-blue-100 text-blue-700' },
  ciclista: { label: 'Ciclista', color: 'bg-teal-100 text-teal-700' },
}

export default function PerfilPage() {
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [bicicletas, setBicicletas] = useState<{id: string; marca: string; modelo: string; numero_serie: string; cit_activo: boolean}[]>([])

  useEffect(() => {
    const sesion = getSession()
    if (!sesion) { window.location.href = '/ingresar?next=/perfil'; return }
    
    Promise.all([
      authedFetch('/api/v1/auth/me').then(r => r.json()),
      authedFetch('/api/v1/bicicletas').then(r => r.json()),
    ]).then(([me, bicis]) => {
      setPerfil(me.usuario ?? me)
      setNombre(me.usuario?.datosPerfil?.nombre ?? me.datosPerfil?.nombre ?? '')
      setBicicletas(bicis.bicicletas ?? [])
    }).finally(() => setCargando(false))
  }, [])

  const guardar = async () => {
    setGuardando(true)
    try {
      await authedFetch('/api/v1/auth/perfil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre })
      })
      if (perfil) setPerfil({ ...perfil, datosPerfil: { ...perfil.datosPerfil, nombre } })
      setEditando(false)
    } finally { setGuardando(false) }
  }

  if (cargando) return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-slate-warm">Cargando perfil...</p>
    </div>
  )

  const badge = ROL_BADGE[perfil?.rol ?? 'ciclista'] ?? ROL_BADGE.ciclista

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 space-y-5">

        {/* Header */}
        <div className="rounded-2xl border border-ink/10 bg-white p-6">
          <div className="flex items-start gap-5 flex-wrap">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-[#0F1E35] shrink-0">
              <User className="size-8 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {editando ? (
                  <input type="text" value={nombre} onChange={e => setNombre(e.target.value)}
                    className="font-display text-xl font-bold text-[#0F1E35] border-b-2 border-[#2BBCB8] outline-none bg-transparent" />
                ) : (
                  <h1 className="font-display text-xl font-bold text-[#0F1E35]">
                    {perfil?.datosPerfil?.nombre ?? 'Usuario RODAID'}
                  </h1>
                )}
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${badge.color}`}>{badge.label}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-sm text-slate-warm">
                <Mail className="size-3.5" />
                <span>{perfil?.email}</span>
                {perfil?.emailVerificado && <span className="text-green-500 text-xs">✓ verificado</span>}
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-warm">
                <Calendar className="size-3" />
                <span>Miembro desde {perfil?.createdAt ? new Date(perfil.createdAt).toLocaleDateString('es-AR') : '-'}</span>
              </div>
            </div>
            <div className="flex gap-2">
              {editando ? (
                <>
                  <button type="button" onClick={guardar} disabled={guardando}
                    className="inline-flex items-center gap-1 rounded-full bg-[#2BBCB8] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    <Save className="size-3" /> {guardando ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button type="button" onClick={() => setEditando(false)}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">
                    <X className="size-3" /> Cancelar
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setEditando(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-ink/5">
                  <Edit3 className="size-3" /> Editar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Bicicletas', valor: bicicletas.length, icono: '🚲' },
            { label: 'CITs activos', valor: bicicletas.filter(b => b.cit_activo).length, icono: '✅' },
            { label: 'Rol', valor: badge.label, icono: '🏅' },
          ].map((s, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-white p-4 text-center">
              <div className="text-2xl mb-1">{s.icono}</div>
              <p className="text-lg font-bold text-[#0F1E35]">{s.valor}</p>
              <p className="text-xs text-slate-warm">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Bicicletas */}
        {bicicletas.length > 0 && (
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <h2 className="font-display text-base font-semibold text-[#0F1E35] mb-4">Mis Bicicletas</h2>
            <div className="space-y-3">
              {bicicletas.map(b => (
                <div key={b.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0F1E35]">{b.marca} {b.modelo}</p>
                    <p className="text-xs text-slate-warm font-mono">{b.numero_serie}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${b.cit_activo ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {b.cit_activo ? 'CIT activo' : 'Sin CIT'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Seguridad */}
        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <h2 className="font-display text-base font-semibold text-[#0F1E35] mb-4 flex items-center gap-2">
            <Shield className="size-4 text-[#2BBCB8]" /> Seguridad
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-warm">Contraseña</p>
              <a href="/ingresar" className="text-xs font-semibold text-[#2BBCB8] hover:underline">Cambiar contraseña</a>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-warm">Email verificado</p>
              <span className={`text-xs font-semibold ${perfil?.emailVerificado ? 'text-green-600' : 'text-amber-600'}`}>
                {perfil?.emailVerificado ? '✓ Verificado' : '⚠ Pendiente'}
              </span>
            </div>
          </div>
        </div>

      </main>
      <Footer />
    </div>
  )
}
