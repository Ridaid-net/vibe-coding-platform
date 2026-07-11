'use client'

import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { useNoticias } from '@/lib/noticias'
import { NoticiaCard } from '@/components/rodaid/noticia-card'
import { Newspaper, RefreshCw } from 'lucide-react'

export function PrensaContenido() {
  const { noticias, cargando, error, reintentar } = useNoticias({ soloPrensa: true })

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <header className="mb-10">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">RODAID</span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">Portal de Prensa</h1>
          <p className="mt-3 max-w-2xl text-base text-slate-warm">
            Comunicados oficiales y novedades de RODAID para medios y prensa.
          </p>
        </header>

        {cargando && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-64 rounded-2xl border border-ink/10 bg-white animate-pulse" />
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
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {noticias.map(n => (
              <NoticiaCard key={n.id} noticia={n} />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
