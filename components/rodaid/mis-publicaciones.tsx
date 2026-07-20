'use client'

import { useState } from 'react'
import Link from 'next/link'
import { mutate } from 'swr'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Eye,
  Loader2,
  MessageCircle,
  Package,
  Store,
  Tag,
  Trash2,
  Truck,
} from 'lucide-react'
import { useMisPublicaciones, retirarPublicacion, type MiPublicacion } from '@/lib/garaje-digital'
import { generarRemito, descargarRemitoPdf } from '@/lib/remitos'

/**
 * Estados desde los que el vendedor puede retirar su propia publicacion --
 * espejo client-side de ESTADOS_PUBLICACION_RETIRABLES en escrow.service.ts.
 * El backend es la fuente de verdad real (vuelve a validar bajo lock); esto
 * solo decide si mostrar el boton.
 */
const ESTADOS_RETIRABLES = new Set([
  'ACTIVA',
  'PUBLICADO_PENDIENTE_CERTIFICACION',
  'PUBLICADO_CERTIFICADO',
])

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
  PUBLICADO_PENDIENTE_CERTIFICACION: {
    label: 'Esperando certificación del Taller',
    clase: 'bg-amber-100 text-amber-700',
  },
  PUBLICADO_CERTIFICADO: {
    label: 'Certificada — lista para vender',
    clase: 'bg-lime/25 text-ink',
  },
  RESERVADO: { label: 'Reservada', clase: 'bg-amber-100 text-amber-700' },
  EJECUTANDO_LOGISTICA: {
    label: 'En logística — esperando el saldo',
    clase: 'bg-amber-100 text-amber-700',
  },
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
  RESERVA_PENDIENTE: {
    label: 'Esperando la seña del comprador',
    clase: 'bg-amber-100 text-amber-700',
  },
  RESERVADA: {
    label: 'Seña confirmada — verificación en curso',
    clase: 'bg-amber-100 text-amber-700',
  },
  SALDO_PENDIENTE: {
    label: 'Esperando el pago del saldo',
    clase: 'bg-amber-100 text-amber-700',
  },
  RESERVA_VENCIDA: { label: 'Reserva vencida', clase: 'bg-clay/12 text-clay' },
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
            {pub.transaccion?.aliadoId && pub.transaccion.estado === 'FONDOS_RETENIDOS' && (
              <RemitoAccion transaccion={pub.transaccion} />
            )}
            {(pub.transaccion?.estado === 'RESERVA_VENCIDA' ||
              pub.transaccion?.estado === 'CANCELADA') && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-warm">
                Tu bici y su CIT no se vieron afectados — podés volver a
                publicarla con otro comprador sin ningún trámite adicional.
              </p>
            )}
          </div>
        )}
        {ESTADOS_RETIRABLES.has(pub.estado) && (
          <RetirarPublicacionAccion pub={pub} />
        )}
      </div>

      <Link
        // FIX (reportado en vivo 2026-07-18): la ruta real es /marketplace/[id]
        // (ver app/api/v1/marketplace/[id]/route.ts, WHERE mp.id = $1) -- pasar
        // el slug producia "invalid input syntax for type uuid" en Postgres,
        // que jsonError() convertia en un 500 generico ("Algo salió mal"). Mismo
        // patron ya correcto en listing-card.tsx/mis-compras.tsx (usan .id).
        href={`/marketplace/${pub.id}`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/40"
      >
        Ver publicación
      </Link>
    </li>
  )
}

/**
 * El vendedor retira su propia publicacion. Solo se renderiza cuando
 * ESTADOS_RETIRABLES incluye pub.estado -- sin comprador comprometido con
 * plata en juego (el backend vuelve a validar esto bajo lock, ver
 * retirarPublicacion() en escrow.service.ts). Mismo patron de confirmacion
 * en dos pasos que RemitoEstadoCompra en mis-compras.tsx.
 */
