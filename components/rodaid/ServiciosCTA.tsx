'use client'
import Link from 'next/link'
import { Wrench, ChevronRight } from 'lucide-react'
import { useAlertasIot } from '@/lib/iot'

/**
 * Acceso a "Servicios de Talleres Aliados" (app/servicios/page.tsx), ubicado
 * junto a IoT/Strava en /garaje porque conceptualmente estan relacionados: el
 * sistema de Bici-Salud (mantenimiento predictivo via acelerometro, ver
 * iot-mantenimiento.service.ts) es lo que detecta que hace falta un service,
 * y este CTA es adonde el usuario va a resolverlo.
 *
 * Cambia de estado visual si hay al menos una alerta de mantenimiento activa
 * (cualquier severidad — reusa useAlertasIot, el mismo hook que ya consume
 * IotTiempoReal, y SEVERIDAD_VISUAL.media como referencia de color ambar).
 */
export function ServiciosCTA() {
  const { data } = useAlertasIot()
  const alertasMantenimiento = (data?.alertas ?? []).filter(
    a => !a.reconocida && a.tipo.startsWith('mantenimiento_')
  )
  const hayAlertas = alertasMantenimiento.length > 0

  return (
    <Link
      href="/servicios"
      className={`mt-6 flex items-center gap-4 rounded-3xl border p-5 transition-colors ${
        hayAlertas
          ? 'border-amber-300/70 bg-amber-50 hover:bg-amber-100/70'
          : 'border-ink/10 bg-white hover:bg-paper-dim/40'
      }`}
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${
          hayAlertas ? 'bg-amber-100 text-amber-700' : 'bg-paper-dim text-ink/40'
        }`}
      >
        <Wrench className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-bold text-ink">
          {hayAlertas ? 'Tu bici pide un service' : 'Servicios de Talleres Aliados'}
        </p>
        <p className="text-xs text-slate-warm mt-0.5">
          {hayAlertas
            ? `${alertasMantenimiento.length} alerta${alertasMantenimiento.length > 1 ? 's' : ''} de mantenimiento activa${alertasMantenimiento.length > 1 ? 's' : ''} — resolvela con un Taller Aliado.`
            : 'Los talleres de mejor desempeño de la red, con sus precios y contacto.'}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-ink/30" />
    </Link>
  )
}
