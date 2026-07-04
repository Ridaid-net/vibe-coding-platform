'use client'
import { useState, useEffect } from 'react'
import { Activity, Wrench, MapPin, X } from 'lucide-react'

interface AlertaMantenimiento {
  tipo: string
  km: number
  kmUmbral: number
  mensaje: string
  urgencia: 'info' | 'warning' | 'urgent'
}

interface BiciSaludBotProps {
  bicicletaId: string
  nombreBici: string
  kmTotales: number
}

const UMBRALES = [
  { tipo: 'Transmision y cadena', kmUmbral: 500, mensaje: 'Tu transmision lleva {km} km. Es momento de un ajuste para evitar desgaste prematuro.', urgencia: 'warning' as const },
  { tipo: 'Revision de cables', kmUmbral: 800, mensaje: 'Con {km} km, los cables y fundas necesitan revision para mantener la respuesta de frenos y cambios.', urgencia: 'warning' as const },
  { tipo: 'Servicio de frenos', kmUmbral: 1000, mensaje: 'A {km} km, es momento de revisar pastillas y ajustar frenos para tu seguridad.', urgencia: 'urgent' as const },
  { tipo: 'Service general', kmUmbral: 1500, mensaje: 'Tu bici acumula {km} km. Un service completo asegura otro ciclo de alto rendimiento.', urgencia: 'urgent' as const },
]

export function BiciSaludBot({ bicicletaId, nombreBici, kmTotales }: BiciSaludBotProps) {
  const [alertas, setAlertas] = useState<AlertaMantenimiento[]>([])
  const [visible, setVisible] = useState(false)
  const [descartadas, setDescartadas] = useState<string[]>([])

  useEffect(() => {
    if (kmTotales <= 0) return
    const nuevasAlertas: AlertaMantenimiento[] = []
    UMBRALES.forEach(u => {
      const multiplo = Math.floor(kmTotales / u.kmUmbral)
      if (multiplo > 0) {
        const kmAlerta = multiplo * u.kmUmbral
        const id = `${u.tipo}-${kmAlerta}`
        if (!descartadas.includes(id)) {
          nuevasAlertas.push({
            tipo: u.tipo,
            km: Math.round(kmTotales),
            kmUmbral: kmAlerta,
            mensaje: u.mensaje.replace('{km}', Math.round(kmTotales).toString()),
            urgencia: u.urgencia,
          })
        }
      }
    })
    setAlertas(nuevasAlertas)
    if (nuevasAlertas.length > 0) setVisible(true)
  }, [kmTotales, descartadas])

  const descartar = (tipo: string, kmUmbral: number) => {
    setDescartadas(prev => [...prev, `${tipo}-${kmUmbral}`])
  }

  if (!visible || alertas.length === 0) return null

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-[#F47B20]">
          <Activity className="size-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[#0F1E35]">Bici-Salud · {nombreBici}</p>
          <p className="text-xs text-amber-700">{Math.round(kmTotales)} km acumulados via Strava</p>
        </div>
      </div>
      <div className="space-y-3">
        {alertas.map((alerta) => (
          <div key={`${alerta.tipo}-${alerta.kmUmbral}`}
            className={`rounded-xl p-3 flex gap-3 ${alerta.urgencia === 'urgent' ? 'bg-red-50 border border-red-200' : 'bg-white border border-amber-200'}`}>
            <Wrench className={`size-4 shrink-0 mt-0.5 ${alerta.urgencia === 'urgent' ? 'text-red-500' : 'text-amber-600'}`} />
            <div className="flex-1">
              <p className={`text-xs font-semibold mb-1 ${alerta.urgencia === 'urgent' ? 'text-red-700' : 'text-amber-800'}`}>{alerta.tipo}</p>
              <p className="text-xs text-slate-600 leading-relaxed">{alerta.mensaje}</p>
              <div className="mt-2 flex gap-2">
                <a href="/aliados" className="inline-flex items-center gap-1 text-xs font-semibold text-[#2BBCB8] hover:underline">
                  <MapPin className="size-3" /> Buscar taller aliado
                </a>
                <button onClick={() => descartar(alerta.tipo, alerta.kmUmbral)}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 ml-auto">
                  <X className="size-3" /> Descartar
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
