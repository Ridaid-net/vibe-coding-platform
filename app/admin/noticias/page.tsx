'use client'
import { useState, useEffect } from 'react'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Plus, Edit3, Trash2, Eye, EyeOff, Save, X } from 'lucide-react'
import { authedFetch } from '@/lib/session'

interface Noticia {
  id: string
  titulo: string
  resumen: string
  url: string | null
  imagen_url: string | null
  fuente: string
  tipo: 'noticia' | 'prensa' | 'evento'
  activa: boolean
  orden: number
}

const TIPO_COLORS = {
  noticia: 'bg-[#2BBCB8]/10 text-[#2BBCB8]',
  prensa: 'bg-[#F47B20]/10 text-[#F47B20]',
  evento: 'bg-purple-100 text-purple-600'
}

const VACIA = { titulo: '', resumen: '', url: '', imagen_url: '', fuente: 'RODAID', tipo: 'noticia' as const, orden: 0 }

export default function AdminNoticiasPage() {
  const [noticias, setNoticias] = useState<Noticia[]>([])
  const [editando, setEditando] = useState<Partial<Noticia> | null>(null)
  const [esNueva, setEsNueva] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [cargando, setCargando] = useState(true)

  const cargar = async () => {
    setCargando(true)
    const res = await authedFetch('/api/v1/admin/noticias').then(r => r.json())
    setNoticias(res.noticias ?? [])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  const guardar = async () => {
    if (!editando?.titulo || !editando?.resumen) return
    setGuardando(true)
    try {
      if (esNueva) {
        await authedFetch('/api/v1/admin/noticias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editando)
        })
      } else {
        await authedFetch(`/api/v1/admin/noticias/${editando.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editando)
        })
      }
      setEditando(null)
      cargar()
    } finally { setGuardando(false) }
  }

  const toggleActiva = async (n: Noticia) => {
    await authedFetch(`/api/v1/admin/noticias/${n.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activa: !n.activa })
    })
    cargar()
  }

  const eliminar = async (id: string) => {
    if (!confirm('¿Eliminar esta noticia?')) return
    await authedFetch(`/api/v1/admin/noticias/${id}`, { method: 'DELETE' })
    cargar()
  }

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest text-[#F47B20]">Admin · RODAID</span>
            <h1 className="mt-2 font-display text-3xl font-bold text-[#0F1E35]">Noticias y Prensa</h1>
            <p className="mt-1 text-sm text-slate-warm">Publicá noticias que aparecen en el Garaje de los usuarios.</p>
          </div>
          <button type="button" onClick={() => { setEditando(VACIA); setEsNueva(true) }}
            className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0F1E35]/80">
            <Plus className="size-4" /> Nueva noticia
          </button>
        </div>

        {editando && (
          <div className="rounded-2xl border border-[#2BBCB8]/30 bg-white p-6 mb-6">
            <h2 className="font-display text-base font-semibold text-[#0F1E35] mb-4">
              {esNueva ? 'Nueva noticia' : 'Editar noticia'}
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-warm block mb-1">Título *</label>
                  <input type="text" value={editando.titulo ?? ''} onChange={e => setEditando({...editando, titulo: e.target.value})}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]"
                    placeholder="Título de la noticia" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-warm block mb-1">Fuente</label>
                  <input type="text" value={editando.fuente ?? ''} onChange={e => setEditando({...editando, fuente: e.target.value})}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]"
                    placeholder="Ej: Municipalidad de Junín" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-warm block mb-1">Resumen *</label>
                <textarea rows={3} value={editando.resumen ?? ''} onChange={e => setEditando({...editando, resumen: e.target.value})}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8] resize-none"
                  placeholder="Descripción breve..." />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-warm block mb-1">URL del artículo</label>
                  <input type="url" value={editando.url ?? ''} onChange={e => setEditando({...editando, url: e.target.value})}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]"
                    placeholder="https://..." />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-warm block mb-1">URL de imagen</label>
                  <input type="url" value={editando.imagen_url ?? ''} onChange={e => setEditando({...editando, imagen_url: e.target.value})}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]"
                    placeholder="https://...imagen.jpg" />
                </div>
              </div>
              {editando.imagen_url && (
                <div className="rounded-xl overflow-hidden border border-slate-100 h-32">
                  <img src={editando.imagen_url} alt="Preview" className="w-full h-full object-cover" loading="lazy" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-warm block mb-1">Tipo</label>
                  <select value={editando.tipo ?? 'noticia'} onChange={e => setEditando({...editando, tipo: e.target.value as 'noticia' | 'prensa' | 'evento'})}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]">
                    <option value="noticia">Noticia</option>
                    <option value="prensa">Prensa</option>
                    <option value="evento">Evento</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-warm block mb-1">Orden</label>
                  <input type="number" value={editando.orden ?? 0} onChange={e => setEditando({...editando, orden: parseInt(e.target.value)})}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={guardar} disabled={guardando}
                  className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  <Save className="size-4" /> {guardando ? 'Guardando...' : 'Guardar'}
                </button>
                <button type="button" onClick={() => { setEditando(null); setEsNueva(false) }}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600">
                  <X className="size-4" /> Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {cargando ? (
          <div className="text-center py-12 text-slate-warm">Cargando...</div>
        ) : noticias.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-dashed border-slate-200">
            <p className="text-slate-warm">No hay noticias aún. ¡Creá la primera!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {noticias.map(n => (
              <div key={n.id} className={`rounded-2xl border bg-white p-5 flex gap-4 ${n.activa ? 'border-ink/10' : 'border-slate-100 opacity-60'}`}>
                {n.imagen_url && (
                  <div className="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-slate-100">
                    <img src={n.imagen_url} alt={n.titulo} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TIPO_COLORS[n.tipo]}`}>{n.tipo}</span>
                    <span className="text-[10px] text-slate-warm">{n.fuente} · Orden: {n.orden}</span>
                  </div>
                  <p className="text-sm font-semibold text-[#0F1E35] truncate">{n.titulo}</p>
                  <p className="text-xs text-slate-warm mt-0.5 line-clamp-2">{n.resumen}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => toggleActiva(n)}
                    className={`flex size-8 items-center justify-center rounded-full border ${n.activa ? 'border-green-200 text-green-600' : 'border-slate-200 text-slate-400'}`}>
                    {n.activa ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  </button>
                  <button type="button" onClick={() => { setEditando(n); setEsNueva(false) }}
                    className="flex size-8 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50">
                    <Edit3 className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => eliminar(n.id)}
                    className="flex size-8 items-center justify-center rounded-full border border-red-100 text-red-500 hover:bg-red-50">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
