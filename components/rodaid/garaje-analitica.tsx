'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  Bike,
  FileSignature,
  Loader2,
  MapPin,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { cargarLeaflet } from '@/lib/leaflet'
import { useAnaliticaPersonal } from '@/lib/garaje-digital'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Dashboard de Analitica Personal del Garaje (Hito 14). Metricas de
 * mantenimiento/uso del usuario y un MAPA DE CALOR PERSONAL que muestra dónde
 * fueron verificadas o auditadas sus bicis.
 *
 * Privacidad innegociable: el mapa solo dibuja el centro de celdas de ~barrio
 * (clipping) y agrega por celda con k-anonimato. Nunca expone la vivienda del
 * usuario, una coordenada exacta ni una ruta privada.
 */
export function GarajeAnalitica() {
  const { data, isLoading } = useAnaliticaPersonal()
  const m = data?.metricas

  return (
    <section className="mt-12">
      <div className="flex items-center gap-2">
        <Activity className="size-5 text-ink/60" />
        <h2 className="font-display text-2xl font-bold text-ink">
          Analítica de tu garaje
        </h2>
      </div>
      <p className="mt-1 max-w-xl text-sm text-slate-warm">
        Métricas de mantenimiento y uso de tus bicicletas. El mapa muestra dónde
        fueron verificadas, <strong>agregado por barrio</strong>: nunca tu
        ubicación exacta.
      </p>

      {/* Tarjetas de métricas */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isLoading && !data ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-ink/10 bg-white"
            />
          ))
        ) : (
          <>
            <Metrica
              titulo="Bicicletas"
              valor={m?.totalBicis ?? 0}
              detalle={`${m?.verificadas ?? 0} verificadas`}
              icono={<Bike className="size-4" />}
            />
            <Metrica
              titulo="Verificadas"
              valor={m?.verificadas ?? 0}
              detalle={
                m?.enProceso
                  ? `${m.enProceso} en proceso`
                  : `${m?.certificadosDisponibles ?? 0} certificados`
              }
              icono={<ShieldCheck className="size-4" />}
              acento="verde"
            />
            <Metrica
              titulo="Actas firmadas"
              valor={m?.actasFirmadas ?? 0}
              detalle="inspecciones"
              icono={<FileSignature className="size-4" />}
            />
            <Metrica
              titulo="Consultas"
              valor={m?.verificacionesRecibidas ?? 0}
              detalle={`${m?.verificacionesUltimos30 ?? 0} en 30 días`}
              icono={<TrendingUp className="size-4" />}
            />
          </>
        )}
      </div>

      {/* Mapa de calor personal */}
      <MapaCalorPersonal />
    </section>
  )
}

function Metrica({
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
  acento?: 'verde'
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-4">
      <div className="flex items-center gap-2 text-slate-warm">
        {icono}
        <span className="text-xs font-medium uppercase tracking-wide">
          {titulo}
        </span>
      </div>
      <div
        className={`mt-1 font-display text-3xl font-bold ${
          acento === 'verde' ? 'text-lime-deep' : 'text-ink'
        }`}
      >
        {valor.toLocaleString('es-AR')}
      </div>
      <div className="text-xs text-slate-warm">{detalle}</div>
    </div>
  )
}

/**
 * Mapa de calor personal con Leaflet. Dibuja la densidad de
 * verificaciones/auditorías de las bicis del usuario, recortada a barrio.
 */
function MapaCalorPersonal() {
  const { data } = useAnaliticaPersonal()
  const contenedorRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const capaRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const [leafletError, setLeafletError] = useState(false)

  const mapa = data?.mapa
  const puntos = mapa?.puntos ?? []

  // Inicializa el mapa una sola vez.
  useEffect(() => {
    let cancelado = false
    cargarLeaflet()
      .then((L) => {
        if (cancelado || !contenedorRef.current || mapRef.current) return
        LRef.current = L
        const centro = mapa?.centro ?? { lat: -32.8895, lon: -68.8458 }
        const map = L.map(contenedorRef.current, {
          center: [centro.lat, centro.lon],
          zoom: 12,
          scrollWheelZoom: false,
        })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
          maxZoom: 19,
        }).addTo(map)
        mapRef.current = map
        redibujar()
      })
      .catch(() => setLeafletError(true))
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const redibujar = useCallback(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    if (capaRef.current) {
      map.removeLayer(capaRef.current)
      capaRef.current = null
    }
    if (!puntos.length || !L.heatLayer) return
    const datos = puntos.map((p) => [
      p.lat,
      p.lon,
      Math.max(0.2, p.intensidad),
    ])
    capaRef.current = L.heatLayer(datos, {
      radius: 30,
      blur: 24,
      maxZoom: 15,
      gradient: {
        0.2: '#aadb2f',
        0.5: '#c8f24e',
        0.8: '#f59e0b',
        1.0: '#d8542f',
      },
    }).addTo(map)
    // Encuadra el mapa a las celdas con actividad.
    try {
      const bounds = L.latLngBounds(puntos.map((p) => [p.lat, p.lon]))
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.4), { maxZoom: 14 })
    } catch {
      // sin bounds válidos: se mantiene el centro por defecto.
    }
  }, [puntos])

  useEffect(() => {
    redibujar()
  }, [redibujar])

  const sinDatos = !!data && puntos.length === 0

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <MapPin className="size-4 text-clay" />
        <h3 className="font-display text-lg font-bold text-ink">
          Mapa de calor personal
        </h3>
      </div>

      {leafletError ? (
        <p className="mt-3 rounded-2xl border border-ink/10 bg-white px-4 py-6 text-sm text-slate-warm">
          No se pudo cargar el mapa interactivo. Tus bicicletas registran
          actividad en {puntos.length} zona(s).
        </p>
      ) : (
        <div className="relative mt-3 overflow-hidden rounded-2xl border border-ink/10">
          <div
            ref={contenedorRef}
            className="h-[360px] w-full bg-ink/5"
            aria-label="Mapa de calor personal de verificaciones"
          />
          {!data && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-paper/50">
              <Loader2 className="size-6 animate-spin text-ink/50" />
            </div>
          )}
          {sinDatos && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-paper/70 px-6 text-center">
              <p className="max-w-xs text-sm text-slate-warm">
                Todavía no hay suficientes verificaciones de tus bicis para
                dibujar el mapa. Aparecerá a medida que se las consulte.
              </p>
            </div>
          )}
        </div>
      )}

      {mapa && (
        <p className="mt-2 text-xs text-slate-warm">
          Posiciones recortadas a celdas de ~
          {Math.round(mapa.gridDeg * 111000)} m (barrio).
          {mapa.suprimidasPorKAnon > 0 &&
            ` ${mapa.suprimidasPorKAnon} zona(s) con poca actividad ocultas por privacidad.`}{' '}
          Tu ubicación exacta nunca se almacena ni se muestra.
        </p>
      )}
    </div>
  )
}
