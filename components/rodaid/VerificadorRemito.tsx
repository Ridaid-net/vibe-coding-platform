'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Bike, Loader2, Package, ShieldCheck, Truck } from 'lucide-react'

interface VerificacionRemito {
  encontrado: boolean
  numero?: string
  estado?: 'GENERADO' | 'DESPACHADO'
  generadoEn?: string
  despachadoEn?: string | null
  bici?: { marca: string; modelo: string; tipo: string }
  codigoCit?: string
}

/**
 * Verificador Público de Remitos — destino del QR del Remito de Embalaje y
 * Despacho (Fase 6b, CIT Completo). Endpoint abierto, sin cuenta; confirma
 * que el remito es genuino y su estado actual. Nunca muestra datos de
 * vendedor/comprador/taller (esos viajan impresos en el PDF, no acá).
 */
export function VerificadorRemito({ numero }: { numero: string }) {
  const [cargando, setCargando] = useState(true)
  const [resultado, setResultado] = useState<VerificacionRemito | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setCargando(true)
    setError(null)
    fetch(`/api/v1/verificar/remito/${encodeURIComponent(numero)}`)
      .then(async (r) => {
        const data = (await r.json()) as VerificacionRemito & { message?: string }
        if (cancelado) return
        if (!r.ok) {
          setError(data.message ?? 'No pudimos verificar este remito.')
          return
        }
        setResultado(data)
      })
      .catch(() => {
        if (!cancelado) setError('No pudimos verificar este remito. Probá de nuevo en un momento.')
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [numero])

  if (cargando) {
    return (
      <div className="flex items-center gap-2 rounded-3xl border border-ink/15 bg-white px-6 py-12 text-sm text-slate-warm">
        <Loader2 className="size-4 animate-spin" /> Verificando remito…
      </div>
    )
  }

  if (error || !resultado?.encontrado) {
    return (
      <div className="rounded-3xl border border-clay/40 bg-clay/5 px-6 py-12 text-center">
        <AlertTriangle className="mx-auto size-8 text-clay" />
        <h1 className="mt-3 font-display text-xl font-bold text-ink">
          No encontramos este remito
        </h1>
        <p className="mt-1 text-sm text-slate-warm">
          {error ?? `No hay ningún remito registrado en RODAID con el número ${numero}.`}
        </p>
      </div>
    )
  }

  const despachado = resultado.estado === 'DESPACHADO'

  return (
    <div
      className={`rounded-3xl border p-6 ${
        despachado ? 'border-lime-deep/50 bg-lime/15' : 'border-amber-300/60 bg-amber-50'
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex size-12 items-center justify-center rounded-xl ${
            despachado ? 'bg-lime-deep/25 text-ink' : 'bg-amber-200/60 text-amber-700'
          }`}
        >
          {despachado ? <Truck className="size-6" /> : <Package className="size-6" />}
        </span>
        <div>
          <h1 className="font-display text-xl font-bold text-ink">
            {despachado ? 'Remito verificado — bici despachada' : 'Remito verificado — en embalaje'}
          </h1>
          <p className="text-xs text-slate-warm">N° {resultado.numero}</p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {resultado.bici && (
          <div className="col-span-2 flex items-center gap-1.5">
            <Bike className="size-4 text-ink/40" />
            <span className="font-semibold text-ink">
              {resultado.bici.marca} {resultado.bici.modelo}
            </span>
          </div>
        )}
        {resultado.codigoCit && (
          <div>
            <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-warm">
              Código CIT
            </dt>
            <dd className="font-mono text-ink">{resultado.codigoCit}</dd>
          </div>
        )}
        {resultado.generadoEn && (
          <div>
            <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-warm">
              Emitido
            </dt>
            <dd className="text-ink">
              {new Date(resultado.generadoEn).toLocaleDateString('es-AR')}
            </dd>
          </div>
        )}
        {resultado.despachadoEn && (
          <div>
            <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-warm">
              Despachado
            </dt>
            <dd className="text-ink">
              {new Date(resultado.despachadoEn).toLocaleDateString('es-AR')}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-5 flex items-center gap-1.5 text-xs text-slate-warm">
        <ShieldCheck className="size-3.5 text-lime-deep" />
        Este documento fue emitido y firmado digitalmente por RODAID.
      </p>
    </div>
  )
}
