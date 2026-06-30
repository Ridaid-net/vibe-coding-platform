'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { Loader2, Lock, ShieldCheck } from 'lucide-react'
import { authedFetch } from '@/lib/session'

const ars = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

/**
 * Checkout simulado de MercadoPago para el modo STUB (sin token de pago
 * configurado). Reemplaza la pantalla real de MercadoPago para poder ejercitar
 * el flujo de RODAID PAY de punta a punta en preview/desarrollo. En SANDBOX o
 * LIVE el usuario va directo al checkout real de MercadoPago.
 */
function StubCheckoutInner() {
  const params = useSearchParams()
  const router = useRouter()
  const txId = params.get('tx')

  const [monto, setMonto] = useState<number | null>(null)
  const [procesando, setProcesando] = useState<null | 'pagar' | 'rechazar'>(null)

  useEffect(() => {
    if (!txId) return
    authedFetch(`/api/v1/escrow/pago/${txId}/estado`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.pago?.monto != null) setMonto(Number(data.pago.monto))
      })
      .catch(() => undefined)
  }, [txId])

  if (!txId) {
    return (
      <div className="text-center">
        <p className="text-sm text-slate-warm">
          Falta la referencia de la transacción.
        </p>
        <Link
          href="/#comprar"
          className="mt-4 inline-flex rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper"
        >
          Volver al marketplace
        </Link>
      </div>
    )
  }

  const pagar = async () => {
    setProcesando('pagar')
    try {
      const res = await authedFetch('/api/v1/escrow/stub/pagar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transaccionId: txId }),
      })
      // Aprobado o no, llevamos al comprador a la pantalla de resultado, que es
      // la que confirma contra el backend si los fondos quedaron retenidos.
      const status = res.ok ? 'approved' : 'failure'
      router.push(
        `/checkout/resultado?external_reference=${encodeURIComponent(txId)}&status=${status}`
      )
    } catch {
      router.push(
        `/checkout/resultado?external_reference=${encodeURIComponent(txId)}&status=failure`
      )
    }
  }

  const rechazar = () => {
    setProcesando('rechazar')
    router.push(
      `/checkout/resultado?external_reference=${encodeURIComponent(txId)}&status=failure`
    )
  }

  return (
    <div className="w-full max-w-md">
      <div className="overflow-hidden rounded-3xl border border-ink/10 bg-white shadow-[0_24px_60px_-32px_rgba(20,22,14,0.45)]">
        <div className="flex items-center gap-2 border-b border-ink/10 bg-paper-dim/50 px-6 py-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-ink text-lime">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <p className="text-sm font-bold text-ink">Checkout protegido</p>
            <p className="text-[11px] uppercase tracking-wide text-slate-warm">
              Simulación · MercadoPago (modo prueba)
            </p>
          </div>
        </div>

        <div className="px-6 py-7">
          <p className="text-xs uppercase tracking-wide text-slate-warm">
            Total a pagar
          </p>
          <p className="mt-1 font-display text-4xl font-bold text-ink">
            {monto != null ? ars.format(monto) : '—'}
          </p>

          <div className="mt-5 flex items-start gap-2 rounded-xl border border-lime/50 bg-lime/10 px-4 py-3">
            <Lock className="mt-0.5 size-4 shrink-0 text-ink" />
            <p className="text-xs text-slate-warm">
              Al pagar, el dinero queda <strong>retenido por RODAID PAY</strong>{' '}
              y no llega al vendedor hasta que confirmes la entrega.
            </p>
          </div>

          <button
            onClick={pagar}
            disabled={procesando != null}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {procesando === 'pagar' ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Procesando…
              </>
            ) : (
              'Pagar ahora (simulado)'
            )}
          </button>

          <button
            onClick={rechazar}
            disabled={procesando != null}
            className="mt-2 inline-flex w-full items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium text-slate-warm transition-colors hover:text-ink disabled:opacity-60"
          >
            Cancelar el pago
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StubCheckoutPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-5 py-16">
      <Suspense
        fallback={<Loader2 className="size-8 animate-spin text-ink" />}
      >
        <StubCheckoutInner />
      </Suspense>
    </div>
  )
}
