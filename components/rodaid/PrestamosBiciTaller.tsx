'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Bike, Check, Gift, Loader2, X } from 'lucide-react'
import { useActivosGaraje, type ActivoGaraje } from '@/lib/garaje-digital'
import {
  cerrarPrestamo,
  iniciarPrestamo,
  marcarDisponible,
  usePrestamosBici,
  type PrestamoBici,
} from '@/lib/prestamos-bici'

/**
 * "Préstamo gratuito" del Panel de Taller Aliado -- NO es un alquiler pago,
 * sin cobro ni medio de pago involucrado. Solo bicis que son stock propio
 * certificado del taller (su propio Garaje Digital, CIT activo). Cruza
 * useActivosGaraje() (ya existente) con /api/v1/taller/prestamos para saber
 * qué bicis todavía no están marcadas, cuáles están disponibles y cuáles
 * prestadas -- sin ningún endpoint nuevo de listado de bicis.
 */
export function PrestamosBiciTaller() {
  const { data: garaje } = useActivosGaraje()
  const { data, isLoading, mutate } = usePrestamosBici()
  const [accionando, setAccionando] = useState<string | null>(null)

  const bicisElegibles = (garaje?.activos ?? []).filter((a) => a.estado === 'verificado')
  const prestamos = data?.prestamos ?? []
  const porBici = new Map(prestamos.map((p) => [p.bicicletaId, p]))

  if (isLoading && !data) return null

  const marcar = async (bicicletaId: string) => {
    if (accionando) return
    setAccionando(bicicletaId)
    try {
      await marcarDisponible(bicicletaId)
      await mutate()
      toast.success('Bici marcada como disponible para préstamo')
    } catch (err) {
      toast.error('No pudimos marcarla disponible', { description: (err as Error).message })
    } finally {
      setAccionando(null)
    }
  }

  const cerrar = async (bicicletaId: string) => {
    if (accionando) return
    setAccionando(bicicletaId)
    try {
      await cerrarPrestamo(bicicletaId)
      await mutate()
      toast.success('Préstamo cerrado -- la bici vuelve a estar disponible')
    } catch (err) {
      toast.error('No pudimos cerrar el préstamo', { description: (err as Error).message })
    } finally {
      setAccionando(null)
    }
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 mb-8">
      <div className="flex items-center gap-2 mb-1">
        <Gift className="size-5 text-[#F47B20]" />
        <h2 className="font-display text-lg font-bold text-[#0F1E35]">Préstamo gratuito</h2>
      </div>
      <p className="text-xs text-slate-warm mb-4">
        Prestá tus propias bicis certificadas (CIT activo) a quien decidas -- sin cobro, sin cuenta RODAID del prestatario.
      </p>

      {bicisElegibles.length === 0 && prestamos.length === 0 ? (
        <p className="text-sm text-slate-warm">
          Todavía no tenés bicis con CIT activo en tu Garaje para ofrecer en préstamo.
        </p>
      ) : (
        <ul className="space-y-3">
          {bicisElegibles.map((bici) => {
            const prestamo = porBici.get(bici.id)
            if (!prestamo) {
              return (
                <BiciSinMarcar
                  key={bici.id}
                  bici={bici}
                  accionando={accionando === bici.id}
                  onMarcar={() => marcar(bici.id)}
                />
              )
            }
            if (prestamo.estado === 'disponible') {
              return (
                <BiciDisponible
                  key={bici.id}
                  bici={bici}
                  onIniciado={() => mutate()}
                />
              )
            }
            return (
              <BiciPrestada
                key={bici.id}
                bici={bici}
                prestamo={prestamo}
                accionando={accionando === bici.id}
                onCerrar={() => cerrar(bici.id)}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}

function BiciHeader({ bici }: { bici: ActivoGaraje }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-sm font-semibold text-[#0F1E35]">
        {bici.marca} {bici.modelo}
      </p>
      <p className="text-xs text-slate-warm">N° {bici.numeroSerie}</p>
    </div>
  )
}

function BiciSinMarcar({
  bici,
  accionando,
  onMarcar,
}: {
  bici: ActivoGaraje
  accionando: boolean
  onMarcar: () => void
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 bg-paper-dim/30 p-3.5">
      <div className="flex items-center gap-3">
        <Bike className="size-4 text-slate-warm" />
        <BiciHeader bici={bici} />
      </div>
      <button
        type="button"
        onClick={onMarcar}
        disabled={accionando}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1E35] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0F1E35]/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {accionando ? <Loader2 className="size-3.5 animate-spin" /> : <Gift className="size-3.5" />}
        Marcar disponible
      </button>
    </li>
  )
}

function BiciDisponible({ bici, onIniciado }: { bici: ActivoGaraje; onIniciado: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [contacto, setContacto] = useState('')
  const [fecha, setFecha] = useState('')
  const [enviando, setEnviando] = useState(false)

  const prestar = async () => {
    if (!nombre.trim() || !fecha || enviando) return
    setEnviando(true)
    try {
      await iniciarPrestamo({
        bicicletaId: bici.id,
        prestatarioNombre: nombre.trim(),
        prestatarioContacto: contacto.trim() || undefined,
        horaEsperadaDevolucion: new Date(fecha).toISOString(),
      })
      toast.success('Préstamo iniciado')
      setAbierto(false)
      setNombre('')
      setContacto('')
      setFecha('')
      onIniciado()
    } catch (err) {
      toast.error('No pudimos iniciar el préstamo', { description: (err as Error).message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <li className="rounded-xl border border-lime-deep/30 bg-lime/8 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bike className="size-4 text-lime-deep" />
          <BiciHeader bici={bici} />
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-lime/30 px-2.5 py-1 text-[11px] font-semibold text-ink">
            Disponible
          </span>
          {!abierto && (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1E35] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0F1E35]/80"
            >
              Prestar
            </button>
          )}
        </div>
      </div>

      {abierto && (
        <div className="mt-3 space-y-2 border-t border-lime-deep/20 pt-3">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre de quien se la lleva"
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink/40"
          />
          <input
            value={contacto}
            onChange={(e) => setContacto(e.target.value)}
            placeholder="Contacto (opcional)"
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink/40"
          />
          <input
            type="datetime-local"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink/40"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={prestar}
              disabled={!nombre.trim() || !fecha || enviando}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1E35] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0F1E35]/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Confirmar préstamo
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              disabled={enviando}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
            >
              <X className="size-3.5" />
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function BiciPrestada({
  bici,
  prestamo,
  accionando,
  onCerrar,
}: {
  bici: ActivoGaraje
  prestamo: PrestamoBici
  accionando: boolean
  onCerrar: () => void
}) {
  return (
    <li
      className={`rounded-xl border p-3.5 ${
        prestamo.vencido ? 'border-clay/40 bg-clay/8' : 'border-ink/10 bg-paper-dim/30'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Bike className={`mt-0.5 size-4 ${prestamo.vencido ? 'text-clay' : 'text-slate-warm'}`} />
          <div className="min-w-0">
            <BiciHeader bici={bici} />
            <p className="mt-1 text-xs text-slate-warm">
              Prestada a <strong>{prestamo.prestatarioNombre}</strong>
              {prestamo.prestatarioContacto ? ` · ${prestamo.prestatarioContacto}` : ''}
            </p>
            {prestamo.horaEsperadaDevolucion && (
              <p className="text-xs text-slate-warm">
                Vuelve: {new Date(prestamo.horaEsperadaDevolucion).toLocaleString('es-AR')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {prestamo.vencido && (
            <span className="rounded-full bg-clay/15 px-2.5 py-1 text-[11px] font-semibold text-clay">
              Vencido
            </span>
          )}
          <button
            type="button"
            onClick={onCerrar}
            disabled={accionando}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {accionando ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Cerrar préstamo
          </button>
        </div>
      </div>
    </li>
  )
}
