'use client'
import { useState, useEffect } from 'react'
import { Route, Calendar, MapPin, Users, Image, MessageCircle, ChevronRight, Navigation, Clock } from 'lucide-react'
import { authedFetch } from '@/lib/session'
import Link from 'next/link'

interface Salida {
  id: string
  titulo: string
  fecha: string
  hora: string
  lugar_encuentro: string
  km_recorrido: number | null
  nivel: string
  estado: string
  participantes_count: number
  fotos_count: number
  comentarios_count: number
  trackeo_url: string | null
}

const NIVEL_COLOR: Record<string, string> = {
  facil: 'bg-green-100 text-green-700',
  moderado: 'bg-amber-100 text-amber-700',
  dificil: 'bg-red-100 text-red-700',
}

const ESTADO_COLOR: Record<string, string> = {
  proxima: 'bg-blue-100 text-blue-700',
  en_curso: 'bg-[#F47B20]/10 text-[#F47B20]',
  completada: 'bg-green-100 text-green-700',
  archivada: 'bg-slate-100 text-slate-500',
}

export function MisSalidas() {
  const [salidas, setSalidas] = useState<Salida[]>([])
  const [cargando, setCargando] = useState(true)
  const [expandido, setExpandido] = useState(false)

  useEffect(() => {
    authedFetch('/api/v1/salidas')
      .then(r => r.json())
      .then(data => setSalidas(data.salidas ?? []))
      .catch(() => undefined)
      .finally(() => setCargando(false))
  }, [])

  if (cargando) return null
  if (salidas.length === 0) return null

  const visibles = expandido ? salidas : salidas.slice(0, 3)

  return (
    <div className="rounded-2xl border border-[#2BBCB8]/30 bg-teal-50 p-5 mt-4">
      <button type="button" onClick={() => setExpandido(v => !v)} className="w-full flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#2BBCB8]">
            <Route className="size-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-[#0F1E35]">Mis Salidas Grupales</p>
            <p className="text-xs text-teal-700">{salidas.length} salida{salidas.length !== 1 ? 's' : ''} organizadas</p>
          </div>
        </div>
        <ChevronRight className={`size-4 text-teal-600 transition-transform ${expandido ? 'rotate-90' : ''}`} />
      </button>

      <div className="space-y-3">
        {visibles.map(s => (
          <div key={s.id} className="rounded-xl bg-white border border-teal-100 p-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${NIVEL_COLOR[s.nivel]}`}>{s.nivel}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ESTADO_COLOR[s.estado]}`}>{s.estado}</span>
                </div>
                <p className="text-sm font-semibold text-[#0F1E35] mt-1 truncate">{s.titulo}</p>
                <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-warm">
                  <span className="flex items-center gap-1"><Calendar className="size-3" />{s.fecha}</span>
                  <span className="flex items-center gap-1"><Clock className="size-3" />{s.hora}</span>
                  <span className="flex items-center gap-1"><MapPin className="size-3" />{s.lugar_encuentro}</span>
                  {s.km_recorrido && <span className="flex items-center gap-1"><Route className="size-3" />{s.km_recorrido} km</span>}
                </div>
                <div className="flex gap-3 mt-2 text-xs text-slate-warm">
                  <span className="flex items-center gap-1"><Users className="size-3" />{s.participantes_count}</span>
                  <span className="flex items-center gap-1"><Image className="size-3" />{s.fotos_count}</span>
                  <span className="flex items-center gap-1"><MessageCircle className="size-3" />{s.comentarios_count}</span>
                  {s.trackeo_url && <span className="flex items-center gap-1 text-[#2BBCB8]"><Navigation className="size-3" />GPX</span>}
                </div>
              </div>
              <Link href={`/salidas/${s.id}`}
                className="shrink-0 inline-flex items-center gap-1 rounded-full bg-[#0F1E35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0F1E35]/80">
                Ver <ChevronRight className="size-3" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      {salidas.length > 3 && (
        <button type="button" onClick={() => setExpandido(v => !v)}
          className="mt-3 w-full text-center text-xs font-semibold text-teal-700 hover:underline">
          {expandido ? 'Ver menos' : `Ver todas (${salidas.length})`}
        </button>
      )}
    </div>
  )
}
