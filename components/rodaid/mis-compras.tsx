'use client'

import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'
import { useMisCompras, type MiCompra } from '@/lib/garaje-digital'
import { CuentaRegresiva } from './cuenta-regresiva'

/**
 * "Mis compras" — Item 4 (prioridad 3): seguimiento del comprador.
 *
 * Lista las reservas/compras del usuario como COMPRADOR, con el estado del
 * flujo CIT Completo (seña -> verificación -> saldo) o del flujo genérico de
 * pago único. No expone datos del vendedor más allá de lo público de la
 * publicación.
 */

const ESTADO_COMPRA: Record<string, { label: string; clase: string }> = {
  RESERVA_PENDIENTE: {
    label: 'Confirmando tu seña',
    clase: 'bg-amber-100 text-amber-700',
  },
  RESERVADA: {
    label: 'Seña confirmada — verificación en curso',
    clase: 'bg-amber-100 text-amber-700',
  },
  SALDO_PENDIENTE: {
    label: 'Confirmá el pago del saldo',
    clase: 'bg-amber-100 text-amber-700',
  },
  DEPOSITO_PENDIENTE: {
    label: 'Confirmando tu pago',
    clase: 'bg-amber-100 text-amber-700',
  },
  FONDOS_RETENIDOS: {
    label: 'Pago protegido — esperando el envío',
    clase: 'bg-amber-100 text-amber-700',
  },
  EN_CAMINO: { label: 'En camino', clase: 'bg-amber-100 text-amber-700' },
  COMPLETADA: {
    label: 'Compra completada',
    clase: 'bg-[#0a7d5a]/12 text-[#0a7d5a]',
  },
  DISPUTADA: { label: 'En disputa', clase: 'bg-clay/12 text-clay' },
  CANCELADA: { label: 'Cancelada', clase: 'bg-paper-dim text-slate-warm' },
  RESERVA_VENCIDA: { label: 'Reserva vencida', clase: 'bg-clay/12 text-clay' },
}

function pesos(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  })
}

export function MisCompras() {
  const { data, isLoading } = useMisCompras()
  const compras = data?.compras ?? null

  if (isLoading && !compras) {
    return (
      <section className="mt-12">
        <Encabezado />
        <ul className="mt-6 space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <li
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-ink/10 bg-white"
            />
          ))}
        </ul>
      </section>
    )
  }

  if (!compras || compras.length === 0) {
    return (
      <section className="mt-12">
        <Encabezado />
        <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-ink/20 bg-white/50 px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-lime/20 text-ink">
            <ShoppingBag className="size-7" />
          </span>
          <p className="mt-4 max-w-sm text-sm text-slate-warm">
            Todavía no reservaste ni compraste ninguna bicicleta. Explorá el
            Marketplace para encontrar tu próxima bici.
          </p>
          <Link
            href="/#comprar"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            <ShoppingBag className="size-4 text-lime" />
            Ver el Marketplace
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="mt-12">
      <Encabezado total={compras.length} />
      <ul className="mt-6 space-y-3">
        {compras.map((c) => (
          <CompraItem key={c.transaccionId} compra={c} />
        ))}
      </ul>
    </section>
  )
}

function Encabezado({ total }: { total?: number }) {
  return (
    <div className="flex items-center gap-2">
      <ShoppingBag className="size-5 text-ink/60" />
      <h2 className="font-display text-2xl font-bold text-ink">Mis compras</h2>
      {total !== undefined && total > 0 && (
        <span className="rounded-full bg-paper-dim px-2.5 py-0.5 text-xs font-semibold text-slate-warm">
          {total}
        </span>
      )}
    </div>
  )
}

function CompraItem({ compra }: { compra: MiCompra }) {
  const estado = ESTADO_COMPRA[compra.estado] ?? {
    label: compra.estado,
    clase: 'bg-paper-dim text-slate-warm',
  }

  return (
    <li className="flex flex-wrap items-center gap-4 rounded-2xl border border-ink/12 bg-white p-4">
      <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-paper-dim text-ink/30">
        {compra.publicacion.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={compra.publicacion.fotoUrl}
            alt={compra.publicacion.titulo}
            className="h-full w-full object-cover"
          />
        ) : (
          <ShoppingBag className="size-6" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-display font-semibold text-ink">
            {compra.publicacion.titulo}
          </p>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${estado.clase}`}
          >
            {estado.label}
          </span>
        </div>
        <p className="mt-0.5 text-sm font-semibold text-ink">
          {pesos(compra.precioARS)}
        </p>
        {compra.bicicleta.numeroSerie && (
          <p className="mt-1 text-xs text-slate-warm">
            N° {compra.bicicleta.numeroSerie}
          </p>
        )}
        {compra.reservaVenceEn && (
          <CuentaRegresiva venceEn={compra.reservaVenceEn} />
        )}
      </div>

      <Link
        href={`/marketplace/${compra.publicacion.id}`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
      >
        Ver publicación
      </Link>
    </li>
  )
}
