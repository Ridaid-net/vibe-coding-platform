'use client'
import { useEffect, useState } from 'react'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import Link from 'next/link'
import { Wrench, Star, ExternalLink, RefreshCw, ChevronRight, MessageCircle } from 'lucide-react'
import { labelServicioAliado } from '@/lib/aliado-servicios'

interface ServicioPublicado {
  aliadoId: string
  nombreTaller: string
  servicio: string
  precioArs: number
  logoUrl: string
  linkTienda: string | null
  whatsappNumero: string | null
}

export function ServiciosAliadosContenido() {
  const [servicios, setServicios] = useState<ServicioPublicado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)

  const cargar = () => {
    setCargando(true)
    setError(false)
    fetch('/api/v1/talleres/servicios-publicados')
      .then(r => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then(d => setServicios(d.servicios ?? []))
      .catch(() => setError(true))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargar() }, [])

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main>
        <section className="bg-[#0F1E35] py-16 px-5">
          <div className="mx-auto max-w-4xl text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#2BBCB8]">RODAID · Red de Talleres Aliados</span>
            <h1 className="mt-3 font-display text-4xl font-bold text-white sm:text-5xl">Servicios de Talleres Aliados</h1>
            <p className="mt-4 text-base text-white/60 max-w-2xl mx-auto">
              Los talleres de mejor desempeño de la red publican sus propios servicios. Ranking por CITs emitidos.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
          {cargando && (
            <div className="space-y-4">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-28 rounded-2xl border border-ink/10 bg-white animate-pulse" />
              ))}
            </div>
          )}

          {!cargando && error && (
            <div className="rounded-2xl border border-dashed border-clay/30 bg-white p-10 text-center">
              <p className="text-sm text-slate-warm">No pudimos cargar los servicios.</p>
              <button
                type="button"
                onClick={cargar}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#2BBCB8] hover:underline"
              >
                <RefreshCw className="size-3.5" /> Reintentar
              </button>
            </div>
          )}

          {!cargando && !error && servicios.length === 0 && (
            <div className="rounded-2xl border border-dashed border-ink/10 bg-white p-10 text-center">
              <Wrench className="mx-auto size-8 text-slate-warm/40" />
              <p className="mt-3 text-sm text-slate-warm">
                Todavía no hay talleres publicando servicios. Los Talleres Aliados con mejor desempeño aparecen acá.
              </p>
            </div>
          )}

          {!cargando && !error && servicios.length > 0 && (
            <div className="space-y-4">
              {servicios.map((s, i) => (
                <div
                  key={s.aliadoId}
                  className="rounded-2xl border border-ink/10 bg-white p-5 flex items-center gap-4 flex-wrap"
                >
                  <div className="relative size-14 shrink-0 rounded-xl overflow-hidden bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.logoUrl} alt={s.nombreTaller} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-display text-base font-semibold text-ink">{s.nombreTaller}</h3>
                      {i < 3 && <Star className="size-4 text-amber-400 fill-amber-400" />}
                    </div>
                    <p className="text-sm text-slate-warm mt-0.5">{labelServicioAliado(s.servicio)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold text-[#0F1E35]">${s.precioArs.toLocaleString('es-AR')} ARS</span>
                    {s.whatsappNumero && (
                      <a
                        href={`https://wa.me/${s.whatsappNumero}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-[#2BBCB8]/30 bg-[#2BBCB8]/5 px-3 py-1.5 text-xs font-semibold text-[#0F1E35] hover:bg-[#2BBCB8]/10"
                      >
                        <MessageCircle className="size-3 text-[#2BBCB8]" /> Contactar por WhatsApp
                      </a>
                    )}
                    {s.linkTienda && (
                      <a
                        href={s.linkTienda}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-ink/5"
                      >
                        Ver tienda <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-10 rounded-2xl bg-[#0F1E35] p-6 text-center">
            <p className="text-sm font-semibold text-[#2BBCB8] uppercase tracking-wide mb-2">¿Sos taller o proveedor?</p>
            <p className="text-sm text-white/70 mb-4">Unite a la red de aliados RODAID y llega a cientos de ciclistas verificados de Zona Este.</p>
            <Link
              href="/aliados"
              className="inline-flex items-center gap-2 rounded-full bg-[#F47B20] px-5 py-2 text-sm font-semibold text-white hover:bg-[#F47B20]/80"
            >
              Quiero ser aliado <ChevronRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