function RetirarPublicacionAccion({ pub }: { pub: MiPublicacion }) {
  const [modoConfirmar, setModoConfirmar] = useState(false)
  const [retirando, setRetirando] = useState(false)

  const retirar = async () => {
    if (retirando) return
    setRetirando(true)
    try {
      await retirarPublicacion(pub.id)
      await mutate('/api/marketplace/mis-publicaciones')
      toast.success('Publicación retirada', {
        description: 'Tu bici y su CIT no se vieron afectados — podés volver a publicarla cuando quieras.',
      })
    } catch (err) {
      toast.error('No pudimos retirar la publicación', { description: (err as Error).message })
    } finally {
      setRetirando(false)
      setModoConfirmar(false)
    }
  }

  if (modoConfirmar) {
    return (
      <div className="mt-2 rounded-xl border border-clay/25 bg-clay/5 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-clay">
          <AlertTriangle className="size-3.5" />
          ¿Retirar esta publicación del marketplace?
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-warm">
          Tu bici y su CIT no se ven afectados — podés volver a publicarla cuando quieras.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={retirar}
            disabled={retirando}
            className="inline-flex items-center gap-1.5 rounded-full bg-clay px-3 py-1.5 text-[11px] font-semibold text-paper disabled:opacity-50"
          >
            {retirando ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            Sí, retirar
          </button>
          <button
            type="button"
            onClick={() => setModoConfirmar(false)}
            disabled={retirando}
            className="rounded-full border border-ink/15 px-3 py-1.5 text-[11px] font-semibold text-ink disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setModoConfirmar(true)}
      className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-clay hover:underline"
    >
      <Trash2 className="size-3.5" />
      Retirar publicación
    </button>
  )
}

/**
 * Fase 6b (CIT Completo): acción del Remito de Embalaje y Despacho, visible
 * cuando el saldo ya se confirmó (FONDOS_RETENIDOS) y la venta pasa por un
 * Taller Aliado. Sin remito todavía: botón "Generar Remito" (acción
 * explícita del vendedor). Con remito: estado + link al PDF.
 */
function RemitoAccion({
  transaccion,
}: {
  transaccion: NonNullable<MiPublicacion['transaccion']>
}) {
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const verRemito = (numero: string) => {
    descargarRemitoPdf(numero).catch((err) => {
      toast.error('No pudimos descargar el remito', { description: (err as Error).message })
    })
  }

  if (transaccion.remito?.estado === 'DESPACHADO') {
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-[#0a7d5a]">
        <Truck className="size-3.5" />
        Bici despachada por {transaccion.tallerNombre ?? 'el taller'}
        <button
          type="button"
          onClick={() => verRemito(transaccion.remito!.numero)}
          className="underline-offset-2 hover:underline"
        >
          Ver remito
        </button>
      </p>
    )
  }

  if (transaccion.remito?.estado === 'GENERADO') {
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-amber-700">
        <Package className="size-3.5" />
        Remito enviado a {transaccion.tallerNombre ?? 'el taller'} — esperando el despacho
        <button
          type="button"
          onClick={() => verRemito(transaccion.remito!.numero)}
          className="underline-offset-2 hover:underline"
        >
          Ver remito
        </button>
      </p>
    )
  }

  const generar = async () => {
    if (generando) return
    setGenerando(true)
    setError(null)
    try {
      await generarRemito(transaccion.id)
      await mutate('/api/marketplace/mis-publicaciones')
      toast.success('Remito generado', {
        description: `${transaccion.tallerNombre ?? 'El taller'} ya fue notificado para embalar la bici.`,
      })
    } catch (err) {
      setError((err as Error).message)
      toast.error('No pudimos generar el remito', { description: (err as Error).message })
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={generar}
        disabled={generando}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#0F1E35] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#0F1E35]/80 disabled:opacity-50"
      >
        {generando ? <Loader2 className="size-3 animate-spin" /> : <Package className="size-3" />}
        Generar Remito
      </button>
      {error && <p className="mt-1 text-[11px] text-clay">{error}</p>}
    </div>
  )
}
