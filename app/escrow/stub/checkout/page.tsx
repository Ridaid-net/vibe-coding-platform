import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  getTransaccion,
  simularDeposito,
} from '@/src/services/escrow.service'
import { getModo } from '@/src/services/mercadopago.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Checkout simulado de RODAID PAY.
 *
 * Cuando no hay credenciales de MercadoPago configuradas, `crearPreferencia`
 * opera en modo STUB y apunta el `init_point` aca (`/escrow/stub/checkout`).
 * Esta pagina reemplaza la pantalla de pago de MercadoPago para poder
 * ejercitar todo el flujo —preferencia -> redirect -> confirmacion— sin
 * mover dinero real. No esta disponible en modo LIVE.
 */

const FORMATTER = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

function primerValor(valor: string | string[] | undefined): string | null {
  if (Array.isArray(valor)) {
    return valor[0] ?? null
  }
  return valor ?? null
}

async function aprobarPago(formData: FormData) {
  'use server'
  const txId = String(formData.get('txId') ?? '')
  if (!txId) {
    redirect('/escrow/retorno/failure')
  }
  // Simula el webhook de MercadoPago: transiciona el escrow a FONDOS_RETENIDOS.
  await simularDeposito({ transaccionId: txId })
  redirect(
    `/escrow/retorno/success?external_reference=${encodeURIComponent(txId)}` +
      `&status=approved&payment_id=stub-pay-${encodeURIComponent(txId)}`
  )
}

async function rechazarPago(formData: FormData) {
  'use server'
  const txId = String(formData.get('txId') ?? '')
  redirect(
    `/escrow/retorno/failure?external_reference=${encodeURIComponent(txId)}&status=rejected`
  )
}

export default async function StubCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const txId = primerValor(query.tx ?? query.external_reference)

  if (getModo() === 'LIVE') {
    return (
      <Mensaje
        titulo="Checkout simulado deshabilitado"
        detalle="RODAID PAY esta operando con MercadoPago real. Esta pantalla solo esta disponible en modo de pruebas."
      />
    )
  }

  if (!txId) {
    return (
      <Mensaje
        titulo="Falta la transaccion"
        detalle="No se recibio el identificador de la transaccion a pagar."
      />
    )
  }

  let transaccion: Awaited<ReturnType<typeof getTransaccion>> | null = null
  try {
    transaccion = await getTransaccion(txId)
  } catch {
    return (
      <Mensaje
        titulo="Transaccion no encontrada"
        detalle="El link de pago no corresponde a ninguna operacion vigente."
      />
    )
  }

  const yaPagada = transaccion.estado !== 'DEPOSITO_PENDIENTE'

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-sm">
        <div className="p-8">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              RODAID PAY
            </p>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700">
              Pago simulado
            </span>
          </div>

          <h1 className="mt-6 text-2xl font-semibold tracking-tight">
            Confirmar pago
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Estas en el checkout de pruebas de RODAID PAY. Al confirmar, el
            dinero queda retenido en custodia (escrow) hasta la entrega del
            producto.
          </p>

          <dl className="mt-6 space-y-3 rounded-xl bg-muted/60 p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Total a pagar</dt>
              <dd className="text-lg font-semibold">
                {FORMATTER.format(transaccion.precioARS)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Transaccion</dt>
              <dd className="font-mono text-xs text-muted-foreground">
                {transaccion.id.slice(0, 8)}
              </dd>
            </div>
          </dl>

          {yaPagada ? (
            <div className="mt-8">
              <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Esta transaccion ya no esta pendiente de pago.
              </p>
              <Link
                href={`/escrow/retorno/success?external_reference=${encodeURIComponent(txId)}`}
                className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Ver el estado
              </Link>
            </div>
          ) : (
            <div className="mt-8 flex flex-col gap-3">
              <form action={aprobarPago}>
                <input type="hidden" name="txId" value={txId} />
                <button
                  type="submit"
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  Pagar {FORMATTER.format(transaccion.precioARS)}
                </button>
              </form>
              <form action={rechazarPago}>
                <input type="hidden" name="txId" value={txId} />
                <button
                  type="submit"
                  className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  Cancelar el pago
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function Mensaje({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          RODAID PAY
        </p>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">{titulo}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {detalle}
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Volver a RODAID
        </Link>
      </div>
    </main>
  )
}
