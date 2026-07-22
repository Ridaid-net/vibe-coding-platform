'use client'
import { useState, useEffect } from 'react'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { User, Mail, Shield, Calendar, Edit3, Save, X, TrendingUp, DollarSign, ShoppingBag, Star, Route, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { getSession, authedFetch } from '@/lib/session'

interface Perfil {
  id: string
  email: string
  rol: string
  datosPerfil: { nombre?: string }
  emailVerificado: boolean
  createdAt: string
}

interface Facturacion {
  resumen: { transacciones: number; bruto: number; neto_vendedor: number; comision_rodaid: number }
  nota: string
}

const ROL_BADGE: Record<string, { label: string; color: string }> = {
  admin: { label: 'Administrador', color: 'bg-purple-100 text-purple-700' },
  aliado: { label: 'Taller Aliado', color: 'bg-orange-100 text-orange-700' },
  inspector: { label: 'Inspector', color: 'bg-blue-100 text-blue-700' },
  ciclista: { label: 'Ciclista', color: 'bg-teal-100 text-teal-700' },
}

function Estrella({ valor, max = 5 }: { valor: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star key={i} className={`size-4 ${i < Math.round(valor) ? 'text-amber-400 fill-amber-400' : 'text-slate-200 fill-slate-200'}`} />
      ))}
    </div>
  )
}

