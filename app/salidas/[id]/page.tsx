'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { MapPin, Calendar, Route, Users, Image, MessageCircle, Send, ChevronRight, Clock } from 'lucide-react'
import { authedFetch } from '@/lib/session'

interface Salida {
  id: string
  titulo: string
  descripcion: string
  fecha: string
  hora: string
  lugar_encuentro: string
  km_recorrido: number | null
  nivel: string
  estado: string
  mapa_link: string | null
  strava_link: string | null
  garmin_link: string | null
  trailforks_link: string | null
  wikilok_link: string | null
  participantes_count: number
  fotos_count: number
}

interface Foto {
  id: string
  foto_url: string
  caption: string | null
  nombre_autor: string | null
  created_at: string
}

interface Comentario {
  id: string
  contenido: string
  nombre_autor: string | null
  created_at: string
}

const NIVEL_COLOR: Record<string, string> = {
  facil: 'bg-green-100 text-green-700',
  moderado: 'bg-amber-100 text-amber-700',
  dificil: 'bg-red-100 text-red-700',
}

export default function SalidaDetallePage() {
  const params = useParams()
  const id = params.id as string
  const [salida, setSalida] = useState<Salida | null>(null)
  const [fotos, setFotos] = useState<Foto[]>([])
  const [comentarios, setComentarios] = useState<Comentario[]>([])
  const [comentario, setComentario] = useState('')
  const [nombreInvitado, setNombreInvitado] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [cargando, setCargando] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([
      fetch(`/api/v1/salidas/${id}`).then(r => r.json()),
      fetch(`/api/v1/salidas/${id}/fotos`).then(r => r.json()),
      fetch(`/api/v1/salidas/${id}/comentarios`).then(r => r.json()),
    ]).then(([s, f, c]) => {
      setSalida(s.salida)
      setFotos(f.fotos ?? [])
      setComentarios(c.comentarios ?? [])
    }).finally(() => setCargando(false))
  }, [id])

  const enviarComentario = async () => {
    if (!comentario.trim()) return
    setEnviando(true)
    try {
      const res = await fetch(`/api/v1/salidas/${id}/comentarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contenido: comentario, nombre_autor: nombreInvitado || 'Invitado' })
      })
      const data = await res.json()
      if (data.comentario) {
        setComentarios(prev => [...prev, data.comentario])
        setComentario('')
      }
    } finally { setEnviando(false) }
  }

  const subirFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const base64 = ev.target?.result as string
      const res = await fetch(`/api/v1/salidas/${id}/fotos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto_url: base64, nombre_autor: nombreInvitado || 'Invitado' })
      })
      const data = await res.json()
      if (data.foto) setFotos(prev => [...prev, data.foto])
    }
    reader.readAsDataURL(file)
  }

  const textoWsp = salida ? encodeURIComponent(
    `🚲 *${salida.titulo}*\n📅 ${salida.fecha} · ${salida.hora}\n📍 ${salida.lugar_encuentro}\n🗺️ ${salida.km_recorrido ?? '?'} km\n\nSuma fotos y comentarios: https://rodaid.net/salidas/${id}`
  ) : ''

  if (cargando) return <div className="flex items-center justify-center min-h-screen"><p className="text-slate-warm">Cargando salida...</p></div>
  if (!salida) return <div className="flex items-center justify-center min-h-screen"><p className="text-slate-warm">Salida no encontrada.</p></div>

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        <div className="rounded-2xl border border-ink/10 bg-white p-6 mb-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${NIVEL_COLOR[salida.nivel]}`}>{salida.nivel}</span>
              <h1 className="mt-2 font-display text-2xl font-bold text-ink">{salida.titulo}</h1>
            </div>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${salida.estado === 'completada' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{salida.estado}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icono: Calendar, label: 'Fecha', val: salida.fecha },
              { icono: Clock, label: 'Hora', val: salida.hora },
              { icono: MapPin, label: 'Encuentro', val: salida.lugar_encuentro },
              { icono: Route, label: 'Recorrido', val: `${salida.km_recorrido ?? '?'} km` },
            ].map((d, i) => (
              <div key={i} className="rounded-xl bg-slate-50 p-3 text-center">
                <d.icono className="size-4 text-[#2BBCB8] mx-auto mb-1" />
                <p className="text-[10px] text-slate-warm">{d.label}</p>
                <p className="text-xs font-semibold text-ink truncate">{d.val}</p>
              </div>
            ))}
          </div>
          {salida.descripcion && <p className="mt-4 text-sm text-slate-warm leading-relaxed">{salida.descripcion}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {salida.mapa_link && <a href={salida.mapa_link} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1 rounded-full bg-blue-50 text-blue-700 hover:underline">📍 Google Maps</a>}
            {salida.strava_link && <a href={salida.strava_link} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1 rounded-full bg-orange-50 text-orange-700 hover:underline">🟠 Strava</a>}
            {salida.garmin_link && <a href={salida.garmin_link} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1 rounded-full bg-blue-50 text-blue-700 hover:underline">🔵 Garmin</a>}
            {salida.trailforks_link && <a href={salida.trailforks_link} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1 rounded-full bg-green-50 text-green-700 hover:underline">🟢 Trailforks</a>}
            {salida.wikilok_link && <a href={salida.wikilok_link} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1 rounded-full bg-teal-50 text-teal-700 hover:underline">🗺️ Wikilok</a>}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs text-slate-warm"><Users className="size-3" /> {salida.participantes_count} participantes</span>
            <span className="flex items-center gap-1 text-xs text-slate-warm"><Image className="size-3" /> {fotos.length} fotos</span>
            <span className="flex items-center gap-1 text-xs text-slate-warm"><MessageCircle className="size-3" /> {comentarios.length} comentarios</span>
          </div>
          <a href={`https://wa.me/?text=${textoWsp}`} target="_blank" rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-2 text-xs font-semibold text-white">
            <svg viewBox="0 0 24 24" className="size-3.5 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.1 1.523 5.82L0 24l6.337-1.505A11.955 11.955 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.015-1.373l-.36-.213-3.73.886.938-3.63-.235-.374A9.818 9.818 0 1112 21.818z"/></svg>
            Compartir salida
          </a>
        </div>

        {/* Nombre invitado */}
        <div className="rounded-2xl border border-ink/10 bg-white p-4 mb-4">
          <p className="text-xs font-semibold text-slate-warm mb-2">Tu nombre (para fotos y comentarios)</p>
          <input type="text" placeholder="Ej: Juan Perez" value={nombreInvitado}
            onChange={e => setNombreInvitado(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
        </div>

        {/* Fotos */}
        <div className="rounded-2xl border border-ink/10 bg-white p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-ink flex items-center gap-2"><Image className="size-4 text-[#F47B20]" /> Fotos de la salida</h2>
            <label className="inline-flex items-center gap-1 rounded-full bg-[#F47B20] px-3 py-1.5 text-xs font-semibold text-white cursor-pointer hover:bg-[#F47B20]/80">
              + Subir foto
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={subirFoto} />
            </label>
          </div>
          {fotos.length === 0 ? (
            <p className="text-sm text-slate-warm text-center py-6">Todavia no hay fotos. ¡Se el primero en subir una!</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {fotos.map(f => (
                <div key={f.id} className="rounded-xl overflow-hidden aspect-square bg-slate-100 relative group">
                  <img src={f.foto_url} alt={f.caption ?? 'Foto de la salida'} className="w-full h-full object-cover" />
                  {(f.caption || f.nombre_autor) && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                      {f.nombre_autor && <p className="text-[10px] text-white/70">{f.nombre_autor}</p>}
                      {f.caption && <p className="text-xs text-white">{f.caption}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comentarios */}
        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <h2 className="font-display text-base font-semibold text-ink flex items-center gap-2 mb-4"><MessageCircle className="size-4 text-[#2BBCB8]" /> Comentarios</h2>
          <div className="space-y-3 mb-4">
            {comentarios.length === 0 ? (
              <p className="text-sm text-slate-warm text-center py-4">Todavia no hay comentarios. Dejá el tuyo!</p>
            ) : (
              comentarios.map(c => (
                <div key={c.id} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-[#0F1E35] mb-1">{c.nombre_autor ?? 'Invitado'}</p>
                  <p className="text-sm text-slate-warm">{c.contenido}</p>
                  <p className="text-[10px] text-slate-warm/60 mt-1">{new Date(c.created_at).toLocaleString('es-AR')}</p>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input type="text" placeholder="Dejá tu comentario..." value={comentario}
              onChange={e => setComentario(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && enviarComentario()}
              className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
            <button type="button" onClick={enviarComentario} disabled={!comentario.trim() || enviando}
              className="flex size-9 items-center justify-center rounded-full bg-[#0F1E35] text-white disabled:opacity-40">
              <Send className="size-4" />
            </button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
