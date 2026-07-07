'use client'
import { useState, useEffect } from 'react'
import { Cloud, Sun, CloudRain, CloudSnow, Wind, Droplets, Thermometer, MapPin, RefreshCw } from 'lucide-react'

interface Pronostico {
  fecha: string
  temp_max: number
  temp_min: number
  descripcion: string
  codigo_clima: number
  humedad: number
  viento_kmh: number
  probabilidad_lluvia: number
}

interface PronosticoData {
  ciudad: string
  lat: number
  lon: number
  pronostico: Pronostico[]
}

function IconoClima({ codigo }: { codigo: number }) {
  if (codigo >= 200 && codigo < 300) return <CloudRain className="size-5 text-blue-500" />
  if (codigo >= 300 && codigo < 600) return <CloudRain className="size-5 text-blue-400" />
  if (codigo >= 600 && codigo < 700) return <CloudSnow className="size-5 text-blue-200" />
  if (codigo >= 700 && codigo < 800) return <Cloud className="size-5 text-slate-400" />
  if (codigo === 800) return <Sun className="size-5 text-amber-400" />
  return <Cloud className="size-5 text-slate-300" />
}

function colorApto(prob_lluvia: number, viento: number): string {
  if (prob_lluvia > 60 || viento > 40) return 'bg-red-50 border-red-200 text-red-700'
  if (prob_lluvia > 30 || viento > 25) return 'bg-amber-50 border-amber-200 text-amber-700'
  return 'bg-green-50 border-green-200 text-green-700'
}

function etiquetaApto(prob_lluvia: number, viento: number): string {
  if (prob_lluvia > 60 || viento > 40) return '❌ No recomendado'
  if (prob_lluvia > 30 || viento > 25) return '⚠️ Con precaución'
  return '✅ Ideal para salir'
}

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export function PronosticoTiempo() {
  const [data, setData] = useState<PronosticoData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [diaSeleccionado, setDiaSeleccionado] = useState(0)

  const cargarConUbicacion = async (lat: number, lon: number, ciudad: string) => {
    setCargando(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/clima/pronostico?lat=${lat}&lon=${lon}&ciudad=${encodeURIComponent(ciudad)}`)
      const json = await res.json()
      if (json.ok) setData(json)
      else setError(json.error ?? 'Error obteniendo pronóstico')
    } catch {
      setError('No se pudo cargar el pronóstico')
    } finally {
      setCargando(false)
    }
  }

  const cargar = async () => {
    setCargando(true)
    setError('')
    try {
      const res = await fetch('/api/v1/clima/pronostico')
      const json = await res.json()
      if (json.ok) setData(json)
      else setError(json.error ?? 'Error obteniendo pronóstico')
    } catch {
      setError('No se pudo cargar el pronóstico')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords
          // Geocodificacion inversa con Open-Meteo nominatim
          fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=es`)
            .then(r => r.json())
            .then(geo => {
              const ciudad = geo.address?.city ?? geo.address?.town ?? geo.address?.village ?? 'Tu ubicación'
              cargarConUbicacion(latitude, longitude, ciudad)
            })
            .catch(() => cargarConUbicacion(latitude, longitude, 'Tu ubicación'))
        },
        () => cargar() // Si deniega, usa San Martín por defecto
      )
    } else {
      cargar()
    }
  }, [])

  if (cargando) return (
    <div className="mt-4 rounded-3xl border border-ink/10 bg-white p-6 animate-pulse">
      <div className="h-5 w-48 rounded bg-slate-100 mb-4" />
      <div className="grid grid-cols-5 gap-2">
        {[1,2,3,4,5].map(i => <div key={i} className="h-20 rounded-xl bg-slate-50" />)}
      </div>
    </div>
  )

  if (error) return (
    <div className="mt-4 rounded-3xl border border-ink/10 bg-white p-5">
      <div className="flex items-center gap-2 text-sm text-slate-warm">
        <Cloud className="size-4" />
        <span>No se pudo cargar el pronóstico. <button type="button" onClick={cargar} className="text-[#2BBCB8] underline">Reintentar</button></span>
      </div>
    </div>
  )

  if (!data) return null

  const dia = data.pronostico[diaSeleccionado]

  return (
    <div className="mt-4 rounded-3xl border border-ink/10 bg-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50">
            <Sun className="size-5 text-amber-400" />
          </div>
          <div>
            <h3 className="font-display text-base font-semibold text-[#0F1E35]">Pronóstico del Tiempo</h3>
            <div className="flex items-center gap-1 text-xs text-slate-warm">
              <MapPin className="size-3" />
              <span>{data.ciudad}</span>
            </div>
          </div>
        </div>
        <button type="button" onClick={cargar}
          className="flex size-8 items-center justify-center rounded-full border border-slate-200 hover:bg-slate-50">
          <RefreshCw className="size-3.5 text-slate-warm" />
        </button>
      </div>

      {/* Selector de días */}
      <div className="grid grid-cols-5 gap-2 mb-5">
        {data.pronostico.slice(0, 5).map((p, i) => {
          const fecha = new Date(p.fecha)
          const activo = i === diaSeleccionado
          return (
            <button key={i} type="button" onClick={() => setDiaSeleccionado(i)}
              className={`flex flex-col items-center rounded-xl p-2.5 border transition-all ${activo ? 'bg-[#0F1E35] border-[#0F1E35]' : 'border-slate-100 hover:bg-slate-50'}`}>
              <span className={`text-[10px] font-semibold ${activo ? 'text-white/60' : 'text-slate-warm'}`}>
                {i === 0 ? 'Hoy' : DIAS[fecha.getDay()]}
              </span>
              <span className={`text-[10px] ${activo ? 'text-white/40' : 'text-slate-warm/60'}`}>
                {fecha.getDate()} {MESES[fecha.getMonth()]}
              </span>
              <div className="my-1.5">
                <IconoClima codigo={p.codigo_clima} />
              </div>
              <span className={`text-xs font-bold ${activo ? 'text-white' : 'text-[#0F1E35]'}`}>
                {Math.round(p.temp_max)}°
              </span>
              <span className={`text-[10px] ${activo ? 'text-white/50' : 'text-slate-warm'}`}>
                {Math.round(p.temp_min)}°
              </span>
            </button>
          )
        })}
      </div>

      {/* Detalle del día seleccionado */}
      {dia && (
        <div className="space-y-3">
          {/* Apto para ciclismo */}
          <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${colorApto(dia.probabilidad_lluvia, dia.viento_kmh)}`}>
            {etiquetaApto(dia.probabilidad_lluvia, dia.viento_kmh)} para ciclismo
          </div>

          {/* Stats del día */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icono: Thermometer, label: 'Temperatura', valor: `${Math.round(dia.temp_min)}° - ${Math.round(dia.temp_max)}°C`, color: 'text-amber-500' },
              { icono: Droplets, label: 'Lluvia', valor: `${dia.probabilidad_lluvia}%`, color: 'text-blue-400' },
              { icono: Wind, label: 'Viento', valor: `${Math.round(dia.viento_kmh)} km/h`, color: 'text-teal-400' },
              { icono: Droplets, label: 'Humedad', valor: `${dia.humedad}%`, color: 'text-indigo-400' },
            ].map((s, i) => (
              <div key={i} className="rounded-xl bg-slate-50 p-3">
                <s.icono className={`size-4 mb-1.5 ${s.color}`} />
                <p className="text-sm font-bold text-[#0F1E35]">{s.valor}</p>
                <p className="text-[10px] text-slate-warm">{s.label}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-warm capitalize text-center">{dia.descripcion}</p>
        </div>
      )}
    </div>
  )
}
