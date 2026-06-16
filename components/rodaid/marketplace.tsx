'use client'

import { ListingCard, type Publicacion } from './listing-card'
import { Search, SlidersHorizontal, X, Loader2, Bike } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface Faceta {
  valor: string
  conteo: number
}
interface RangoPrecio {
  etiqueta: string
  min: number
  max: number
  conteo: number
}
interface ApiResponse {
  publicaciones: Publicacion[]
  total: number
  pagina: number
  paginas: number
  tiempoMs: number
  facetas: {
    marcas: Faceta[]
    tipos: Faceta[]
    rangosPrecio: RangoPrecio[]
    totalActivas: number
  }
}

const ORDENES = [
  { value: 'recientes', label: 'Más recientes' },
  { value: 'precio_asc', label: 'Precio: menor a mayor' },
  { value: 'precio_desc', label: 'Precio: mayor a menor' },
  { value: 'vistas', label: 'Más vistas' },
] as const

const LIMITE = 12

export function Marketplace() {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [marcas, setMarcas] = useState<string[]>([])
  const [tipo, setTipo] = useState<string | null>(null)
  const [rango, setRango] = useState<RangoPrecio | null>(null)
  const [orden, setOrden] = useState<string>('recientes')
  const [pagina, setPagina] = useState(1)

  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Keep facets from the last success so filter chips don't flicker on reload.
  const [facetas, setFacetas] = useState<ApiResponse['facetas'] | null>(null)

  // Debounce the free-text query.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 350)
    return () => clearTimeout(id)
  }, [q])

  // Any filter change returns to the first page.
  useEffect(() => {
    setPagina(1)
  }, [debouncedQ, marcas, tipo, rango, orden])

  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      pagina: String(pagina),
      limite: String(LIMITE),
      orden,
    })
    if (debouncedQ) params.set('q', debouncedQ)
    if (marcas.length) params.set('marca', marcas.join(','))
    if (tipo) params.set('tipo', tipo)
    if (rango) {
      params.set('precio_min', String(rango.min))
      params.set('precio_max', String(rango.max))
    }

    try {
      const res = await fetch(`/api/v1/marketplace?${params.toString()}`, {
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = (await res.json()) as ApiResponse
      setData(json)
      setFacetas(json.facetas)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(
        'No pudimos cargar las publicaciones en este momento. Probá de nuevo en unos segundos.'
      )
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [debouncedQ, marcas, tipo, rango, orden, pagina])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  const toggleMarca = (valor: string) =>
    setMarcas((prev) =>
      prev.includes(valor) ? prev.filter((m) => m !== valor) : [...prev, valor]
    )

  const activeFilters =
    marcas.length + (tipo ? 1 : 0) + (rango ? 1 : 0) + (debouncedQ ? 1 : 0)

  const clearAll = () => {
    setQ('')
    setMarcas([])
    setTipo(null)
    setRango(null)
  }

  const meta = useMemo(() => {
    if (loading && !data) return 'Buscando publicaciones…'
    if (!data) return ''
    const n = data.total
    const base = `${n.toLocaleString('es-AR')} ${n === 1 ? 'bicicleta' : 'bicicletas'}`
    return `${base} · ${data.tiempoMs} ms`
  }, [data, loading])

  return (
    <section id="comprar" className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            El marketplace
          </span>
          <h2 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            Encontrá tu próxima bici
          </h2>
        </div>
        <p className="text-sm text-slate-warm">{meta}</p>
      </div>

      {/* Search + sort */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-warm" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscá por marca, modelo o número de serie…"
            className="h-13 w-full rounded-full border border-ink/15 bg-white py-3.5 pl-12 pr-4 text-base text-ink outline-none transition-colors placeholder:text-slate-warm/70 focus:border-ink/40 focus:ring-4 focus:ring-lime/30"
          />
        </div>
        <div className="relative">
          <SlidersHorizontal className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-warm" />
          <select
            value={orden}
            onChange={(e) => setOrden(e.target.value)}
            className="h-13 w-full appearance-none rounded-full border border-ink/15 bg-white py-3.5 pl-11 pr-10 text-sm font-medium text-ink outline-none focus:border-ink/40 focus:ring-4 focus:ring-lime/30 sm:w-64"
          >
            {ORDENES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Facet chips */}
      {facetas && (
        <div className="mt-6 space-y-3">
          {facetas.marcas.length > 0 && (
            <ChipRow label="Marca">
              {facetas.marcas.slice(0, 10).map((m) => (
                <Chip
                  key={m.valor}
                  active={marcas.includes(m.valor)}
                  onClick={() => toggleMarca(m.valor)}
                >
                  {m.valor}
                  <span className="ml-1 opacity-50">{m.conteo}</span>
                </Chip>
              ))}
            </ChipRow>
          )}

          {facetas.tipos.length > 0 && (
            <ChipRow label="Tipo">
              {facetas.tipos.slice(0, 8).map((t) => (
                <Chip
                  key={t.valor}
                  active={tipo === t.valor}
                  onClick={() => setTipo(tipo === t.valor ? null : t.valor)}
                >
                  {t.valor}
                  <span className="ml-1 opacity-50">{t.conteo}</span>
                </Chip>
              ))}
            </ChipRow>
          )}

          {facetas.rangosPrecio.some((r) => r.conteo > 0) && (
            <ChipRow label="Precio">
              {facetas.rangosPrecio.map((r) => (
                <Chip
                  key={r.etiqueta}
                  active={rango?.etiqueta === r.etiqueta}
                  disabled={r.conteo === 0}
                  onClick={() =>
                    setRango(rango?.etiqueta === r.etiqueta ? null : r)
                  }
                >
                  {r.etiqueta}
                </Chip>
              ))}
            </ChipRow>
          )}

          {activeFilters > 0 && (
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-clay hover:underline"
            >
              <X className="size-3.5" />
              Limpiar filtros ({activeFilters})
            </button>
          )}
        </div>
      )}

      {/* Results */}
      <div className="mt-10">
        {error ? (
          <ErrorState onRetry={load} message={error} />
        ) : loading && !data ? (
          <SkeletonGrid />
        ) : data && data.publicaciones.length === 0 ? (
          <EmptyState hasFilters={activeFilters > 0} onClear={clearAll} />
        ) : (
          <>
            <div
              className={`grid grid-cols-1 gap-5 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${
                loading ? 'opacity-50' : 'opacity-100'
              }`}
            >
              {data?.publicaciones.map((pub) => (
                <ListingCard key={pub.id} pub={pub} />
              ))}
            </div>

            {data && data.paginas > 1 && (
              <Pagination
                pagina={data.pagina}
                paginas={data.paginas}
                onChange={(p) => {
                  setPagina(p)
                  document
                    .getElementById('comprar')
                    ?.scrollIntoView({ behavior: 'smooth' })
                }}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}

function ChipRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-warm">
        {label}
      </span>
      {children}
    </div>
  )
}

function Chip({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-ink/15 bg-white text-ink hover:border-ink/40'
      }`}
    >
      {children}
    </button>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl border border-ink/10 bg-white"
        >
          <div className="aspect-[4/3] animate-pulse bg-paper-dim" />
          <div className="space-y-3 p-4">
            <div className="h-3 w-1/2 animate-pulse rounded bg-paper-dim" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-paper-dim" />
            <div className="h-7 w-2/3 animate-pulse rounded bg-paper-dim" />
            <div className="h-10 w-full animate-pulse rounded-full bg-paper-dim" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean
  onClear: () => void
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-ink/20 bg-white/50 px-6 py-20 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-lime/20 text-ink">
        <Bike className="size-8" />
      </div>
      <h3 className="mt-5 font-display text-2xl font-bold text-ink">
        {hasFilters
          ? 'Nada coincide con esos filtros'
          : 'Todavía no hay bicis publicadas'}
      </h3>
      <p className="mt-2 max-w-md text-sm text-slate-warm">
        {hasFilters
          ? 'Probá ampliar la búsqueda o quitar algún filtro para ver más resultados.'
          : 'Sé el primero en publicar. Verificamos la identidad de tu bici y la mostramos acá.'}
      </p>
      {hasFilters ? (
        <button
          onClick={onClear}
          className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
        >
          Limpiar filtros
        </button>
      ) : (
        <a
          href="#vender"
          className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
        >
          Publicar mi bici
        </a>
      )}
    </div>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-clay/30 bg-clay/5 px-6 py-20 text-center">
      <h3 className="font-display text-xl font-bold text-ink">
        Algo salió mal
      </h3>
      <p className="mt-2 max-w-md text-sm text-slate-warm">{message}</p>
      <button
        onClick={onRetry}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
      >
        <Loader2 className="size-4" />
        Reintentar
      </button>
    </div>
  )
}

function Pagination({
  pagina,
  paginas,
  onChange,
}: {
  pagina: number
  paginas: number
  onChange: (p: number) => void
}) {
  const pages = Array.from({ length: paginas }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === paginas || Math.abs(p - pagina) <= 1
  )

  return (
    <nav className="mt-12 flex items-center justify-center gap-1.5">
      <button
        onClick={() => onChange(pagina - 1)}
        disabled={pagina <= 1}
        className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-ink/40 disabled:opacity-40"
      >
        Anterior
      </button>
      {pages.map((p, i) => {
        const prev = pages[i - 1]
        return (
          <span key={p} className="flex items-center gap-1.5">
            {prev && p - prev > 1 && (
              <span className="px-1 text-slate-warm">…</span>
            )}
            <button
              onClick={() => onChange(p)}
              aria-current={p === pagina}
              className={`size-9 rounded-full text-sm font-semibold transition-colors ${
                p === pagina
                  ? 'bg-ink text-paper'
                  : 'border border-ink/15 bg-white text-ink hover:border-ink/40'
              }`}
            >
              {p}
            </button>
          </span>
        )
      })}
      <button
        onClick={() => onChange(pagina + 1)}
        disabled={pagina >= paginas}
        className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-ink/40 disabled:opacity-40"
      >
        Siguiente
      </button>
    </nav>
  )
}
