'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  activarNotificaciones,
  desactivarNotificaciones,
  estadoNotificaciones,
  notificacionesSoportadas,
  type EstadoNotificaciones,
} from '@/lib/notificaciones'

/**
 * "Mi Perfil" — tarjeta de Notificaciones (Hito 10).
 *
 * Boton opt-in para que el usuario active las notificaciones push del navegador.
 * Avisa el resultado de la verificacion de su bici, ofertas en el marketplace,
 * fondos retenidos en el escrow y la firma del acta de inspeccion fisica.
 */
export function NotificacionesCard() {
  const [estado, setEstado] = useState<EstadoNotificaciones | null>(null)
  const [procesando, setProcesando] = useState(false)

  useEffect(() => {
    estadoNotificaciones().then(setEstado)
  }, [])

  const soportado = notificacionesSoportadas()
  const activas = estado === 'activadas'
  const denegado = estado === 'denegado'

  const toggle = async () => {
    if (procesando) return
    setProcesando(true)
    try {
      if (activas) {
        const next = await desactivarNotificaciones()
        setEstado(next)
        toast.success('Notificaciones desactivadas')
      } else {
        const next = await activarNotificaciones()
        setEstado(next)
        if (next === 'activadas') {
          toast.success('Notificaciones activadas', {
            description: 'Te avisaremos sobre tu bici, ofertas y RODAID PAY.',
          })
        } else if (next === 'denegado') {
          toast.error('Permiso bloqueado', {
            description:
              'Habilitá las notificaciones para RODAID en los ajustes de tu navegador.',
          })
        }
      }
    } catch (err) {
      toast.error('No pudimos cambiar las notificaciones', {
        description: (err as Error).message ?? 'Probá de nuevo en unos instantes.',
      })
    } finally {
      setProcesando(false)
    }
  }

  return (
    <section className="mt-10 rounded-3xl border border-ink/12 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-lime/20 text-ink">
            {activas ? (
              <BellRing className="size-5 text-lime-deep" />
            ) : (
              <Bell className="size-5" />
            )}
          </span>
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
              Mi Perfil
            </span>
            <h2 className="mt-1 font-display text-xl font-bold text-ink">
              Notificaciones
            </h2>
            <p className="mt-1 max-w-md text-sm text-slate-warm">
              Recibí avisos cuando tu bici se verifique, te llegue una oferta o se
              retengan fondos en RODAID PAY. Vos decidís: es totalmente opcional.
            </p>
          </div>
        </div>

        {soportado ? (
          <button
            onClick={toggle}
            disabled={procesando || denegado || estado === null}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              activas
                ? 'border border-ink/15 bg-white text-ink hover:border-ink/40'
                : 'bg-ink text-paper hover:bg-ink-soft'
            }`}
          >
            {procesando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : activas ? (
              <BellOff className="size-4" />
            ) : (
              <Bell className="size-4 text-lime" />
            )}
            {procesando
              ? 'Un momento…'
              : activas
                ? 'Desactivar'
                : 'Activar notificaciones'}
          </button>
        ) : (
          <span className="shrink-0 rounded-full bg-paper-dim px-4 py-2 text-xs font-semibold text-slate-warm">
            No disponible en este navegador
          </span>
        )}
      </div>

      {denegado && (
        <p className="mt-4 rounded-2xl bg-clay/5 px-4 py-3 text-xs text-clay">
          Bloqueaste las notificaciones para RODAID. Habilitalas desde los ajustes
          del navegador para volver a activarlas.
        </p>
      )}
    </section>
  )
}
