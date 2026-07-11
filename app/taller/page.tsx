'use client'
import { useState, useEffect } from 'react'
import { getSession, clearSession } from '@/lib/session'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Inspecciones } from '@/components/rodaid/inspecciones'
import { PublicarServicioTaller } from '@/components/rodaid/PublicarServicioTaller'
import { ShieldCheck, DollarSign, Clock, Award, LogOut } from 'lucide-react'
import { authedFetch } from '@/lib/session'

export default function TallerPage() {
  useEffect(() => {
    const sesion = getSession()
    if (!sesion) { window.location.replace("/ingresar?next=/taller"); return }
    if (sesion.rol !== "aliado" && sesion.rol !== "inspector" && sesion.rol !== "admin") {
      window.location.replace("/garaje")
    }
  }, [])
  const [stats, setStats] = useState({ cits: 0, pendientes: 0, ingresos: 0 })

  useEffect(() => {
    authedFetch('/api/inspector/cit')
      .then(r => r.json())
      .then(data => {
        if (data?.cits) {
          const total = data.cits.length
          const pendientes = data.cits.filter((c: {estado: string}) => c.estado === 'pendiente').length
          const ingresos = total * 33000
          setStats({ cits: total, pendientes, ingresos })
        }
      })
      .catch(() => undefined)
  }, [])

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">

        {/* Header */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest text-[#F47B20]">RODAID · Portal Aliado</span>
            <h1 className="mt-2 font-display text-3xl font-bold text-[#0F1E35]">Panel del Taller Aliado</h1>
            <p className="mt-2 text-sm text-slate-warm">Emití CITs, gestioná inspecciones y seguí tus ingresos.</p>
          </div>
          <button
            type="button"
            onClick={() => { clearSession(); window.location.href = "/" }}
            className="inline-flex items-center gap-1.5 rounded-full border border-clay/30 bg-clay/5 px-3 py-1.5 text-xs font-semibold text-clay transition-colors hover:bg-clay/10"
          >
            <LogOut className="size-3.5" /> Cerrar sesión
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
          {[
            { icono: ShieldCheck, label: 'CITs emitidos', valor: stats.cits, color: '#2BBCB8', bg: 'bg-teal-50' },
            { icono: Clock, label: 'Pendientes', valor: stats.pendientes, color: '#F47B20', bg: 'bg-orange-50' },
            { icono: DollarSign, label: 'Ingresos garantizados (ARS)', valor: `$${stats.ingresos.toLocaleString('es-AR')}`, color: '#0F1E35', bg: 'bg-slate-50' },
          ].map((s, i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className={`flex size-10 items-center justify-center rounded-xl ${s.bg} mb-3`}>
                <s.icono className="size-5" style={{ color: s.color }} />
              </div>
              <p className="text-2xl font-bold text-[#0F1E35]">{s.valor}</p>
              <p className="text-xs text-slate-warm mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Info retribucion */}
        <div className="rounded-2xl bg-[#0F1E35] p-5 mb-8 flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#F47B20]">
            <Award className="size-6 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Retribución por CIT: $33.000 ARS garantizados</p>
            <p className="text-xs text-white/60">$18.000 por la verificación + $15.000 por el embalaje — el 100% es tuyo. Si la bici se vende, sumás además el 50% del fee de éxito (2% del valor de venta). Los pagos se procesan mensualmente via RODAID PAY.</p>
          </div>
        </div>

        <PublicarServicioTaller />

        {/* Panel de inspecciones */}
        <Inspecciones />

      </main>
      <Footer />
    </div>
  )
}
