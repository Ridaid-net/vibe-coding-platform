'use client'

import { useState } from 'react'
import { Shield, ChevronDown, Lock, Search, CheckCircle2, LogIn } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from './auth-context'

const PASOS = [
  { icon: Lock, titulo: 'Depósito seguro', descripcion: 'El comprador deposita el importe total. Los fondos quedan retenidos por RODAID PAY y no llegan al vendedor hasta confirmar la entrega.', color: 'text-[#2BBCB8]', bg: 'bg-[#2BBCB8]/10' },
  { icon: Search, titulo: 'Inspección y entrega', descripcion: 'El vendedor entrega la bicicleta. El comprador verifica que coincide con el CIT registrado en la blockchain.', color: 'text-[#F47B20]', bg: 'bg-[#F47B20]/10' },
  { icon: CheckCircle2, titulo: 'Liberación del pago', descripcion: 'Confirmada la entrega, los fondos se transfieren al vendedor. En caso de disputa, RODAID media.', color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
]

export function DropdownPagos() {
  const [open, setOpen] = useState(false)
  const { user } = useAuth()
  return (
    <div className="rounded-2xl border border-paper/10 bg-paper/5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-paper/5" aria-expanded={open}>
        <div className="flex items-center gap-2">
          <Shield className="size-4 shrink-0 text-[#2BBCB8]" />
          <span className="text-sm font-semibold text-paper">Pagos Protegidos</span>
        </div>
        <ChevronDown className={"size-4 shrink-0 text-paper/50 transition-transform duration-200 " + (open ? 'rotate-180' : '')} />
      </button>
      {open && (
        <div className="border-t border-paper/10 px-5 pb-5 pt-4">
          <ol className="space-y-4">
            {PASOS.map((paso, i) => {
              const Icon = paso.icon
              return (
                <li key={paso.titulo} className="flex gap-3">
                  <div className={"flex size-8 shrink-0 items-center justify-center rounded-full " + paso.bg}>
                    <Icon className={"size-4 " + paso.color} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-paper">{i + 1}. {paso.titulo}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-paper/55">{paso.descripcion}</p>
                  </div>
                </li>
              )
            })}
          </ol>
          <div className="mt-5">
            {user ? (
              <Link href="/garaje" className="inline-flex items-center gap-2 rounded-full bg-[#2BBCB8]/15 px-4 py-2 text-xs font-semibold text-[#2BBCB8] hover:bg-[#2BBCB8]/25">
                <Shield className="size-3.5" />
                Ver mis pagos protegidos activos
              </Link>
            ) : (
              <Link href="/ingresar?next=/garaje" className="inline-flex items-center gap-2 rounded-full border border-paper/20 px-4 py-2 text-xs font-semibold text-paper/70 hover:text-paper">
                <LogIn className="size-3.5" />
                Iniciar sesión para proteger tu compra
              </Link>
            )}
          </div>
          <p className="mt-4 text-[10px] leading-relaxed text-paper/35">Procesado a través de MercadoPago Checkout Pro — Garantía de compra protegida.</p>
        </div>
      )}
    </div>
  )
}

export default DropdownPagos
