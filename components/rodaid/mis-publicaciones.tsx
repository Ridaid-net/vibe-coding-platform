'use client'

import Link from 'next/link'
import {
  Eye,
  Loader2,
  MessageCircle,
  Store,
  Tag,
} from 'lucide-react'
import { useMisPublicaciones, type MiPublicacion } from '@/lib/garaje-digital'

/**
 * "Mis publicaciones" — Hito 14: gestion de venta desde el Garaje Digital.
 *
 * Lista los listados del usuario como vendedor con sus metricas (vistas,
 * contactos) y el estado de la operacion de RODAID PAY (escrow) cuando hay una
 * venta en curso. No expone datos del comprador.
 */

const ESTADO_PUB: Record<string, { label: string; clase: string }> = {
  ACTIVA: { label: 'Activa', clase: 'bg-lime/25 text-ink' },
  PAUSADA: { label: 'Pausada', clase: 'bg-paper-dim text-slate-warm' },
  VENDIDA: { label: 'Vendida', clase: 'bg-[#0a7d5a]/12 text-[#0a7d5a]' },
  CANCELADA: { label: 'Cancelada', clase: 'bg-clay/12 text-clay' },
  RECHAZADA: { label: 'Rechazada', clase: 'bg-clay/12 text-clay' },
}

const ESTADO_TX: Record<string, { label: string; clase: string }> = {
  DEPOSITO_PENDIENTE: {
    label: 'Esperando pago del comprador',
    clase: 'bg-amber-100 text-amber-700',
  },
  FONDOS_RETENIDOS: {
    label: 'Fondos retenidos — prepará el envío',
    clase: 'bg-amber-100 text-amber-700',
  },
  EN_CAMINO: { label: 'En camino', clase: 'bg-amber-100 text-amber-700' },
  COMPLETADA: {
    label: 'Venta completada',
    clase: 'bg-[#0a7d5a]/12 text-[#0a7d5a]',
  },
  DISPUTADA: { label: 'En disputa', clase: 'bg-clay/12 text-clay' },
  CANCELADA: { label: 'Cancelada', clase: 'bg-paper-dim text-slate-warm' },
}

function pesos(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  })
}

export function MisPublicaciones() {
  const { data, isLoading } = useMisPublicaciones()
  const publicaciones = data?.publicaciones ?? null

  if (isLoading && !publicaciones) {
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

  if (!publicaciones || publicaciones.length === 0) {
    return (
      <section className="mt-12">
        <Encabezado />
        <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-ink/20 bg-white/50 px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-lime/20 text-ink">
            <Store className="size-7" />
          </span>
          <p className="mt-4 max-w-sm text-sm text-slate-warm">
            Todavía no publicaste ninguna bicicleta. Verificá una bici y
            publicala con la protección de RODAID PAY.
          </p>
          <Link
            href="/publicar"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            <Tag className="size-4 text-lime" />
            Publicar mi bici
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="mt-12">
      <Encabezado total={publicaciones.length} />
      <ul className="mt-6 space-y-3">
        {publicaciones.map((p) => (
          <PublicacionItem key={p.id} pub={p} />
        ))}
      </ul>
    </section>
  )
}

function Encabezado({ total }: { total?: number }) {
  return (
    <div className="flex items-center gap-2">
      <Store className="size-5 text-ink/60" />
      <h2 className="font-display text-2xl font-bold text-ink">
        Mis publicaciones
      </h2>
      {total !== undefined && total > 0 && (
        <span className="rounded-full bg-paper-dim px-2.5 py-0.5 text-xs font-semibold text-slate-warm">
          {total}
        </span>
      )}
    </div>
  )
}

function PublicacionItem({ pub }: { pub: MiPublicacion }) {
  const estado = ESTADO_PUB[pub.estado] ?? {
    label: pub.estado,
    clase: 'bg-paper-dim text-slate-warm',
  }
  const tx = pub.transaccion
    ? ESTADO_TX[pub.transaccion.estado] ?? {
        label: pub.transaccion.estado,
        clase: 'bg-paper-dim text-slate-warm',
      }
    : null

  return (
    <li className="flex flex-wrap items-center gap-4 rounded-2xl border border-ink/12 bg-white p-4">
      <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-paper-dim text-ink/30">
        {pub.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pub.fotoUrl}
            alt={pub.titulo}
            className="h-full w-full object-cover"
          />
        ) : (
          <Store className="size-6" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-display font-semibold text-ink">
            {pub.titulo}
          </p>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${estado.clase}`}
          >
            {estado.label}
          </span>
        </div>
        <p className="mt-0.5 text-sm font-semibold text-ink">
          {pesos(pub.precioARS)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-warm">
          <span className="inline-flex items-center gap-1">
            <Eye className="size-3.5" />
            {pub.vistas}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="size-3.5" />
            {pub.contactos}
          </span>
          {pub.bicicleta.numeroSerie && (
            <span>N° {pub.bicicleta.numeroSerie}</span>
          )}
        </div>
        {tx && (
          <div className="mt-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tx.clase}`}
            >
              {pub.transaccion?.estado === 'DEPOSITO_PENDIENTE' && (
                <Loader2 className="size-3 animate-spin" />
              )}
              RODAID PAY · {tx.label}
            </span>
            {pub.transaccion && pub.transaccion.montoVendedor > 0 && (
              <span className="ml-2 text-[11px] text-slate-warm">
                Recibís {pesos(pub.transaccion.montoVendedor)}
              </span>
            )}
          </div>
        )}
      </div>

      <Link
        href={`/marketplace/${pub.slug}`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
      >
        Ver publicación
      </Link>
    </li>
  )
}
