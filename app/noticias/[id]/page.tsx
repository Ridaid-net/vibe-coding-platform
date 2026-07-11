'use client'
import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Newspaper, RefreshCw } from 'lucide-react'
import { useNoticias } from '@/lib/noticias'
import { extraerEmbedSeguro } from '@/lib/noticias-embed'

const TIPO_CONFIG = {
  noticia: { label: 'Novedad', color: 'bg-[#2BBCB8]/10 text-[#2BBCB8]' },
  prensa: { label: 'Prensa', color: 'bg-[#F47B20]/10 text-[#F47B20]' },
  evento: { label: 'Evento', color: 'bg-purple-100 text-purple-600' },
}

function VolverAlGaraje() {
  return (
    <Link
      href="/garaje"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-warm hover:text-ink"
    >
      <ArrowLeft className="size-4" />
      Volver a mi Garaje
    </Link>
  )
}

export default function NoticiaPage() {
  const params = useParams<{ id: string }>()
  const { noticias, cargando, error, reintentar } = useNoticias()
  const noticia = noticias.find((n) => n.id === params.id) ?? null
  const embed = useMemo(
    () => (noticia?.video_url ? extraerEmbedSeguro(noticia.video_url) : null),
    [noticia?.video_url]
  )

  if (cargando) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 animate-pulse">
        <div className="h-6 w-32 rounded bg-slate-100 mb-8" />
        <div className="h-72 rounded-2xl bg-slate-50 mb-6" />
        <div className="h-8 w-3/4 rounded bg-slate-100 mb-3" />
        <div className="h-4 w-full rounded bg-slate-100 mb-2" />
        <div className="h-4 w-5/6 rounded bg-slate-100" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Newspaper className="mx-auto size-10 text-slate-warm/40" />
        <h1 className="mt-4 font-display text-xl font-bold text-ink">
          No pudimos cargar esta noticia
        </h1>
        <button
          type="button"
          onClick={reintentar}
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[#2BBCB8] hover:underline"
        >
          <RefreshCw className="size-4" />
          Reintentar
        </button>
        <div className="mt-4">
          <VolverAlGaraje />
        </div>
      </main>
    )
  }

  if (!noticia) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Newspaper className="mx-auto size-10 text-slate-warm/40" />
        <h1 className="mt-4 font-display text-xl font-bold text-ink">
          No encontramos esta noticia
        </h1>
        <div className="mt-6 flex justify-center">
          <VolverAlGaraje />
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <VolverAlGaraje />

      <div className="mt-6 flex items-center gap-2">
        <span
          className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${TIPO_CONFIG[noticia.tipo].color}`}
        >
          {TIPO_CONFIG[noticia.tipo].label}
        </span>
        <span className="text-xs text-slate-warm">{noticia.fuente}</span>
      </div>

      <h1 className="mt-3 font-display text-3xl font-bold leading-tight text-[#0F1E35]">
        {noticia.titulo}
      </h1>

      {noticia.imagen_url && (
        <div className="mt-6 overflow-hidden rounded-2xl bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={noticia.imagen_url}
            alt={noticia.titulo}
            className="w-full object-cover"
          />
        </div>
      )}

      <p className="mt-6 text-base leading-relaxed text-slate-warm">
        {noticia.resumen}
      </p>

      {embed && (
        <div className="mt-6 overflow-hidden rounded-2xl bg-slate-950 aspect-video">
          <iframe
            src={embed.embedUrl}
            title={noticia.titulo}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        </div>
      )}

      {noticia.url && (
        <a
          href={noticia.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex items-center gap-1.5 rounded-full bg-[#0F1E35] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0F1E35]/90"
        >
          Ver fuente original
          <ExternalLink className="size-3.5" />
        </a>
      )}

      <div className="mt-10 border-t border-ink/10 pt-6">
        <VolverAlGaraje />
      </div>
    </main>
  )
}
