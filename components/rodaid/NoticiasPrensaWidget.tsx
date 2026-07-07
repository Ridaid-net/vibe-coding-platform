'use client'
import { useState, useEffect } from 'react'
import { Newspaper, ExternalLink, ChevronRight } from 'lucide-react'

interface Noticia {
  id: string
  titulo: string
  resumen: string
  url: string
  fuente: string
  fecha: string
  tipo: 'noticia' | 'prensa' | 'evento'
}

// Noticias hardcodeadas hasta tener un CMS o feed RSS
const NOTICIAS_RODAID: Noticia[] = [
  {
    id: '1',
    titulo: 'RODAID presenta su API Gubernamental Multi-Tenant',
    resumen: 'La plataforma integra 9 endpoints para el Ministerio de Seguridad, MPF y municipios de Mendoza bajo el estándar EDI X-Road.',
    url: 'https://rodaid.net/sobre',
    fuente: 'RODAID · Blog',
    fecha: '2026-07-07',
    tipo: 'noticia',
  },
  {
    id: '2',
    titulo: 'Intendente Mario Abed valida RODAID en Junín',
    resumen: 'El Municipio de Junín propone fortalecer la Ley 9556 y crear un puente con el Ministerio de Seguridad para interoperabilidad policial.',
    url: 'https://rodaid.net/sobre',
    fuente: 'Municipalidad de Junín',
    fecha: '2026-06-15',
    tipo: 'prensa',
  },
  {
    id: '3',
    titulo: 'CIT blockchain: la identidad digital de tu bicicleta',
    resumen: 'Cada certificado queda anclado en la Blockchain Federal Argentina con hash SHA-256, garantizando trazabilidad e inmutabilidad.',
    url: 'https://rodaid.net/verificar',
    fuente: 'RODAID · Novedades',
    fecha: '2026-06-01',
    tipo: 'noticia',
  },
]

const TIPO_CONFIG = {
  noticia: { label: 'Novedad', color: 'bg-[#2BBCB8]/10 text-[#2BBCB8]' },
  prensa: { label: 'Prensa', color: 'bg-[#F47B20]/10 text-[#F47B20]' },
  evento: { label: 'Evento', color: 'bg-purple-100 text-purple-600' },
}

export function NoticiasPrensaWidget() {
  const [activa, setActiva] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setActiva(prev => (prev + 1) % NOTICIAS_RODAID.length)
    }, 6000)
    return () => clearInterval(interval)
  }, [])

  const noticia = NOTICIAS_RODAID[activa]

  return (
    <div className="rounded-3xl border border-ink/10 bg-white p-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-xl bg-[#0F1E35]/5">
            <Newspaper className="size-4 text-[#0F1E35]" />
          </div>
          <span className="font-display text-sm font-semibold text-[#0F1E35]">Noticias y Prensa</span>
        </div>
        <a href="https://rodaid.net/sobre" target="_blank" rel="noopener noreferrer"
          className="text-xs text-[#2BBCB8] hover:underline flex items-center gap-1">
          Ver todo <ExternalLink className="size-3" />
        </a>
      </div>

      {/* Noticia activa */}
      <div className="flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TIPO_CONFIG[noticia.tipo].color}`}>
              {TIPO_CONFIG[noticia.tipo].label}
            </span>
            <span className="text-[10px] text-slate-warm">
              {new Date(noticia.fecha).toLocaleDateString('es-AR')}
            </span>
          </div>
          <h4 className="font-display text-sm font-bold text-[#0F1E35] leading-snug mb-2">
            {noticia.titulo}
          </h4>
          <p className="text-xs text-slate-warm leading-relaxed">
            {noticia.resumen}
          </p>
        </div>

        <div className="mt-4">
          <a href={noticia.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#2BBCB8] hover:underline">
            Leer más <ChevronRight className="size-3" />
          </a>
          <p className="text-[10px] text-slate-warm/60 mt-1">{noticia.fuente}</p>
        </div>
      </div>

      {/* Indicadores */}
      <div className="flex items-center justify-center gap-1.5 mt-5">
        {NOTICIAS_RODAID.map((_, i) => (
          <button key={i} type="button" onClick={() => setActiva(i)}
            className={`rounded-full transition-all ${i === activa ? 'w-4 h-1.5 bg-[#0F1E35]' : 'w-1.5 h-1.5 bg-slate-200 hover:bg-slate-300'}`} />
        ))}
      </div>
    </div>
  )
}
