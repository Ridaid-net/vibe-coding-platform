'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Eye,
  Flame,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  actualizarAlerta,
  analizarAhora,
  ensureStaffSession,
  obtenerAlertas,
  obtenerMapaCalor,
  type AlertaSeguridad,
  type MapaCalor,
} from '@/lib/analitica'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Carga de Leaflet (+ heatmap) desde CDN, sin sumar dependencias al build ──

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
const LEAFLET_HEAT_JS = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js'

let leafletPromise: Promise<any> | null = null

function cargarScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`))
    document.head.appendChild(s)
  })
}

function cargarCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = href
  document.head.appendChild(l)
}

function cargarLeaflet(): Promise<any> {
  if (leafletPromise) return leafletPromise
  leafletPromise = (async () => {
    cargarCss(LEAFLET_CSS)
    await cargarScript(LEAFLET_JS)
    await cargarScript(LEAFLET_HEAT_JS)
    return (window as any).L
  })()
  return leafletPromise
}

// ── Filtros temporales ───────────────────────────────────────────────────────

const VENTANAS = [
  { dias: 7, label: 'Últimos 7 días' },
  { dias: 30, label: 'Últimos 30 días' },
  { dias: 90, label: 'Últimos 90 días' },
] as const

const SEVERIDAD_ESTILO: Record<
  AlertaSeguridad['severidad'],
  { label: string; clase: string }
> = {
  critica: { label: 'Crítica', clase: 'bg-red-100 text-red-700 border-red-200' },
  alta: { label: 'Alta', clase: 'bg-orange-100 text-orange-700 border-orange-200' },
  media: { label: 'Media', clase: 'bg-amber-100 text-amber-700 border-amber-200' },
}

/**
 * Dashboard de Inteligencia Urbana (Hito 8). Visualiza, sobre el Gran Mendoza,
 * un mapa de calor ANONIMO y AGREGADO con dos señales: densidad de consultas del
 * verificador ("curiosidad") y densidad de denuncias (puntos rojos). Incluye
 * filtros temporales y el feed de "Puntos Calientes" para el equipo de seguridad.
 *
 * Privacidad: el mapa solo muestra el centro de celdas de ~barrio (clipping).
 * Nunca la ubicación de una bici puntual ni datos de usuarios.
 */
export function AnaliticaMapa() {
  const [dias, setDias] = useState<number>(7)
  const [mapa, setMapa] = useState<MapaCalor | null>(null)
  const [alertas, setAlertas] = useState<AlertaSeguridad[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [analizando, setAnalizando] = useState(false)
  const [verConsultas, setVerConsultas] = useState(true)
  const [verDenuncias, setVerDenuncias] = useState(true)
  const [leafletError, setLeafletError] = useState(false)

  const contenedorRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const capaConsultasRef = useRef<any>(null)
  const capaDenunciasRef = useRef<any>(null)
  const LRef = useRef<any>(null)

  // Inicializa el mapa Leaflet una sola vez.
  useEffect(() => {
    let cancelado = false
    cargarLeaflet()
      .then((L) => {
        if (cancelado || !contenedorRef.current || mapRef.current) return
        LRef.current = L
        const map = L.map(contenedorRef.current, {
          center: [-32.8895, -68.8458], // Mendoza
          zoom: 12,
          scrollWheelZoom: true,
        })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
          maxZoom: 19,
        }).addTo(map)
        mapRef.current = map
        redibujar()
      })
      .catch((e) => {
        console.error(e)
        setLeafletError(true)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cargar = useCallback(async (ventanaDias: number) => {
    setCargando(true)
    setError(null)
    try {
      await ensureStaffSession()
      const [m, a] = await Promise.all([
        obtenerMapaCalor(ventanaDias),
        obtenerAlertas(),
      ])
      setMapa(m)
      setAlertas(a)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar(dias)
  }, [cargar, dias])

  // Redibuja las capas cuando cambian los datos o la visibilidad.
  const redibujar = useCallback(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return

    if (capaConsultasRef.current) {
      map.removeLayer(capaConsultasRef.current)
      capaConsultasRef.current = null
    }
    if (capaDenunciasRef.current) {
      map.removeLayer(capaDenunciasRef.current)
      capaDenunciasRef.current = null
    }
    if (!mapa) return

    const consultas = mapa.features.filter((f) => f.properties.capa === 'consultas')
    const denuncias = mapa.features.filter((f) => f.properties.capa === 'denuncias')

    if (verConsultas && consultas.length && L.heatLayer) {
      const puntos = consultas.map((f) => [
        f.geometry.coordinates[1],
        f.geometry.coordinates[0],
        Math.max(0.15, f.properties.intensidad),
      ])
      capaConsultasRef.current = L.heatLayer(puntos, {
        radius: 28,
        blur: 22,
        maxZoom: 15,
        gradient: {
          0.2: '#2563eb',
          0.4: '#22c55e',
          0.6: '#eab308',
          0.8: '#f97316',
          1.0: '#dc2626',
        },
      }).addTo(map)
    }

    if (verDenuncias && denuncias.length) {
      const grupo = L.layerGroup()
      for (const f of denuncias) {
        const [lon, lat] = f.geometry.coordinates
        L.circleMarker([lat, lon], {
          radius: 8 + Math.min(10, f.properties.total),
          color: '#b91c1c',
          fillColor: '#ef4444',
          fillOpacity: 0.55,
          weight: 2,
        })
          .bindPopup(
            `<strong>Denuncias — ${f.properties.zona}</strong><br/>` +
              `${f.properties.total} reporte(s) en esta zona`
          )
          .addTo(grupo)
      }
      grupo.addTo(map)
      capaDenunciasRef.current = grupo
    }
  }, [mapa, verConsultas, verDenuncias])

  useEffect(() => {
    redibujar()
  }, [redibujar])

  const analizar = async () => {
    setAnalizando(true)
    try {
      const r = await analizarAhora()
      toast.success('Análisis completado', {
        description: `${r.detectados} punto(s) caliente(s) — ${r.nuevos} alerta(s) nueva(s).`,
      })
      setAlertas(await obtenerAlertas())
    } catch (err) {
      toast.error('No se pudo analizar', { description: (err as Error).message })
    } finally {
      setAnalizando(false)
    }
  }

  const resolverAlerta = async (
    id: string,
    estado: 'reconocida' | 'descartada'
  ) => {
    try {
      await actualizarAlerta(id, estado)
      setAlertas((prev) => prev.filter((a) => a.id !== id))
      toast.success(
        estado === 'reconocida' ? 'Alerta reconocida' : 'Alerta descartada'
      )
    } catch (err) {
      toast.error('No se pudo actualizar', { description: (err as Error).message })
    }
  }

  const totales = mapa?.metadata.totales
  const alertasAbiertas = useMemo(
    () => alertas.filter((a) => a.estado === 'abierta'),
    [alertas]
  )

  // Resumen por zona (tabla legible y fallback si el mapa no carga).
  const porZona = useMemo(() => {
    if (!mapa) return []
    const acc = new Map<
      string,
      { zona: string; consultas: number; denuncias: number }
    >()
    for (const f of mapa.features) {
      const k = f.properties.zona
      const cur = acc.get(k) ?? { zona: k, consultas: 0, denuncias: 0 }
      if (f.properties.capa === 'consultas') cur.consultas += f.properties.total
      else cur.denuncias += f.properties.total
      acc.set(k, cur)
    }
    return [...acc.values()].sort(
      (a, b) => b.consultas + b.denuncias * 5 - (a.consultas + a.denuncias * 5)
    )
  }, [mapa])

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <ShieldAlert className="h-6 w-6 text-ink/70" />
            Mapa de Calor y Analítica de Seguridad
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink/60">
            Inteligencia urbana sobre el Gran Mendoza. Datos{' '}
            <strong>anónimos y agregados por barrio</strong>: nunca se muestra la
            ubicación de una bicicleta ni de un usuario.
          </p>
        </div>
        <button
          onClick={analizar}
          disabled={analizando}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {analizando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Flame className="h-4 w-4" />
          )}
          Analizar puntos calientes
        </button>
      </div>

      {/* Filtros temporales + capas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-ink/15 bg-paper p-1">
          {VENTANAS.map((v) => (
            <button
              key={v.dias}
              onClick={() => setDias(v.dias)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                dias === v.dias
                  ? 'bg-ink text-paper'
                  : 'text-ink/70 hover:text-ink'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2 text-ink/70">
            <input
              type="checkbox"
              checked={verConsultas}
              onChange={(e) => setVerConsultas(e.target.checked)}
              className="accent-emerald-600"
            />
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-full bg-gradient-to-r from-blue-500 via-yellow-400 to-red-600" />
              Curiosidad (consultas)
            </span>
          </label>
          <label className="inline-flex items-center gap-2 text-ink/70">
            <input
              type="checkbox"
              checked={verDenuncias}
              onChange={(e) => setVerDenuncias(e.target.checked)}
              className="accent-red-600"
            />
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
              Denuncias
            </span>
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tarjetas de resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Resumen
          titulo="Consultas"
          valor={totales?.consultas ?? 0}
          detalle={`${totales?.celdasConsultas ?? 0} barrios`}
          icono={<Eye className="h-4 w-4" />}
        />
        <Resumen
          titulo="Denuncias"
          valor={totales?.denuncias ?? 0}
          detalle={`${totales?.celdasDenuncias ?? 0} barrios`}
          icono={<MapPin className="h-4 w-4" />}
          acento="rojo"
        />
        <Resumen
          titulo="Puntos calientes"
          valor={alertasAbiertas.length}
          detalle="abiertos"
          icono={<Flame className="h-4 w-4" />}
          acento="naranja"
        />
        <Resumen
          titulo="Ventana"
          valor={dias}
          detalle="días analizados"
          icono={<RefreshCw className="h-4 w-4" />}
        />
      </div>

      {/* Mapa + alertas */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {leafletError ? (
            <FallbackTabla porZona={porZona} />
          ) : (
            <div className="relative overflow-hidden rounded-2xl border border-ink/10 shadow-sm">
              <div
                ref={contenedorRef}
                className="h-[460px] w-full bg-ink/5"
                aria-label="Mapa de calor de seguridad de Mendoza"
              />
              {cargando && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-paper/40">
                  <Loader2 className="h-6 w-6 animate-spin text-ink/60" />
                </div>
              )}
            </div>
          )}
          {mapa && (
            <p className="mt-2 text-xs text-ink/50">
              {!mapa.features.some((f) => f.properties.capa === 'consultas') &&
                'Aún no hay actividad registrada en esta ventana. '}
              Posiciones recortadas a celdas de ~
              {Math.round(mapa.metadata.gridDeg * 111000)} m (barrio/manzana).
              Generado {new Date(mapa.metadata.generadoEn).toLocaleString('es-AR')}
              .
            </p>
          )}
        </div>

        {/* Feed de alertas */}
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Alertas para seguridad
          </h2>
          {alertasAbiertas.length === 0 ? (
            <div className="rounded-xl border border-ink/10 bg-paper px-4 py-6 text-center text-sm text-ink/50">
              Sin puntos calientes abiertos. La zona está tranquila.
            </div>
          ) : (
            <ul className="space-y-2">
              {alertasAbiertas.map((a) => (
                <li
                  key={a.id}
                  className="rounded-xl border border-ink/10 bg-paper p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                            SEVERIDAD_ESTILO[a.severidad].clase
                          }`}
                        >
                          {SEVERIDAD_ESTILO[a.severidad].label}
                        </span>
                        <span className="text-sm font-semibold text-ink">
                          {a.zona}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink/60">
                        {a.volumen} consultas en {a.ventanaHoras}h (umbral{' '}
                        {a.umbral}).
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => resolverAlerta(a.id, 'reconocida')}
                      className="inline-flex items-center gap-1 rounded-full bg-ink/90 px-3 py-1 text-xs font-medium text-paper hover:bg-ink"
                    >
                      <Check className="h-3 w-3" /> Reconocer
                    </button>
                    <button
                      onClick={() => resolverAlerta(a.id, 'descartada')}
                      className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-3 py-1 text-xs font-medium text-ink/70 hover:text-ink"
                    >
                      <X className="h-3 w-3" /> Descartar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Ranking por zona — lectura rápida para autoridades */}
          {porZona.length > 0 && (
            <div className="rounded-xl border border-ink/10 bg-paper p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">
                Actividad por zona
              </h3>
              <ul className="space-y-1.5">
                {porZona.slice(0, 6).map((z) => (
                  <li
                    key={z.zona}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-ink/80">{z.zona}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-ink/60">{z.consultas} consultas</span>
                      {z.denuncias > 0 && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
                          {z.denuncias} denuncia(s)
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Resumen({
  titulo,
  valor,
  detalle,
  icono,
  acento,
}: {
  titulo: string
  valor: number
  detalle: string
  icono: React.ReactNode
  acento?: 'rojo' | 'naranja'
}) {
  const color =
    acento === 'rojo'
      ? 'text-red-600'
      : acento === 'naranja'
        ? 'text-orange-600'
        : 'text-ink'
  return (
    <div className="rounded-xl border border-ink/10 bg-paper p-4 shadow-sm">
      <div className="flex items-center gap-2 text-ink/50">
        {icono}
        <span className="text-xs font-medium uppercase tracking-wide">
          {titulo}
        </span>
      </div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>
        {valor.toLocaleString('es-AR')}
      </div>
      <div className="text-xs text-ink/50">{detalle}</div>
    </div>
  )
}

function FallbackTabla({
  porZona,
}: {
  porZona: { zona: string; consultas: number; denuncias: number }[]
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-paper p-4 shadow-sm">
      <p className="mb-3 text-sm text-ink/60">
        No se pudo cargar el mapa interactivo. Mostrando la actividad agregada por
        zona (anónima):
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink/50">
            <th className="py-2">Zona</th>
            <th className="py-2 text-right">Consultas</th>
            <th className="py-2 text-right">Denuncias</th>
          </tr>
        </thead>
        <tbody>
          {porZona.map((z) => (
            <tr key={z.zona} className="border-b border-ink/5">
              <td className="py-2 text-ink/80">{z.zona}</td>
              <td className="py-2 text-right text-ink/70">{z.consultas}</td>
              <td className="py-2 text-right text-red-600">{z.denuncias}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
