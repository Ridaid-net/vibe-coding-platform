'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bike,
  CheckCircle2,
  Fingerprint,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Store,
} from 'lucide-react'
import {
  etiquetaBici,
  fetchMisBicicletas,
  type BicicletaGaraje,
} from '@/lib/garaje'
import { SolicitarVerificacionModal } from './solicitar-verificacion-modal'

/**
 * BicycleSelector — primer paso del flujo de publicacion.
 *
 * Antes de mostrar el formulario, el usuario elige una de sus bicicletas. Si no
 * tiene ninguna con identidad verificada (CIT activo), se muestra un estado de
 * bloqueo con un mensaje amigable y un acceso a "Mi Garaje". Para reducir la
 * friccion, las bicis sin verificar se pueden verificar ahi mismo con un modal
 * rapido, sin abandonar la pantalla de publicacion.
 */
export function BicycleSelector({
  onSelect,
}: {
  onSelect: (bici: BicicletaGaraje) => void
}) {
  const [bicis, setBicis] = useState<BicicletaGaraje[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [verificar, setVerificar] = useState<BicicletaGaraje | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cargar = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(false)
    try {
      const data = await fetchMisBicicletas(controller.signal)
      setBicis(data.bicicletas)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(true)
      setBicis(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    return () => abortRef.current?.abort()
  }, [cargar])

  if (loading && !bicis) {
    return <SelectorSkeleton />
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-clay/30 bg-clay/5 px-6 py-14 text-center">
        <h3 className="font-display text-xl font-bold text-ink">
          No pudimos cargar tus bicicletas
        </h3>
        <p className="mt-2 text-sm text-slate-warm">
          Probá de nuevo en unos segundos.
        </p>
        <button
          onClick={cargar}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
        >
          <RefreshCw className="size-4" />
          Reintentar
        </button>
      </div>
    )
  }

  const lista = bicis ?? []
  const verificadas = lista.filter((b) => b.citActivo)
  const sinVerificar = lista.filter((b) => !b.citActivo)

  // Estado de bloqueo: ninguna bici con CIT activo.
  if (verificadas.length === 0) {
    return (
      <>
        <div className="overflow-hidden rounded-3xl border border-ink/10 bg-white">
          <div className="flex flex-col items-center border-b border-ink/10 bg-paper-dim/40 px-6 py-12 text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-lime/25 text-ink">
              <ShieldAlert className="size-8" />
            </span>
            <h3 className="mt-5 font-display text-2xl font-bold text-ink">
              Necesitás una bici verificada
            </h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-warm">
              Para publicar, primero necesitás una bicicleta con identidad
              verificada (CIT).
            </p>
            <Link
              href="/garaje"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
            >
              <Store className="size-4 text-lime" />
              Ir a Mi Garaje
            </Link>
          </div>

          {/* Atajo de baja friccion: verificar una bici ya cargada sin salir. */}
          {sinVerificar.length > 0 && (
            <div className="px-6 py-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-warm">
                Tus bicicletas sin verificar
              </p>
              <ul className="mt-3 space-y-2.5">
                {sinVerificar.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-paper-dim/30 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-display font-semibold text-ink">
                        {etiquetaBici(b)}
                      </p>
                      <p className="text-xs text-slate-warm">
                        {estadoCitTexto(b.citEstado)}
                      </p>
                    </div>
                    <button
                      onClick={() => setVerificar(b)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
                    >
                      <Fingerprint className="size-3.5" />
                      Verificar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <SolicitarVerificacionModal
          bici={verificar}
          open={verificar !== null}
          onOpenChange={(o) => !o && setVerificar(null)}
          onVerificada={cargar}
        />
      </>
    )
  }

  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
          Paso 1 de 2
        </p>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">
          Elegí la bici que querés publicar
        </h2>
        <p className="mt-2 text-sm text-slate-warm">
          Solo podés publicar bicicletas con identidad verificada (CIT activo).
        </p>

        <ul className="mt-6 space-y-3">
          {verificadas.map((b) => {
            const yaPublicada = b.tienePublicacionActiva
            return (
              <li key={b.id}>
                <button
                  type="button"
                  disabled={yaPublicada}
                  onClick={() => onSelect(b)}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-ink/12 bg-white p-4 text-left transition-colors hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-ink/12"
                >
                  <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-paper-dim text-ink/30">
                    {b.fotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={b.fotoUrl}
                        alt={etiquetaBici(b)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Bike className="size-6" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display font-semibold text-ink">
                      {etiquetaBici(b)}
                    </p>
                    <p className="truncate text-xs text-slate-warm">
                      {[b.tipo, b.rodado ? `R${b.rodado}` : null, b.talleCuadro]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-lime/25 px-2 py-0.5 text-[11px] font-semibold text-ink">
                      <ShieldCheck className="size-3" />
                      CIT verificada
                    </span>
                  </div>
                  {yaPublicada ? (
                    <span className="shrink-0 rounded-full bg-paper-dim px-3 py-1 text-[11px] font-semibold text-slate-warm">
                      Ya publicada
                    </span>
                  ) : (
                    <CheckCircle2 className="size-5 shrink-0 text-ink/20 transition-colors group-hover:text-lime-deep" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        {sinVerificar.length > 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-ink/15 bg-paper-dim/20 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-warm">
              Sin verificar
            </p>
            <ul className="mt-3 space-y-2">
              {sinVerificar.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="truncate text-sm text-slate-warm">
                    {etiquetaBici(b)}
                  </span>
                  <button
                    onClick={() => setVerificar(b)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
                  >
                    <Fingerprint className="size-3.5" />
                    Verificar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-slate-warm">
          ¿Te falta una bici?{' '}
          <Link href="/garaje" className="font-semibold text-ink hover:underline">
            Administrá Mi Garaje
          </Link>
        </p>
      </div>

      <SolicitarVerificacionModal
        bici={verificar}
        open={verificar !== null}
        onOpenChange={(o) => !o && setVerificar(null)}
        onVerificada={cargar}
      />
    </>
  )
}

function estadoCitTexto(estado: string | null): string {
  switch (estado) {
    case 'pendiente':
      return 'Verificación pendiente'
    case 'bloqueado':
      return 'CIT bloqueado'
    case 'rechazado':
      return 'Verificación rechazada'
    default:
      return 'Sin verificar'
  }
}

function SelectorSkeleton() {
  return (
    <div>
      <div className="h-3 w-24 animate-pulse rounded bg-paper-dim" />
      <div className="mt-3 h-8 w-2/3 animate-pulse rounded bg-paper-dim" />
      <ul className="mt-6 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <li
            key={i}
            className="flex items-center gap-4 rounded-2xl border border-ink/10 bg-white p-4"
          >
            <div className="size-14 animate-pulse rounded-xl bg-paper-dim" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-paper-dim" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-paper-dim" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
