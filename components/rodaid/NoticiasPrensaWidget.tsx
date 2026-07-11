'use client'
import Link from 'next/link'
import { Newspaper, ExternalLink, RefreshCw } from 'lucide-react'
import { useNoticias } from '@/lib/noticias'
import { NoticiaCard } from './noticia-card'

export function NoticiasPrensaWidget() {
  const { noticias, cargando, error, reintentar } = useNoticias()

  if (cargando) return (
    <div className="rounded-3xl border border-ink/10 bg-white p-6 animate-pulse h-full">
      <div className="h-5 w-40 rounded bg-slate-100 mb-4" />
      <div className="flex gap-4">
        <div className="h-40 w-64 shrink-0 rounded-xl bg-slate-50" />
        <div className="h-40 w-64 shrink-0 rounded-xl bg-slate-50" />
      </div>
    </div>
  )

  if (error) return (
    <div className="rounded-3xl border border-dashed border-clay/30 bg-white/50 p-6 flex flex-col items-center justify-center gap-2 h-full text-center">
      <p className="text-xs text-slate-warm/70">No pudimos cargar las noticias.</p>
      <button
        type="button"
        onClick={reintentar}
        className="inline-flex items-center gap-1 text-xs font-semibold text-[#2BBCB8] hover:underline"
      >
        <RefreshCw className="size-3" /> Reintentar
      </button>
    </div>
  )

  if (noticias.length === 0) return (
    <div className="rounded-3xl border border-dashed border-ink/10 bg-white/50 p-6 flex items-center justify-center h-full">
      <p className="text-xs text-slate-warm/50 text-center">Sin noticias publicadas aún</p>
    </div>
  )

  return (
    <div className="rounded-3xl border border-ink/10 bg-white p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-xl bg-[#0F1E35]/5">
            <Newspaper className="size-4 text-[#0F1E35]" />
          </div>
          <span className="font-display text-sm font-semibold text-[#0F1E35]">Noticias y Prensa</span>
        </div>
        <Link href="/prensa" className="text-xs text-[#2BBCB8] hover:underline flex items-center gap-1">
          Ver todo <ExternalLink className="size-3" />
        </Link>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
        {noticias.map(n => (
          <NoticiaCard key={n.id} noticia={n} className="w-64 shrink-0 snap-start" />
        ))}
      </div>
    </div>
  )
}
