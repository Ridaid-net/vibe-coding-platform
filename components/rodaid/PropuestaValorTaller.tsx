'use client'

import type { ReactNode } from 'react'
import { MessageCircle, Package, ShieldCheck, Store, Wrench } from 'lucide-react'

const ITEMS_TALLER = [
  { icon: Wrench, texto: 'Certificás bicis con el checklist físico de 20 puntos.' },
  { icon: ShieldCheck, texto: '$33.000 garantizados por cada CIT sellado, más el 50% si la venta se concreta.' },
  { icon: Package, texto: 'Remitos de embalaje digitales — sin papeleo, firmados con tu identidad.' },
  { icon: Store, texto: 'Publicá tus propios servicios y sumá otro canal de ingresos (a partir de 6 CITs/día).' },
  { icon: MessageCircle, texto: 'Tu WhatsApp visible para que nuevos clientes te encuentren.' },
]

/**
 * Propuesta de valor para Talleres/Tiendas -- fuente unica para /empezar
 * (BienvenidaSelector) y /aliados (antes del formulario de solicitud real).
 * `children` es la zona de accion: un boton de navegacion en /empezar, nada
 * en /aliados (el formulario de abajo ya es la accion).
 */
export function PropuestaValorTaller({
  titulo = 'Soy taller o tienda',
  desc = 'Sumate como Taller Aliado: certificá bicis, generá ingresos garantizados y sumá clientes.',
  children,
}: {
  titulo?: string
  desc?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col rounded-3xl border border-ink/10 border-l-4 border-l-[#F47B20] bg-white p-6 sm:p-8">
      <h2 className="font-display text-2xl font-bold text-ink">{titulo}</h2>
      <p className="mt-2 text-sm text-slate-warm">{desc}</p>
      <ul className="mt-6 space-y-3.5">
        {ITEMS_TALLER.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-paper-dim text-ink/60">
              <item.icon className="size-4" />
            </span>
            <span className="text-sm text-ink/85">{item.texto}</span>
          </li>
        ))}
      </ul>
      {children && <div className="mt-7">{children}</div>}
    </div>
  )
}
