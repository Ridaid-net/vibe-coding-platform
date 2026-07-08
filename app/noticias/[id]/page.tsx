'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Newspaper } from 'lucide-react'

interface Noticia {
  id: string
  titulo: string
  resumen: string
  url: string | null
  imagen_url: string | null
  fuente: string
  tipo: 'noticia' | 'prensa' | 'evento'
}

const TIPO_CONFIG = {
  noticia: { label: 'Novedad', color: 'bg-[#2BBCB8]/10 text-[#2BBCB8]' },
  prensa: { label: 'Prensa', color: 'bg-[#F47B20]/10 text-[#F47B20]' },
  evento: { label: 'Evento', color: 'bg-purple-100 text-purple-600' },
}

export default function NoticiaPage() {
  const params = useParams<{ id: string }>()
  const [noticia, setNoticia] = useState<Noticia | null>(null)
  const [cargando, setCargando] = useState(true)
  const [noEncontrada, setNoEncontrada] = useState(false)

  useEffect(() => {
    fetch('/api/v1/admin/noticias?activas=true')
      .then((r) => r.json())
      .then((d) => {
        const encontrada = (d.noticias ?? []).find((n: Noticia) => n.id === params.id)
        if (encontrada) setNoticia(encontrada)
        else setNoEncontrada(true)
        setCargando(false)
      })
      .catch(() => {
        setNoEncontrada(true)
        setCargando(false)
      })
  }, [params.id])

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

  if (noEncontrada || !noticia) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Newspaper className="mx-auto size-10 text-slate-warm/40" />
        <h1 className="mt-4 font-display text-xl font-bold text-ink">
          No encontramos esta noticia
        </h1>
        <Link
          href="/garaje"
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[#2BBCB8] hover:underline"
        >
          <ArrowLeft className="size-4" />
          Volver al Garaje
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/garaje"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-warm hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Volver al Garaje
      </Link>

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
    </main>
  )
}