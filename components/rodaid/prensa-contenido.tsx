'use client'

import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { useNoticias } from '@/lib/noticias'
import Link from 'next/link'
import { Newspaper, ChevronRight, Play, RefreshCw } from 'lucide-react'

const TIPO_CONFIG = {
  noticia: { label: 'Novedad', color: 'bg-[#2BBCB8]/10 text-[#2BBCB8]' },
  prensa: { label: 'Prensa', color: 'bg-[#F47B20]/10 text-[#F47B20]' },
  evento: { label: 'Evento', color: 'bg-purple-100 text-purple-600' },
}

export function PrensaContenido() {
  const { noticias, cargando, error, reintentar } = useNoticias({ soloPrensa: true })

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
        <header className="mb-10">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">RODAID</span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">Portal de Prensa</h1>
          <p className="mt-3 max-w-2xl text-base text-slate-warm">
            Comunicados oficiales y novedades de RODAID para medios y prensa.
          </p>
        </header>

        {cargando && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {[0, 1].map(i => (
              <div key={i} className="h-56 rounded-2xl border border-ink/10 bg-white animate-pulse" />
            ))}
          </div>
        )}

        {!cargando && error && (
          <div className="rounded-2xl border border-dashed border-clay/30 bg-white p-10 text-center">
            <p className="text-sm text-slate-warm">No pudimos cargar los comunicados de prensa.</p>
            <button
              type="button"
              onClick={reintentar}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#2BBCB8] hover:underline"
            >
              <RefreshCw className="size-3.5" /> Reintentar
            </button>
          </div>
        )}

        {!cargando && !error && noticias.length === 0 && (
          <div className="rounded-2xl border border-dashed border-ink/10 bg-white p-10 text-center">
            <Newspaper className="mx-auto size-8 text-slate-warm/40" />
            <p className="mt-3 text-sm text-slate-warm">Todavía no hay comunicados de prensa publicados.</p>
          </div>
        )}

        {!cargando && !error && noticias.length > 0 && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {noticias.map(n => (
              <Link
                key={n.id}
                href={`/noticias/${n.id}`}
                className="flex flex-col rounded-2xl border border-ink/10 bg-white p-6 hover:border-[#2BBCB8]/40 transition-colors"
              >
                {n.imagen_url && (
                  <div className="relative rounded-xl overflow-hidden bg-slate-100 mb-4 aspect-video">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={n.imagen_url}
                      alt={n.titulo}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {n.video_url && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <span className="flex size-10 items-center justify-center rounded-full bg-white/90">
                          <Play className="size-4 text-ink fill-ink" />
                        </span>
                      </span>
                    )}
                  </div>
                )}
                <span className={`self-start text-[10px] font-bold px-2 py-0.5 rounded-full ${TIPO_CONFIG[n.tipo].color}`}>
                  {TIPO_CONFIG[n.tipo].label}
                </span>
                <h3 className="mt-2 font-display text-base font-bold text-ink leading-snug">{n.titulo}</h3>
                <p className="mt-2 text-sm text-slate-warm leading-relaxed flex-1">{n.resumen}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#2BBCB8]">
                  Leer más <ChevronRight className="size-3" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
