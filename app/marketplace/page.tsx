'use client'
import { useState, useEffect, useCallback } from 'react'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Search, SlidersHorizontal, X, ChevronDown, ShieldCheck, MapPin, Star } from 'lucide-react'
import Link from 'next/link'

interface Publicacion {
  id: string
  titulo: string
  precio: number
  moneda: string
  marca: string
  modelo: string
  anio: number | null
  tipo: string
  color: string | null
  numero_serie: string
  foto_urls: string[] | null
  cit_codigo: string
  publicado_en: string
}

const TIPOS = ['MTB', 'Ruta', 'Urbana', 'BMX', 'Gravel', 'Eléctrica', 'Plegable', 'Otra']
const MARCAS = ['Trek', 'Specialized', 'Giant', 'Scott', 'Raleigh', 'Bianchi', 'Cannondale', 'Merida', 'Otra']
const ORDEN_OPS = [
  { value: 'reciente', label: 'Más recientes' },
  { value: 'precio_asc', label: 'Menor precio' },
  { value: 'precio_desc', label: 'Mayor precio' },
]

export const metadata = undefined

export default function MarketplacePage() {
  const [publicaciones, setPublicaciones] = useState<Publicacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState('')
  const [marca, setMarca] = useState('')
  const [minPrecio, setMinPrecio] = useState('')
  const [maxPrecio, setMaxPrecio] = useState('')
  const [orden, setOrden] = useState('reciente')
  const [mostrarFiltros, setMostrarFiltros] = useState(false)
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)

  const buscar = useCallback(async (pag = 1) => {
    setCargando(true)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (tipo) params.set('tipo', tipo)
      if (marca) params.set('marca', marca)
      if (minPrecio) params.set('min', minPrecio)
      if (maxPrecio) params.set('max', maxPrecio)
      params.set('pagina', String(pag))
      params.set('limite', '12')

      const res = await fetch(`/api/v1/buscar?${params.toString()}`)
      const data = await res.json()

      let resultados = data.resultados ?? []

      // Ordenamiento client-side
      if (orden === 'precio_asc') resultados = resultados.sort((a: Publicacion, b: Publicacion) => a.precio - b.precio)
      if (orden === 'precio_desc') resultados = resultados.sort((a: Publicacion, b: Publicacion) => b.precio - a.precio)

      setPublicaciones(pag === 1 ? resultados : prev => [...prev, ...resultados])
      setTotal(data.paginacion?.total ?? 0)
      setPagina(pag)
    } finally {
      setCargando(false)
    }
  }, [q, tipo, marca, minPrecio, maxPrecio, orden])

  useEffect(() => { buscar(1) }, [buscar])

  const limpiarFiltros = () => {
    setQ(''); setTipo(''); setMarca(''); setMinPrecio(''); setMaxPrecio(''); setOrden('reciente')
  }

  const hayFiltros = q || tipo || marca || minPrecio || maxPrecio

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">

        {/* Header */}
        <div className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#F47B20]">RODAID · Marketplace</span>
          <h1 className="mt-2 font-display text-3xl font-bold text-[#0F1E35]">Bicicletas verificadas</h1>
          <p className="mt-2 text-sm text-slate-warm">Todas las bicicletas tienen CIT activo. Comprá con confianza y pago protegido.</p>
        </div>

        {/* Barra de búsqueda */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-warm" />
            <input type="text" placeholder="Buscar por marca, modelo o serie..."
              value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && buscar(1)}
              className="w-full rounded-full border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-[#2BBCB8]" />
          </div>
          <button type="button" onClick={() => setMostrarFiltros(v => !v)}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold ${mostrarFiltros ? 'bg-[#0F1E35] text-white border-[#0F1E35]' : 'border-slate-200 text-ink bg-white hover:bg-slate-50'}`}>
            <SlidersHorizontal className="size-4" /> Filtros
            {hayFiltros && <span className="flex size-4 items-center justify-center rounded-full bg-[#F47B20] text-[10px] text-white">!</span>}
          </button>
          <select value={orden} onChange={e => setOrden(e.target.value)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2BBCB8]">
            {ORDEN_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Panel de filtros */}
        {mostrarFiltros && (
          <div className="rounded-2xl border border-ink/10 bg-white p-5 mb-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-warm mb-1.5 block">Tipo</label>
                <select value={tipo} onChange={e => setTipo(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]">
                  <option value="">Todos</option>
                  {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-warm mb-1.5 block">Marca</label>
                <select value={marca} onChange={e => setMarca(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]">
                  <option value="">Todas</option>
                  {MARCAS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-warm mb-1.5 block">Precio mín. (ARS)</label>
                <input type="number" placeholder="0" value={minPrecio} onChange={e => setMinPrecio(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-warm mb-1.5 block">Precio máx. (ARS)</label>
                <input type="number" placeholder="Sin límite" value={maxPrecio} onChange={e => setMaxPrecio(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2BBCB8]" />
              </div>
            </div>
            <div className="flex justify-between mt-4 pt-4 border-t border-slate-100">
              <button type="button" onClick={limpiarFiltros}
                className="inline-flex items-center gap-1 text-xs text-slate-warm hover:text-red-500">
                <X className="size-3" /> Limpiar filtros
              </button>
              <button type="button" onClick={() => buscar(1)}
                className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-4 py-2 text-xs font-semibold text-white">
                Aplicar filtros
              </button>
            </div>
          </div>
        )}

        {/* Resultados */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-slate-warm">
            {cargando ? 'Buscando...' : `${total} bicicleta${total !== 1 ? 's' : ''} verificada${total !== 1 ? 's' : ''}`}
          </p>
          {hayFiltros && (
            <button type="button" onClick={limpiarFiltros}
              className="text-xs text-[#2BBCB8] hover:underline flex items-center gap-1">
              <X className="size-3" /> Limpiar filtros
            </button>
          )}
        </div>

        {/* Grid */}
        {cargando && publicaciones.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 animate-pulse">
                <div className="aspect-video rounded-xl bg-slate-100 mb-4" />
                <div className="h-4 bg-slate-100 rounded w-3/4 mb-2" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : publicaciones.length === 0 ? (
          <div className="text-center py-16">
            <Search className="size-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-warm font-semibold">Sin resultados</p>
            <p className="text-xs text-slate-warm/60 mt-1">Probá con otros filtros o términos de búsqueda.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {publicaciones.map(pub => (
                <Link key={pub.id} href={`/marketplace/${pub.id}`}
                  className="group rounded-2xl border border-ink/10 bg-white overflow-hidden hover:shadow-md transition-shadow">
                  <div className="aspect-video bg-slate-100 overflow-hidden">
                    {pub.foto_urls?.[0] ? (
                      <img src={pub.foto_urls[0]} alt={pub.titulo}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl">🚲</div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-display text-sm font-semibold text-[#0F1E35] leading-tight">{pub.titulo}</h3>
                      <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#2BBCB8]/10 text-[#2BBCB8]">
                        <ShieldCheck className="size-2.5" /> CIT
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-warm mb-3 flex-wrap">
                      <span>{pub.marca}</span>
                      <span>·</span>
                      <span>{pub.tipo}</span>
                      {pub.anio && <><span>·</span><span>{pub.anio}</span></>}
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="font-display text-lg font-bold text-[#0F1E35]">
                        ${pub.precio.toLocaleString('es-AR')}
                        <span className="text-xs font-normal text-slate-warm ml-1">{pub.moneda}</span>
                      </p>
                      <span className="text-xs text-slate-warm">
                        {new Date(pub.publicado_en).toLocaleDateString('es-AR')}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Ver más */}
            {publicaciones.length < total && (
              <div className="text-center mt-8">
                <button type="button" onClick={() => buscar(pagina + 1)} disabled={cargando}
                  className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-50">
                  {cargando ? 'Cargando...' : `Ver más (${total - publicaciones.length} restantes)`}
                  <ChevronDown className="size-4" />
                </button>
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
