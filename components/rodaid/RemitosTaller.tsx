'use client'

import { Suspense, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Package, ShieldCheck, Truck } from 'lucide-react'
import { useVerComoAliado } from '@/lib/admin-view-as'
import { AdminViewAsBanner } from '@/components/rodaid/AdminViewAsBanner'
import { SelectorVerComoAliado } from '@/components/rodaid/SelectorVerComoAliado'
import { despacharRemito, descargarRemitoPdf, useRemitosTaller, type RemitoListado } from '@/lib/remitos'

/**
 * Panel de despacho del Taller Aliado (Fase 6b, CIT Completo). Lista los
 * Remitos de Embalaje y Despacho generados por vendedores para este Taller
 * -- pendientes primero. "Despacho a Logística" confirma el trabajo hecho,
 * firmado con la wallet del staff logueado (verificado server-side), y
 * dispara la liquidación del Fee de Logística.
 */
export function RemitosTaller() {
  return (
    <Suspense fallback={null}>
      <RemitosTallerInner />
    </Suspense>
  )
}

function RemitosTallerInner() {
  const verComoAliado = useVerComoAliado()
  const { data, isLoading, mutate } = useRemitosTaller(verComoAliado)
  const [despachando, setDespachando] = useState<string | null>(null)

  const remitos = data?.remitos ?? []
  const modoVista = data?.modoVista ?? 'propio'
  const soloLectura = modoVista !== 'propio'
  const pendientes = remitos.filter((r) => r.estado === 'GENERADO')

  if (isLoading && !data) return null

  const verRemito = (numero: string) => {
    descargarRemitoPdf(numero).catch((err) => {
      toast.error('No pudimos descargar el remito', { description: (err as Error).message })
    })
  }

  const despachar = async (numero: string) => {
    if (despachando) return
    setDespachando(numero)
    try {
      await despacharRemito(numero)
      await mutate()
      toast.success('Despacho confirmado', {
        description: 'Avisamos al comprador y el fee de logística ya está en camino de liquidarse.',
      })
    } catch (err) {
      toast.error('No pudimos confirmar el despacho', { description: (err as Error).message })
    } finally {
      setDespachando(null)
    }
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 mb-8">
      <SelectorVerComoAliado />
      <AdminViewAsBanner modo={modoVista} />

      <div className="flex items-center gap-2 mb-1">
        <Package className="size-5 text-[#F47B20]" />
        <h2 className="font-display text-lg font-bold text-[#0F1E35]">
          Remitos de Embalaje y Despacho
        </h2>
        {pendientes.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            {pendientes.length} pendiente{pendientes.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-warm mb-4">
        Cuando un vendedor confirma la venta de una bici de CIT Completo, te llega acá la orden de embalaje.
      </p>

      {remitos.length === 0 ? (
        <p className="text-sm text-slate-warm">No tenés remitos por ahora.</p>
      ) : (
        <ul className="space-y-3">
          {remitos.map((r) => (
            <RemitoItem
              key={r.id}
              remito={r}
              soloLectura={soloLectura}
              despachando={despachando === r.numero}
              onVer={() => verRemito(r.numero)}
              onDespachar={() => despachar(r.numero)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function RemitoItem({
  remito,
  soloLectura,
  despachando,
  onVer,
  onDespachar,
}: {
  remito: RemitoListado
  soloLectura: boolean
  despachando: boolean
  onVer: () => void
  onDespachar: () => void
}) {
  return (
    <li className="rounded-xl border border-ink/10 bg-paper-dim/30 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-[#0F1E35]">
            {remito.bici.marca} {remito.bici.modelo}
          </p>
          <p className="text-xs text-slate-warm">
            N° {remito.bici.numeroSerie} · {remito.codigoCit} · {remito.numero}
          </p>
        </div>
        {remito.estado === 'DESPACHADO' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#0a7d5a]/12 px-2.5 py-1 text-[11px] font-semibold text-[#0a7d5a]">
            <Truck className="size-3" /> Despachado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
            <Package className="size-3" /> Pendiente
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onVer}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
        >
          Ver remito (PDF)
        </button>
        {remito.estado === 'GENERADO' && (
          <button
            type="button"
            onClick={onDespachar}
            disabled={despachando || soloLectura}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1E35] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0F1E35]/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {despachando ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            Despacho a Logística
          </button>
        )}
      </div>
    </li>
  )
}