export default function PerfilPage() {
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [bicicletas, setBicicletas] = useState<{id: string; marca: string; modelo: string; numero_serie: string; cit_activo: boolean}[]>([])
  const [facturacion, setFacturacion] = useState<Facturacion | null>(null)
  const [stats, setStats] = useState<{bicicletas:number;cits_activos:number;ventas:{total:number;monto_total:number};valoraciones:{total:number;promedio:number};salidas_organizadas:number} | null>(null)
  const [mesSeleccionado, setMesSeleccionado] = useState('')
  const [cambiandoPass, setCambiandoPass] = useState(false)
  const [passActual, setPassActual] = useState('')
  const [passNuevo, setPassNuevo] = useState('')
  const [passNuevo2, setPassNuevo2] = useState('')
  const [guardandoPass, setGuardandoPass] = useState(false)

  useEffect(() => {
    const sesion = getSession()
    if (!sesion) { window.location.href = '/ingresar?next=/perfil'; return }

    Promise.all([
      authedFetch('/api/v1/auth/me').then(r => r.json()),
      authedFetch('/api/v1/bicicletas').then(r => r.json()),
      authedFetch('/api/v1/facturacion').then(r => r.json()),
    ]).then(([me, bicis, fact]) => {
      const usuario = me.usuario ?? me
      setPerfil(usuario)
      setNombre(usuario?.datosPerfil?.nombre ?? '')
      setBicicletas(bicis.bicicletas ?? [])
      setFacturacion(fact.facturacion ?? null)
      // Estadísticas derivadas
      setStats({
        bicicletas: (bicis.bicicletas ?? []).length,
        cits_activos: (bicis.bicicletas ?? []).filter((b: {cit_activo: boolean}) => b.cit_activo).length,
        ventas: fact.facturacion?.resumen ? { total: fact.facturacion.resumen.transacciones, monto_total: fact.facturacion.resumen.neto_vendedor } : { total: 0, monto_total: 0 },
        valoraciones: { total: 0, promedio: 0 },
        salidas_organizadas: 0,
      })
    }).finally(() => setCargando(false))
  }, [])

  const cargarFacturacion = async (mes: string) => {
    setMesSeleccionado(mes)
    const fact = await authedFetch(`/api/v1/facturacion${mes ? `?mes=${mes}` : ''}`).then(r => r.json())
    setFacturacion(fact.facturacion ?? null)
  }

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

  const cambiarPassword = async () => {
    if (!perfil) return
    if (passNuevo.length < 8) {
      toast.error('La contraseña nueva debe tener al menos 8 caracteres.')
      return
    }
    if (passNuevo !== passNuevo2) {
      toast.error('Las contraseñas nuevas no coinciden.')
      return
    }
    setGuardandoPass(true)
    try {
      const res = await authedFetch('/api/v1/auth/cambiar-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: perfil.email, passwordActual: passActual, passwordNuevo: passNuevo }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.error ?? 'No pudimos cambiar la contraseña.')
        return
      }
      toast.success('Contraseña actualizada correctamente.')
      setCambiandoPass(false)
      setPassActual('')
      setPassNuevo('')
      setPassNuevo2('')
    } finally {
      setGuardandoPass(false)
    }
  }

  if (cargando) return <div className="flex items-center justify-center min-h-screen"><p className="text-slate-warm">Cargando perfil...</p></div>

  const badge = ROL_BADGE[perfil?.rol ?? 'ciclista'] ?? ROL_BADGE.ciclista
  const mesActual = new Date().toISOString().slice(0, 7)

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
                  <h1 className="font-display text-xl font-bold text-[#0F1E35]">{perfil?.datosPerfil?.nombre ?? 'Usuario RODAID'}</h1>
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

        {/* Stats rápidas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Bicicletas', valor: stats?.bicicletas ?? 0, icono: '🚲' },
            { label: 'CITs activos', valor: stats?.cits_activos ?? 0, icono: '✅' },
            { label: 'Ventas', valor: stats?.ventas.total ?? 0, icono: '💰' },
            { label: 'Salidas', valor: stats?.salidas_organizadas ?? 0, icono: '🗺️' },
          ].map((s, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-white p-4 text-center">
              <div className="text-2xl mb-1">{s.icono}</div>
              <p className="text-lg font-bold text-[#0F1E35]">{s.valor}</p>
              <p className="text-xs text-slate-warm">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Dashboard Facturación */}
        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <h2 className="font-display text-base font-semibold text-[#0F1E35] flex items-center gap-2">
              <TrendingUp className="size-4 text-[#F47B20]" /> Facturación y Comisiones
            </h2>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => cargarFacturacion('')}
                className={`text-xs px-3 py-1.5 rounded-full font-semibold border ${!mesSeleccionado ? 'bg-[#0F1E35] text-white border-[#0F1E35]' : 'border-slate-200 text-slate-600'}`}>
                Todo
              </button>
              <button type="button" onClick={() => cargarFacturacion(mesActual)}
                className={`text-xs px-3 py-1.5 rounded-full font-semibold border ${mesSeleccionado === mesActual ? 'bg-[#0F1E35] text-white border-[#0F1E35]' : 'border-slate-200 text-slate-600'}`}>
                Este mes
              </button>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Transacciones', valor: facturacion?.resumen.transacciones ?? 0, icono: ShoppingBag, color: '#2BBCB8' },
              { label: 'Bruto ARS', valor: `$${((facturacion?.resumen.bruto ?? 0)).toLocaleString('es-AR')}`, icono: DollarSign, color: '#0F1E35' },
              { label: 'Neto ARS (80%)', valor: `$${((facturacion?.resumen.neto_vendedor ?? 0)).toLocaleString('es-AR')}`, icono: TrendingUp, color: '#16a34a' },
              { label: 'Comisión RODAID', valor: `$${((facturacion?.resumen.comision_rodaid ?? 0)).toLocaleString('es-AR')}`, icono: Star, color: '#F47B20' },
            ].map((k, i) => (
              <div key={i} className="rounded-xl bg-slate-50 p-3">
                <k.icono className="size-4 mb-2" style={{ color: k.color }} />
                <p className="text-sm font-bold text-[#0F1E35]">{k.valor}</p>
                <p className="text-[10px] text-slate-warm mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Nota */}
          {facturacion?.nota && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-4">
              <p className="text-xs text-amber-700">{facturacion.nota}</p>
            </div>
          )}

          {/* Ventas vacías */}
          {(!facturacion || facturacion.resumen.transacciones === 0) && (
            <div className="text-center py-8">
              <ShoppingBag className="size-8 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-warm">Sin transacciones en este período.</p>
              <p className="text-xs text-slate-warm/60 mt-1">Las ventas aparecerán aquí cuando MercadoPago LIVE esté activo.</p>
            </div>
          )}
        </div>

        {/* Bicicletas */}
        {bicicletas.length > 0 && (
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <h2 className="font-display text-base font-semibold text-[#0F1E35] mb-4 flex items-center gap-2">
              🚲 Mis Bicicletas
            </h2>
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
              {!cambiandoPass && (
                <button type="button" onClick={() => setCambiandoPass(true)}
                  className="text-xs font-semibold text-[#2BBCB8] hover:underline">
                  Cambiar contraseña
                </button>
              )}
            </div>
            {cambiandoPass && (
              <div className="space-y-2 rounded-xl bg-slate-50 p-4">
                <input type="password" value={passActual} onChange={e => setPassActual(e.target.value)}
                  placeholder="Contraseña actual"
                  className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
                <input type="password" value={passNuevo} onChange={e => setPassNuevo(e.target.value)}
                  placeholder="Contraseña nueva (mínimo 8 caracteres)"
                  className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
                <input type="password" value={passNuevo2} onChange={e => setPassNuevo2(e.target.value)}
                  placeholder="Repetir contraseña nueva"
                  className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={cambiarPassword} disabled={guardandoPass || !passActual || !passNuevo}
                    className="inline-flex items-center gap-1 rounded-full bg-[#2BBCB8] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    <Lock className="size-3" /> {guardandoPass ? 'Guardando...' : 'Guardar contraseña'}
                  </button>
                  <button type="button" onClick={() => { setCambiandoPass(false); setPassActual(''); setPassNuevo(''); setPassNuevo2('') }}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">
                    <X className="size-3" /> Cancelar
                  </button>
                </div>
              </div>
            )}
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
