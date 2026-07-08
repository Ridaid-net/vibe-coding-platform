'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Newspaper, ExternalLink, ChevronRight } from 'lucide-react'

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

export function NoticiasPrensaWidget() {
  const [noticias, setNoticias] = useState<Noticia[]>([])
  const [activa, setActiva] = useState(0)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    fetch('/api/v1/admin/noticias?activas=true')
      .then(r => r.json())
      .then(d => { setNoticias(d.noticias ?? []); setCargando(false) })
      .catch(() => setCargando(false))
  }, [])

  useEffect(() => {
    if (noticias.length <= 1) return
    const interval = setInterval(() => {
      setActiva(prev => (prev + 1) % noticias.length)
    }, 6000)
    return () => clearInterval(interval)
  }, [noticias.length])

  if (cargando) return (
    <div className="rounded-3xl border border-ink/10 bg-white p-6 animate-pulse h-full">
      <div className="h-5 w-40 rounded bg-slate-100 mb-4" />
      <div className="h-32 rounded-xl bg-slate-50 mb-3" />
      <div className="h-4 w-3/4 rounded bg-slate-100" />
    </div>
  )

  if (noticias.length === 0) return (
    <div className="rounded-3xl border border-dashed border-ink/10 bg-white/50 p-6 flex items-center justify-center h-full">
      <p className="text-xs text-slate-warm/50 text-center">Sin noticias publicadas aún</p>
    </div>
  )

  const noticia = noticias[activa]

  return (
    <div className="rounded-3xl border border-ink/10 bg-white p-6 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-xl bg-[#0F1E35]/5">
            <Newspaper className="size-4 text-[#0F1E35]" />
          </div>
          <span className="font-display text-sm font-semibold text-[#0F1E35]">Noticias y Prensa</span>
        </div>
        <a href="/sobre" className="text-xs text-[#2BBCB8] hover:underline flex items-center gap-1">
          Ver todo <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="flex-1 flex flex-col">
        {noticia.imagen_url && (
          <div className="rounded-xl overflow-hidden bg-slate-100 mb-4 aspect-video">
            <img src={noticia.imagen_url} alt={noticia.titulo}
              className="w-full h-full object-cover" loading="lazy" />
          </div>
        )}
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TIPO_CONFIG[noticia.tipo].color}`}>
            {TIPO_CONFIG[noticia.tipo].label}
          </span>
          <span className="text-[10px] text-slate-warm">{noticia.fuente}</span>
        </div>
        <h4 className="font-display text-sm font-bold text-[#0F1E35] leading-snug mb-2">{noticia.titulo}</h4>
        <p className="text-xs text-slate-warm leading-relaxed flex-1">{noticia.resumen}</p>
        <Link href={`/noticias/${noticia.id}`}
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#2BBCB8] hover:underline">
          Leer más <ChevronRight className="size-3" />
        </Link>
      </div>

      {noticias.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-4">
          {noticias.map((_, i) => (
            <button key={i} type="button" onClick={() => setActiva(i)}
              className={`rounded-full transition-all ${i === activa ? 'w-4 h-1.5 bg-[#0F1E35]' : 'w-1.5 h-1.5 bg-slate-200 hover:bg-slate-300'}`} />
          ))}
        </div>
      )}
    </div>
  )
}
