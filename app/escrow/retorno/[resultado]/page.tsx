import Link from 'next/link'
import { getTransaccion, webhookPago } from '@/src/services/escrow.service'

// Esta pagina lee searchParams y consulta la base: render dinamico siempre.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Pagina de retorno de MercadoPago (Checkout Pro `back_urls`).
 *
 *   /escrow/retorno/success  -> el comprador volvio tras pagar
 *   /escrow/retorno/failure  -> pago rechazado o cancelado
 *   /escrow/retorno/pending  -> pago en revision (medios offline, etc.)
 *
 * MercadoPago adjunta `payment_id`, `status` y `external_reference` (la
 * transaccion de escrow) en la query. En `success` confirmamos el pago de
 * inmediato re-consultando la fuente (webhookPago) — esto complementa el
 * webhook asincronico para que el estado se vea actualizado al instante.
 */

type Resultado = 'success' | 'failure' | 'pending'

const FORMATTER = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

const ESTADO_LABEL: Record<string, string> = {
  DEPOSITO_PENDIENTE: 'Esperando la confirmacion del pago',
  FONDOS_RETENIDOS: 'Pago confirmado — fondos en custodia de RODAID PAY',
  EN_CAMINO: 'Envio en camino',
  COMPLETADA: 'Operacion completada — fondos liberados al vendedor',
  CANCELADA: 'Operacion cancelada',
  DISPUTADA: 'Operacion en disputa',
}

interface VistaResultado {
  badge: string
  tono: 'ok' | 'error' | 'espera'
  titulo: string
  detalle: string
}

const VISTAS: Record<Resultado, VistaResultado> = {
  success: {
    badge: 'Pago recibido',
    tono: 'ok',
    titulo: 'Listo, recibimos tu pago',
    detalle:
      'Tu dinero queda retenido de forma segura por RODAID PAY hasta que confirmes que recibiste el producto.',
  },
  failure: {
    badge: 'Pago no completado',
    tono: 'error',
    titulo: 'No pudimos procesar el pago',
    detalle:
      'La operacion fue rechazada o cancelada. Podes volver a intentarlo: la publicacion sigue reservada para vos.',
  },
  pending: {
    badge: 'Pago en revision',
    tono: 'espera',
    titulo: 'Tu pago esta en revision',
    detalle:
      'Algunos medios de pago tardan en acreditarse. Te avisaremos en cuanto se confirme y los fondos queden en custodia.',
  },
}

function normalizarResultado(valor: string): Resultado {
  if (valor === 'success' || valor === 'failure' || valor === 'pending') {
    return valor
  }
  return 'pending'
}

function primerValor(valor: string | string[] | undefined): string | null {
  if (Array.isArray(valor)) {
    return valor[0] ?? null
  }
  return valor ?? null
}

export default async function RetornoPage({
  params,
  searchParams,
}: {
  params: Promise<{ resultado: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { resultado: resultadoParam } = await params
  const query = await searchParams
  const resultado = normalizarResultado(resultadoParam)

  const transaccionId = primerValor(
    query.external_reference ?? query.transaccion_id
  )
  const paymentId = primerValor(query.payment_id ?? query.collection_id)

  // En `success` confirmamos el pago de inmediato re-consultando MercadoPago.
  // Es idempotente: si el webhook ya lo proceso, no vuelve a transicionar.
  if (resultado === 'success' && paymentId) {
    try {
      await webhookPago({
        paymentId,
        externalReferenceHint: transaccionId,
      })
    } catch (error) {
      console.error('[escrow][retorno] confirmacion inmediata fallo', error)
    }
  }

  // Cargar el estado actual de la transaccion (best-effort).
  let transaccion: Awaited<ReturnType<typeof getTransaccion>> | null = null
  if (transaccionId) {
    try {
      transaccion = await getTransaccion(transaccionId)
    } catch {
      transaccion = null
    }
  }

  const vista = VISTAS[resultado]

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-sm">
        <div className="p-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            RODAID PAY
          </p>

          <div className="mt-6 flex items-center gap-3">
            <StatusGlyph tono={vista.tono} />
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${badgeClasses(vista.tono)}`}
            >
              {vista.badge}
            </span>
          </div>

          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            {vista.titulo}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {vista.detalle}
          </p>

          {transaccion && (
            <dl className="mt-6 space-y-3 rounded-xl bg-muted/60 p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Monto</dt>
                <dd className="font-medium">
                  {FORMATTER.format(transaccion.precioARS)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Estado del escrow</dt>
                <dd className="text-right font-medium">
                  {ESTADO_LABEL[transaccion.estado] ?? transaccion.estado}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Transaccion</dt>
                <dd className="font-mono text-xs text-muted-foreground">
                  {transaccion.id.slice(0, 8)}
                </dd>
              </div>
            </dl>
          )}

          <div className="mt-8 flex flex-col gap-2">
            {resultado === 'failure' && transaccionId && (
              <p className="text-xs text-muted-foreground">
                Si el problema persiste, podes cancelar la compra desde tus
                operaciones para liberar la publicacion.
              </p>
            )}
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Volver a RODAID
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}

function badgeClasses(tono: VistaResultado['tono']): string {
  switch (tono) {
    case 'ok':
      return 'bg-emerald-100 text-emerald-700'
    case 'error':
      return 'bg-red-100 text-red-700'
    case 'espera':
      return 'bg-amber-100 text-amber-700'
  }
}

function StatusGlyph({ tono }: { tono: VistaResultado['tono'] }) {
  const color =
    tono === 'ok'
      ? 'text-emerald-600'
      : tono === 'error'
        ? 'text-red-600'
        : 'text-amber-600'

  return (
    <span className={color} aria-hidden>
      {tono === 'ok' ? (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" className="fill-current opacity-15" />
          <path
            d="M8 12.5l2.5 2.5L16 9.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : tono === 'error' ? (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" className="fill-current opacity-15" />
          <path
            d="M9 9l6 6M15 9l-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" className="fill-current opacity-15" />
          <path
            d="M12 7v5l3 2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  )
}
