'use client'
import { useState, useEffect } from 'react'
import { authedFetch } from '@/lib/session'
import { Activity, Clock, Zap, TrendingUp, ExternalLink } from 'lucide-react'

interface ActividadStrava {
  id: number
  nombre: string
  distancia_km: number
  tiempo_min: number
  fecha: string
  velocidad_avg: number
}

export function StravaActividades() {
  const [actividades, setActividades] = useState<ActividadStrava[]>([])
  const [conectado, setConectado] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    authedFetch('/api/v1/strava/actividades')
      .then(r => r.json())
      .then(data => {
        setConectado(data.conectado ?? false)
        if (data.actividades) setActividades(data.actividades)
        if (data.error) setError(data.error)
      })
      .catch(() => setError('No se pudo conectar con Strava'))
      .finally(() => setCargando(false))
  }, [])

  if (cargando) return (
    <div className="mt-6 rounded-3xl border border-ink/10 bg-white p-6 animate-pulse">
      <div className="h-5 w-40 rounded bg-slate-100 mb-4" />
      <div className="space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-50" />)}
      </div>
    </div>
  )

  if (!conectado) return (
    <div className="mt-6 rounded-3xl border border-ink/10 bg-white p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex size-10 items-center justify-center rounded-xl bg-[#FC4C02]/10">
          <Activity className="size-5 text-[#FC4C02]" />
        </div>
        <div>
          <h3 className="font-display text-base font-semibold text-[#0F1E35]">Strava</h3>
          <p className="text-xs text-slate-warm">Conectá tu cuenta para ver tus actividades</p>
        </div>
      </div>
      <a href="/api/v1/auth/strava"
        className="inline-flex items-center gap-2 rounded-full bg-[#FC4C02] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#FC4C02]/80">
        <Activity className="size-4" />
        Conectar con Strava
      </a>
    </div>
  )

  return (
    <div className="mt-6 rounded-3xl border border-ink/10 bg-white p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#FC4C02]/10">
            <Activity className="size-5 text-[#FC4C02]" />
          </div>
          <div>
            <h3 className="font-display text-base font-semibold text-[#0F1E35]">Strava — Actividades recientes</h3>
            <p className="text-xs text-slate-warm">Últimas salidas en bicicleta</p>
          </div>
        </div>
        <a href="https://strava.com/athlete/training" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[#FC4C02] hover:underline">
          Ver en Strava <ExternalLink className="size-3" />
        </a>
      </div>

      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : actividades.length === 0 ? (
        <p className="text-sm text-slate-warm text-center py-6">No hay actividades de ciclismo recientes en Strava.</p>
      ) : (
        <div className="space-y-3">
          {actividades.map(a => (
            <div key={a.id} className="flex items-center gap-4 rounded-xl bg-slate-50 px-4 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#FC4C02]/10">
                <Activity className="size-4 text-[#FC4C02]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#0F1E35] truncate">{a.nombre}</p>
                <p className="text-xs text-slate-warm">{new Date(a.fecha).toLocaleDateString('es-AR')}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-warm shrink-0">
                <span className="flex items-center gap-1">
                  <TrendingUp className="size-3 text-[#FC4C02]" />
                  {a.distancia_km} km
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {a.tiempo_min} min
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="size-3" />
                  {a.velocidad_avg} km/h
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
