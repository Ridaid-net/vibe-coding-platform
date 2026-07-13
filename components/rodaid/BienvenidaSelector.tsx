'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Bike,
  MessageCircle,
  Package,
  ShieldCheck,
  Store,
  Wallet,
  Wrench,
} from 'lucide-react'

const ITEMS_CICLISTA = [
  { icon: ShieldCheck, texto: 'Garaje Digital — toda la identidad de tus bicis, en un solo lugar.' },
  { icon: Bike, texto: 'CIT Express o Completo — identidad verificada desde $5.100.' },
  { icon: Store, texto: 'Vendé protegido en el Marketplace — el pago queda retenido hasta que la bici llega.' },
  { icon: ShieldCheck, texto: 'Denunciá un robo en segundos y sumá tu bici a la red de alerta.' },
  { icon: Wallet, texto: 'Bici-Salud (mantenimiento predictivo) y tu saldo SUBE, a un toque.' },
]

const ITEMS_TALLER = [
  { icon: Wrench, texto: 'Certificás bicis con el checklist físico de 20 puntos.' },
  { icon: ShieldCheck, texto: '$33.000 garantizados por cada CIT sellado, más el 50% si la venta se concreta.' },
  { icon: Package, texto: 'Remitos de embalaje digitales — sin papeleo, firmados con tu identidad.' },
  { icon: Store, texto: 'Publicá tus propios servicios y sumá otro canal de ingresos (a partir de 6 CITs/día).' },
  { icon: MessageCircle, texto: 'Tu WhatsApp visible para que nuevos clientes te encuentren.' },
]

export function BienvenidaSelector() {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            Bienvenido a RODAID
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
            Elegí cómo querés empezar
          </h1>
        </div>
        <Link
          href="/ingresar"
          className="shrink-0 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
        >
          Ya tengo cuenta — Ingresar
        </Link>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <PerfilCard
          titulo="Soy ciclista"
          desc="Identidad digital, verificación y una forma segura de comprar y vender tu bici."
          items={ITEMS_CICLISTA}
          acento="border-l-lime-deep"
          href="/ingresar?modo=registro"
          cta="Continuar como Ciclista"
          ctaClase="bg-ink text-paper hover:bg-ink-soft"
        />
        <PerfilCard
          titulo="Soy taller o tienda"
          desc="Sumate como Taller Aliado: certificá bicis, generá ingresos garantizados y sumá clientes."
          items={ITEMS_TALLER}
          acento="border-l-[#F47B20]"
          href="/aliados"
          cta="Sumar mi Taller o Tienda"
          ctaClase="bg-[#F47B20] text-white hover:bg-[#F47B20]/90"
        />
      </div>
    </div>
  )
}

function PerfilCard({
  titulo,
  desc,
  items,
  acento,
  href,
  cta,
  ctaClase,
}: {
  titulo: string
  desc: string
  items: { icon: typeof Bike; texto: string }[]
  acento: string
  href: string
  cta: string
  ctaClase: string
}) {
  return (
    <div className={`flex flex-col rounded-3xl border border-ink/10 border-l-4 ${acento} bg-white p-6 sm:p-8`}>
      <h2 className="font-display text-2xl font-bold text-ink">{titulo}</h2>
      <p className="mt-2 text-sm text-slate-warm">{desc}</p>

      <ul className="mt-6 flex-1 space-y-3.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-paper-dim text-ink/60">
              <item.icon className="size-4" />
            </span>
            <span className="text-sm text-ink/85">{item.texto}</span>
          </li>
        ))}
      </ul>

      <Link
        href={href}
        className={`mt-7 inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-colors ${ctaClase}`}
      >
        {cta}
        <ArrowRight className="size-4" />
      </Link>
    </div>
  )
}
