'use client'
import { useState, useEffect } from 'react'
import { authedFetch } from '@/lib/session'
import { Watch, Activity, Clock, TrendingUp, Zap, ExternalLink } from 'lucide-react'

interface ActividadGarmin {
  id: string
  nombre: string
  distancia_km: number
  tiempo_min: number
  fecha: string
  velocidad_avg: number
  calorias: number
  frecuencia_cardiaca_avg?: number
}

export function GarminActividades() {
  const [actividades, setActividades] = useState<ActividadGarmin[]>([])
  const [conectado, setConectado] = useState(false)
  const [proximamente, setProximamente] = useState(false)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    authedFetch('/api/v1/garmin/actividades')
      .then(r => r.json())
      .then(data => {
        if (data.proximamente) { setProximamente(true); return }
        setConectado(data.conectado ?? false)
        if (data.actividades) setActividades(data.actividades)
      })
      .catch(() => setProximamente(true))
      .finally(() => setCargando(false))
  }, [])

  if (cargando) return (
    <div className="mt-4 rounded-3xl border border-ink/10 bg-white p-6 animate-pulse">
      <div className="h-5 w-40 rounded bg-slate-100 mb-4" />
      <div className="h-16 rounded-xl bg-slate-50" />
    </div>
  )

  if (proximamente) return (
    <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-slate-200">
          <Watch className="size-5 text-slate-400" />
        </div>
        <div>
          <h3 className="font-display text-base font-semibold text-slate-400">Garmin Connect</h3>
          <p className="text-xs text-slate-400">Integración en proceso de aprobación</p>
        </div>
        <span className="ml-auto text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700">Próximamente</span>
      </div>
      <p className="text-xs text-slate-warm leading-relaxed">
        La integración con Garmin Connect está en proceso de aprobación por Garmin Developer. 
        Cuando esté disponible, podrás ver tus actividades de ciclismo, odómetro automático y datos de rendimiento directamente en tu Garaje RODAID.
      </p>
    </div>
  )

  if (!conectado) return (
    <div className="mt-4 rounded-3xl border border-ink/10 bg-white p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex size-10 items-center justify-center rounded-xl bg-slate-100">
          <Watch className="size-5 text-slate-600" />
        </div>
        <div>
          <h3 className="font-display text-base font-semibold text-[#0F1E35]">Garmin Connect</h3>
          <p className="text-xs text-slate-warm">Conectá tu dispositivo Garmin</p>
        </div>
      </div>
      <a href="/api/v1/auth/garmin"
        className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F1E35]/80">
        <Watch className="size-4" />
        Conectar con Garmin
      </a>
    </div>
  )

  return (
    <div className="mt-4 rounded-3xl border border-ink/10 bg-white p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-slate-100">
            <Watch className="size-5 text-slate-600" />
          </div>
          <div>
            <h3 className="font-display text-base font-semibold text-[#0F1E35]">Garmin Connect</h3>
            <p className="text-xs text-slate-warm">Actividades recientes de ciclismo</p>
          </div>
        </div>
        <a href="https://connect.garmin.com" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-slate-warm hover:underline">
          Ver en Garmin <ExternalLink className="size-3" />
        </a>
      </div>

      {actividades.length === 0 ? (
        <p className="text-sm text-slate-warm text-center py-6">No hay actividades de ciclismo recientes en Garmin.</p>
      ) : (
        <div className="space-y-3">
          {actividades.map(a => (
            <div key={a.id} className="flex items-center gap-4 rounded-xl bg-slate-50 px-4 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-200">
                <Activity className="size-4 text-slate-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#0F1E35] truncate">{a.nombre}</p>
                <p className="text-xs text-slate-warm">{new Date(a.fecha).toLocaleDateString('es-AR')}</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-warm shrink-0 flex-wrap">
                <span className="flex items-center gap-1"><TrendingUp className="size-3" />{a.distancia_km} km</span>
                <span className="flex items-center gap-1"><Clock className="size-3" />{a.tiempo_min} min</span>
                <span className="flex items-center gap-1"><Zap className="size-3" />{a.velocidad_avg} km/h</span>
                {a.calorias > 0 && <span>{a.calorias} kcal</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
