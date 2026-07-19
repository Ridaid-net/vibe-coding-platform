'use client'
import { ChatMarketplace } from '@/components/rodaid/ChatMarketplace'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  Bike,
  Eye,
  Fingerprint,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { authedFetch, getSession } from '@/lib/session'
import { ProteccionRodaidPay, RodaidPayBadge } from './rodaid-pay-badge'

interface PublicacionData {
  id: string
  vendedorId: string
  titulo: string
  descripcion: string
  precioARS: number
  precioUSD: number | null
  fotosUrls: string[]
  estado: string
  vistas: number
  bicicleta: {
    marca: string | null
    modelo: string | null
    anio: number | null
    tipo: string | null
    numeroSerie: string | null
    rodado: number | null
    talleCuadro: string | null
  }
}

interface MiReserva {
  id: string
  estado: string
}

const CIT_COMPLETO_DISPONIBLE = ['PUBLICADO_PENDIENTE_CERTIFICACION', 'PUBLICADO_CERTIFICADO']

const ars = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

export function PublicacionDetalle({ id }: { id: string }) {
  const [pub, setPub] = useState<PublicacionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fotoActiva, setFotoActiva] = useState(0)
  const [accionando, setAccionando] = useState(false)
  const [buyerId, setBuyerId] = useState<string | null>(null)
  const [miReserva, setMiReserva] = useState<MiReserva | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Lectura publica: NO usar authedFetch() aca -- forzaria ensureSession()
      // a crear una demo-session, bloqueada en produccion (403), tumbando la
      // pagina para cualquier visitante anonimo aunque el endpoint en si sea
      // publico. Si ya hay una sesion guardada la mandamos (para miReserva
      // personalizada); si no, el GET va igual, sin sesion.
      const session = getSession()
      const res = await fetch(`/api/v1/marketplace/${id}`, {
        headers: session ? { authorization: `Bearer ${session.accessToken}` } : undefined,
      })
      if (res.status === 404) {
        setError('No encontramos esta publicación. Puede que ya no esté disponible.')
        setPub(null)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as {
        publicacion: PublicacionData
        miReserva: MiReserva | null
      }
      setPub(json.publicacion)
      setMiReserva(json.miReserva)
    } catch {
      setError('No pudimos cargar la publicación. Probá de nuevo en unos segundos.')
      setPub(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Conocemos al comprador (si hay sesion) para detectar si la publicacion es
  // suya y ofrecer el mensaje adecuado en lugar de un 422 del backend. Lectura
  // pura de la sesion guardada -- mismo motivo que en cargar(), nunca hay que
  // crear una sesion nueva solo para esto.
  useEffect(() => {
    setBuyerId(getSession()?.userId ?? null)
  }, [])

  const iniciarPago = async (endpoint: 'comprar' | 'reservar' | 'confirmar-pago') => {
    if (!pub) return
    setAccionando(true)
    try {
      const res = await authedFetch(`/api/v1/marketplace/${pub.id}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = (await res.json().catch(() => ({}))) as {
        message?: string
        pago?: {
          initPoint: string
          sandboxPoint: string | null
          gateway: string
        }
      }

      if (!res.ok || !data.pago) {
        toast.error('No se pudo continuar', {
          description: data.message ?? 'Intentá de nuevo en unos instantes.',
        })
        setAccionando(false)
        return
      }

      // Redirigimos al checkout de MercadoPago. En SANDBOX preferimos el
      // sandbox_init_point; en STUB es el checkout simulado local.
      const url =
        data.pago.gateway === 'SANDBOX' && data.pago.sandboxPoint
          ? data.pago.sandboxPoint
          : data.pago.initPoint
      window.location.href = url
    } catch {
      toast.error('No se pudo continuar', {
        description: 'Revisá tu conexión e intentá nuevamente.',
      })
      setAccionando(false)
    }
  }

  if (loading) {
    return <DetalleSkeleton />
  }

  if (error || !pub) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8">
        <h1 className="font-display text-2xl font-bold text-ink">
          {error ? 'Algo salió mal' : 'Publicación no disponible'}
        </h1>
        <p className="mt-2 text-sm text-slate-warm">{error}</p>
        <Link
          href="/#comprar"
          className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
        >
          <ArrowLeft className="size-4" />
          Volver al marketplace
        </Link>
      </div>
    )
  }

  const { bicicleta } = pub
  const esVendedor = buyerId != null && buyerId === pub.vendedorId
  const disponibleCitCompleto = CIT_COMPLETO_DISPONIBLE.includes(pub.estado)
  const yaCertificada = pub.estado === 'PUBLICADO_CERTIFICADO'
  const fotos = pub.fotosUrls ?? []
  const ficha = [
    ['Marca', bicicleta.marca],
    ['Modelo', bicicleta.modelo],
    ['Tipo', bicicleta.tipo],
    ['Año', bicicleta.anio],
    ['Rodado', bicicleta.rodado],
    ['Talle', bicicleta.talleCuadro],
    ['N° de serie', bicicleta.numeroSerie],
  ].filter(([, v]) => v !== null && v !== undefined && `${v}`.length > 0)

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <Link
        href="/#comprar"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-warm transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Volver al marketplace
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12">
        {/* Galeria */}
        <div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-ink/10 bg-paper-dim">
            {fotos[fotoActiva] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fotos[fotoActiva]}
                alt={pub.titulo}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-ink/15">
                <Bike className="size-24" />
              </div>
            )}
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-1 text-[11px] font-bold text-ink">
              <Fingerprint className="size-3" />
              CIT verificada
            </span>
          </div>

          {fotos.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {fotos.map((foto, i) => (
                <button
                  key={foto + i}
                  onClick={() => setFotoActiva(i)}
                  className={`relative size-20 shrink-0 overflow-hidden rounded-xl border transition-colors ${
                    i === fotoActiva ? 'border-ink' : 'border-ink/10 hover:border-ink/30'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={foto} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-8">
            <h2 className="font-display text-lg font-bold text-ink">Descripción</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-warm">
              {pub.descripcion}
            </p>
          </div>
        </div>

        {/* Panel de compra */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-3xl border border-ink/10 bg-white p-6">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-warm">
              <span className="truncate font-medium uppercase tracking-wide">
                {[bicicleta.marca, bicicleta.modelo].filter(Boolean).join(' ') ||
                  'Bicicleta'}
              </span>
              <span className="inline-flex items-center gap-1">
                <Eye className="size-3.5" />
                {pub.vistas}
              </span>
            </div>

            <h1 className="mt-2 font-display text-2xl font-bold leading-tight text-ink">
              {pub.titulo}
            </h1>

            <div className="mt-4">
              <p className="font-display text-4xl font-bold leading-none text-ink">
                {ars.format(pub.precioARS)}
              </p>
              {pub.precioUSD != null && (
                <p className="mt-1 text-sm text-slate-warm">
                  ≈ US$ {pub.precioUSD.toLocaleString('es-AR')}
                </p>
              )}
            </div>

            <div className="mt-5">
              <RodaidPayBadge />
            </div>

            {esVendedor ? (
              <p className="mt-5 rounded-xl border border-ink/12 bg-paper-dim/60 px-4 py-3 text-sm text-slate-warm">
                Esta es tu publicación. No podés comprar tu propia bici.
              </p>
            ) : pub.estado === 'ACTIVA' ? (
              <button
                onClick={() => iniciarPago('comprar')}
                disabled={accionando}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
              >
                {accionando ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Redirigiendo al pago…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4 text-lime" />
                    Comprar protegido
                  </>
                )}
              </button>
            ) : miReserva?.estado === 'SALDO_PENDIENTE' ? (
              <>
                <p className="mt-5 rounded-xl border border-lime-deep/30 bg-lime/10 px-4 py-3 text-sm text-ink">
                  El Taller Aliado ya selló la verificación de esta bici. Confirmá el pago del saldo para completar la compra.
                </p>
                <button
                  onClick={() => iniciarPago('confirmar-pago')}
                  disabled={accionando}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {accionando ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Redirigiendo al pago…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="size-4 text-lime" />
                      Pagar saldo
                    </>
                  )}
                </button>
              </>
            ) : miReserva?.estado === 'RESERVADA' ? (
              <p className="mt-5 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                Tu seña quedó confirmada. El Taller Aliado está verificando la bici — te avisamos apenas termine.
              </p>
            ) : miReserva?.estado === 'RESERVA_PENDIENTE' ? (
              <p className="mt-5 rounded-xl border border-ink/12 bg-paper-dim/60 px-4 py-3 text-sm text-slate-warm">
                Estamos confirmando tu seña. Esto puede tardar unos segundos.
              </p>
            ) : disponibleCitCompleto ? (
              <>
                <p className="mt-5 text-xs text-slate-warm">
                  {yaCertificada
                    ? 'Esta bici ya tiene su verificación de 20 puntos sellada. Pagás el precio completo ahora y coordinamos la entrega.'
                    : 'Reservás pagando una seña, que financia la verificación de 20 puntos del Taller Aliado. Una vez sellada, pagás el saldo y coordinamos la entrega.'}
                </p>
                <button
                  onClick={() => iniciarPago('reservar')}
                  disabled={accionando}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {accionando ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Redirigiendo al pago…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="size-4 text-lime" />
                      {yaCertificada ? 'Comprar protegido' : 'Reservar'}
                    </>
                  )}
                </button>
              </>
            ) : (
              <p className="mt-5 rounded-xl border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-slate-warm">
                Esta publicación no está disponible para la compra en este momento.
              </p>
            )}

            <p className="mt-3 text-center text-xs text-slate-warm">
              Pagás con MercadoPago. El dinero queda retenido por RODAID PAY.
            </p>
          </div>

          <div className="mt-4">
            <ProteccionRodaidPay />
          </div>
          <div className="mt-4"><ChatMarketplace publicacionId={pub.id} tituloPublicacion={pub.titulo} vendedorAlias={pub.vendedorId} citActivo={true} esVendedor={esVendedor} /></div>

          {ficha.length > 0 && (
            <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink/10 bg-ink/10 text-sm">
              {ficha.map(([label, value]) => (
                <div key={String(label)} className="bg-white px-4 py-3">
                  <dt className="text-xs text-slate-warm">{label}</dt>
                  <dd className="mt-0.5 font-medium text-ink">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      <p className="mt-10 flex items-center justify-center gap-2.5 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-[#2BBCB8]">
        <span className="size-1.5 rounded-full bg-[#F47B20]" />
        Contigo, siempre siempre bien.
        <span className="size-1.5 rounded-full bg-[#F47B20]" />
      </p>
    </div>
  )
}

function DetalleSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
      <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12">
        <div className="aspect-[4/3] animate-pulse rounded-2xl bg-paper-dim" />
        <div className="space-y-4">
          <div className="h-4 w-1/3 animate-pulse rounded bg-paper-dim" />
          <div className="h-8 w-4/5 animate-pulse rounded bg-paper-dim" />
          <div className="h-10 w-2/3 animate-pulse rounded bg-paper-dim" />
          <div className="h-12 w-full animate-pulse rounded-full bg-paper-dim" />
          <div className="h-40 w-full animate-pulse rounded-2xl bg-paper-dim" />
        </div>
      </div>
    </div>
  )
}
