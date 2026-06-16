import {
  Wallet,
  Lock,
  Truck,
  CircleCheck,
  Fingerprint,
  FileSearch,
  RotateCcw,
} from 'lucide-react'

const STEPS = [
  {
    icon: Wallet,
    estado: 'Depósito',
    title: 'El comprador paga',
    detail:
      'El dinero entra a RODAID PAY, no a la cuenta del vendedor. Nadie toca los fondos todavía.',
  },
  {
    icon: Lock,
    estado: 'Fondos retenidos',
    title: 'Lo guardamos',
    detail:
      'El vendedor ve que el pago está confirmado y prepara el envío con tranquilidad.',
  },
  {
    icon: Truck,
    estado: 'En camino',
    title: 'La bici viaja',
    detail:
      'Cargamos un código de seguimiento. Ambas partes ven dónde está la bicicleta.',
  },
  {
    icon: CircleCheck,
    estado: 'Completada',
    title: 'Se libera el pago',
    detail:
      'Cuando confirmás la entrega, el vendedor cobra. Si hay un problema, abrís una disputa.',
  },
]

const GARANTIAS = [
  {
    icon: Fingerprint,
    title: 'Identidad de cada bici (CIT)',
    detail:
      'Toda publicación referencia el certificado de identidad de la bicicleta y su titularidad, así sabés que no es robada.',
  },
  {
    icon: RotateCcw,
    title: 'Te devolvemos el dinero',
    detail:
      'Si la bici no llega o no es la publicada, RODAID PAY reembolsa el depósito completo a tu cuenta.',
  },
  {
    icon: FileSearch,
    title: 'Historial verificable',
    detail:
      'Cada transacción guarda su línea de tiempo: depósito, envío, entrega y cualquier disputa.',
  },
]

export function RodaidPay() {
  return (
    <section id="rodaid-pay" className="relative overflow-hidden bg-ink text-paper">
      <div className="rd-grain pointer-events-none absolute inset-0 opacity-20 mix-blend-soft-light" />
      <div className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-lime">
            RODAID PAY · Escrow
          </span>
          <h2 className="mt-3 font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            El pago se libera cuando la bici llega.
          </h2>
          <p className="mt-4 text-lg text-paper/65">
            Comprar usado no debería ser un acto de fe. RODAID PAY retiene el
            dinero en custodia y solo lo entrega al vendedor cuando vos
            confirmás que todo está en orden.
          </p>
        </div>

        <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li
              key={step.estado}
              className="relative rounded-2xl border border-paper/12 bg-ink-soft/60 p-6"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-xl bg-lime text-ink">
                  <step.icon className="size-5" />
                </span>
                <span className="font-display text-5xl font-bold text-paper/10">
                  {i + 1}
                </span>
              </div>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-lime/80">
                {step.estado}
              </p>
              <h3 className="mt-1 font-display text-lg font-semibold">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-paper/55">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

export function Seguridad() {
  return (
    <section id="seguridad" className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            Por qué RODAID
          </span>
          <h2 className="mt-3 font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
            Confianza que no depende de la buena fe.
          </h2>
          <p className="mt-4 text-lg text-slate-warm">
            En el mercado de bicicletas usadas la mitad del miedo es no saber con
            quién estás tratando. Atamos cada publicación a una identidad
            verificable y cada peso a un proceso con reglas.
          </p>
        </div>

        <div className="space-y-4">
          {GARANTIAS.map((g) => (
            <div
              key={g.title}
              className="flex gap-4 rounded-2xl border border-ink/10 bg-white p-5 transition-colors hover:border-ink/25"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink text-lime">
                <g.icon className="size-5" />
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold text-ink">
                  {g.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-warm">
                  {g.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
