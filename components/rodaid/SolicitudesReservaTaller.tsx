'use client'

import { Suspense, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, Check, Loader2, Mail, X } from 'lucide-react'
import { useVerComoAliado } from '@/lib/admin-view-as'
import { AdminViewAsBanner } from '@/components/rodaid/AdminViewAsBanner'
import { SelectorVerComoAliado } from '@/components/rodaid/SelectorVerComoAliado'
import {
  marcarSolicitudReserva,
  useSolicitudesReservaTaller,
  type SolicitudReservaTaller,
} from '@/lib/reservas-taller'

/**
 * "Solicitudes de reserva" del Panel del Taller Aliado (Garaje Digital ->
 * Taller). Reserva simple sin horario ni pago: el ciclista elige este taller
 * desde su Garaje y acá aparece el lead para que el taller lo contacte por
 * fuera del sistema (email/teléfono) y coordinen el tipo de CIT.
 */
export function SolicitudesReservaTaller() {
  return (
    <Suspense fallback={null}>
      <SolicitudesReservaTallerInner />
    </Suspense>
  )
}

function SolicitudesReservaTallerInner() {
  const verComoAliado = useVerComoAliado()
  const { data, isLoading, mutate } = useSolicitudesReservaTaller(verComoAliado)
  const [accionando, setAccionando] = useState<string | null>(null)

  const solicitudes = data?.solicitudes ?? []
  const modoVista = data?.modoVista ?? 'propio'
  const soloLectura = modoVista !== 'propio'
  const pendientes = solicitudes.filter((s) => s.estado === 'pendiente')

  if (isLoading && !data) return null

  const marcar = async (id: string, estado: 'contactado' | 'cerrada') => {
    if (accionando) return
    setAccionando(id)
    try {
      await marcarSolicitudReserva(id, estado)
      await mutate()
      toast.success(estado === 'contactado' ? 'Marcado como contactado' : 'Solicitud cerrada')
    } catch (err) {
      toast.error('No pudimos actualizar la solicitud', { description: (err as Error).message })
    } finally {
      setAccionando(null)
    }
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 mb-8">
      <SelectorVerComoAliado />
      <AdminViewAsBanner modo={modoVista} />

      <div className="flex items-center gap-2 mb-1">
        <CalendarClock className="size-5 text-[#F47B20]" />
        <h2 className="font-display text-lg font-bold text-[#0F1E35]">Solicitudes de reserva</h2>
        {pendientes.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            {pendientes.length} pendiente{pendientes.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-warm mb-4">
        Ciclistas que te eligieron desde su Garaje Digital para certificar su bici. Contactalos para coordinar.
      </p>

      {solicitudes.length === 0 ? (
        <p className="text-sm text-slate-warm">No tenés solicitudes por ahora.</p>
      ) : (
        <ul className="space-y-3">
          {solicitudes.map((s) => (
            <SolicitudItem
              key={s.id}
              solicitud={s}
              soloLectura={soloLectura}
              accionando={accionando === s.id}
              onContactado={() => marcar(s.id, 'contactado')}
              onCerrar={() => marcar(s.id, 'cerrada')}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function SolicitudItem({
  solicitud,
  soloLectura,
  accionando,
  onContactado,
  onCerrar,
}: {
  solicitud: SolicitudReservaTaller
  soloLectura: boolean
  accionando: boolean
  onContactado: () => void
  onCerrar: () => void
}) {
  const ESTADO_LABEL: Record<SolicitudReservaTaller['estado'], string> = {
    pendiente: 'Pendiente',
    contactado: 'Contactado',
    cerrada: 'Cerrada',
  }
  const ESTADO_CLASE: Record<SolicitudReservaTaller['estado'], string> = {
    pendiente: 'bg-amber-100 text-amber-700',
    contactado: 'bg-[#2BBCB8]/15 text-[#0F1E35]',
    cerrada: 'bg-ink/8 text-slate-warm',
  }

  return (
    <li className="rounded-xl border border-ink/10 bg-paper-dim/30 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-[#0F1E35]">
            {solicitud.bicicletaMarca} {solicitud.bicicletaModelo}
          </p>
          <p className="flex items-center gap-1 text-xs text-slate-warm">
            <Mail className="size-3" />
            {solicitud.usuarioNombre ? `${solicitud.usuarioNombre} · ` : ''}
            {solicitud.usuarioEmail}
          </p>
          {solicitud.nota && (
            <p className="mt-1 text-xs italic text-slate-warm">“{solicitud.nota}”</p>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${ESTADO_CLASE[solicitud.estado]}`}
        >
          {ESTADO_LABEL[solicitud.estado]}
        </span>
      </div>

      {solicitud.estado === 'pendiente' && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onContactado}
            disabled={accionando || soloLectura}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1E35] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0F1E35]/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {accionando ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Marcar contactado
          </button>
          <button
            type="button"
            onClick={onCerrar}
            disabled={accionando || soloLectura}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-3.5" />
            Cerrar
          </button>
        </div>
      )}
    </li>
  )
}
