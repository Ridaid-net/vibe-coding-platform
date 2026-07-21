'use client'
import { ChatMarketplace } from './ChatMarketplace'

import Link from 'next/link'
import Image from 'next/image'
import { Award, Eye, ShieldCheck } from 'lucide-react'

/** Score de Confianza de la Bici -- ver CLAUDE.md y score-confianza.service.ts. */
export interface ScoreConfianza {
  total: number
  badge: 'oro' | 'bronce' | null
}

export interface Publicacion {
  id: string
  titulo: string
  descripcion: string
  precioARS: number
  precioUSD: number | null
  fotosUrls: string[]
  slug: string
  vistas: number
  estado?: string
  citEstado?: string | null
  vendedor?: string | null
  bicicleta: {
    marca: string | null
    modelo: string | null
    anio: number | null
    tipo: string | null
    rodado?: number | null
    talleCuadro?: string | null
  }
  scoreConfianza?: ScoreConfianza | null
}

const ars = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

export function ListingCard({ pub }: { pub: Publicacion }) {
  const foto = pub.fotosUrls?.[0]
  const { marca, modelo, anio, tipo, rodado, talleCuadro } = pub.bicicleta
  const citCompleto = pub.estado != null && pub.estado !== 'ACTIVA'
  const esOro = pub.scoreConfianza?.badge === 'oro'

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white transition-all duration-300 hover:-translate-y-1 hover:border-ink/20 hover:shadow-[0_24px_48px_-24px_rgba(20,22,14,0.35)]">
      <div className="relative aspect-[4/3] overflow-hidden bg-paper-dim">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={foto}
            alt={pub.titulo}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <BikeGlyph />
        )}

        {tipo && (
          <span className="absolute left-3 top-3 rounded-full bg-ink/85 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-paper backdrop-blur-sm">
            {tipo}
          </span>
        )}
        <div className="absolute right-3 top-3">
          <HexSeal completo={citCompleto} oro={esOro} />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-2 text-xs text-slate-warm">
          <span className="truncate font-medium uppercase tracking-wide">
            {[marca, modelo].filter(Boolean).join(' ') || 'Bicicleta'}
          </span>
          {anio && <span className="shrink-0">{anio}</span>}
        </div>

        <h3 className="mt-1.5 line-clamp-2 font-display text-base font-semibold leading-snug text-ink">
          {pub.titulo}
        </h3>

        {(talleCuadro || rodado || pub.scoreConfianza?.badge) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {pub.scoreConfianza?.badge && <ScoreBadge badge={pub.scoreConfianza.badge} />}
            {talleCuadro && <Chip>Talle {talleCuadro}</Chip>}
            {rodado != null && <Chip>Rodado {rodado}</Chip>}
          </div>
        )}

        <div className="mt-auto pt-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="font-display text-2xl font-bold leading-none text-ink">
                {ars.format(pub.precioARS)}
              </p>
              {pub.precioUSD != null && (
                <p className="mt-1 text-xs text-slate-warm">
                  ≈ US$ {pub.precioUSD.toLocaleString('es-AR')}
                </p>
              )}
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-slate-warm">
              <Eye className="size-3.5" />
              {pub.vistas}
            </span>
          </div>

          <Link
            href={`/marketplace/${pub.id}`}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            <ShieldCheck className="size-4 text-lime" />
            {citCompleto ? 'Reservar' : 'Comprar protegido'}
          </Link>
        </div>
        <div className="mt-3">
          <ChatMarketplace
            publicacionId={pub.id}
            tituloPublicacion={pub.titulo ?? (pub.bicicleta.marca ?? "") + " " + (pub.bicicleta.modelo ?? "")}
            vendedorAlias={pub.vendedor ?? "Vendedor"}
            citActivo={pub.citEstado === "activo" || pub.citEstado === "verificado"}
            esVendedor={false}
          />
        </div>
      </div>
    </article>
  )
}

/**
 * Sello del CIT -- reemplaza el badge generico "Certified" por un escudo
 * propio (public/cit-badge-shield.png, provisto por Federico 2026-07-21).
 * El anillo pasa a dorado cuando la bici tiene el badge 'oro' del Score de
 * Confianza (ver score-confianza.service.ts) -- el color del anillo reusa la
 * paleta real del proyecto (globals.css), aunque el arte del escudo en si
 * es una imagen rasterizada, no puede recolorearse dinamicamente como el
 * SVG hexagonal que reemplazo.
 */
function HexSeal({ completo, oro }: { completo: boolean; oro: boolean }) {
  const ringClass = oro ? 'ring-amber-400' : 'ring-lime'
  return (
    <div
      className="relative size-11 shrink-0 drop-shadow-md"
      title={citTitulo(completo, oro)}
    >
      <div className={`h-full w-full overflow-hidden rounded-full bg-white ring-2 ${ringClass}`}>
        <Image
          src="/cit-badge-shield.png"
          alt=""
          width={88}
          height={88}
          className="h-full w-full object-cover"
        />
      </div>
      <span className="absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center justify-center whitespace-nowrap rounded-full bg-ink px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-paper">
        {completo ? 'CIT+' : 'CIT'}
      </span>
    </div>
  )
}

function citTitulo(completo: boolean, oro: boolean): string {
  const base = completo ? 'CIT Completo' : 'CIT'
  return oro ? `${base} · Score de Confianza Oro` : base
}

function ScoreBadge({ badge }: { badge: 'oro' | 'bronce' }) {
  const clase =
    badge === 'oro'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-orange-50 text-orange-700'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${clase}`}
    >
      <Award className="size-3" />
      {badge === 'oro' ? 'Confianza Oro' : 'Confianza Bronce'}
    </span>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-ink/12 bg-paper-dim/60 px-2 py-0.5 text-[11px] font-medium text-slate-warm">
      {children}
    </span>
  )
}

function BikeGlyph() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <svg
        viewBox="0 0 120 70"
        className="w-2/3 text-ink/15"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="28" cy="50" r="16" />
        <circle cx="92" cy="50" r="16" />
        <path d="M28 50 L52 50 L70 22 L40 22 M52 50 L74 22 M92 50 L74 22 M70 22 L78 22" />
        <path d="M40 22 L34 14 L44 14" />
      </svg>
    </div>
  )
}
