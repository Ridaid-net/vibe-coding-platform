import { ShieldCheck, Fingerprint, ArrowRight } from 'lucide-react'

export function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-ink text-paper"
    >
      {/* atmosphere: warm radial + faint grid + grain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 h-[36rem] w-[36rem] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(200,242,78,0.22) 0%, rgba(200,242,78,0) 70%)',
        }}
      />
      <div className="rd-grain pointer-events-none absolute inset-0 opacity-[0.25] mix-blend-soft-light" />

      <div className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8 lg:pb-28 lg:pt-24">
        {/* Left: editorial copy */}
        <div className="rd-rise">
          <span className="inline-flex items-center gap-2 rounded-full border border-paper/20 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-lime">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" />
            Bicicletas verificadas · Argentina
          </span>

          <h1 className="mt-6 font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
            Comprá la bici.
            <br />
            No el{' '}
            <span className="relative whitespace-nowrap text-lime">
              cuento.
              <svg
                aria-hidden
                viewBox="0 0 200 12"
                className="absolute -bottom-2 left-0 w-full text-lime/70"
                preserveAspectRatio="none"
              >
                <path
                  d="M2 9 C 50 2, 150 2, 198 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h1>

          <p className="mt-7 max-w-xl text-lg leading-relaxed text-paper/70">
            Cada publicación lleva la identidad de la bicicleta (CIT) y el pago
            queda retenido por <strong className="text-paper">RODAID PAY</strong>{' '}
            hasta que la recibís. Si algo no cierra, los fondos vuelven a tu
            cuenta.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="#comprar"
              className="group inline-flex items-center gap-2 rounded-full bg-lime px-6 py-3.5 text-sm font-semibold text-ink transition-transform hover:-translate-y-0.5"
            >
              Explorar el marketplace
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="#vender"
              className="inline-flex items-center gap-2 rounded-full border border-paper/25 px-6 py-3.5 text-sm font-semibold text-paper transition-colors hover:bg-paper/10"
            >
              Quiero vender
            </a>
          </div>

          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-paper/15 pt-7">
            <Stat value="1.247" label="bicis publicadas" />
            <Stat value="$0" label="al estafador" />
            <Stat value="72 h" label="garantía de entrega" />
          </dl>
        </div>

        {/* Right: escrow trust panel */}
        <div className="rd-rise [animation-delay:120ms] lg:pt-6">
          <div className="relative rounded-3xl border border-paper/15 bg-ink-soft/80 p-6 shadow-2xl backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="font-display text-sm font-semibold uppercase tracking-wider text-paper/60">
                RODAID PAY
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-lime/15 px-2.5 py-1 text-xs font-semibold text-lime">
                <ShieldCheck className="size-3.5" />
                Escrow activo
              </span>
            </div>

            <div className="mt-6 rounded-2xl bg-paper p-5 text-ink">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-warm">
                Trek Marlin 7 · 2023
              </p>
              <p className="mt-1 font-display text-3xl font-bold">$ 420.000</p>
              <div className="mt-4 flex items-center gap-3 text-sm">
                <Fingerprint className="size-5 text-clay" />
                <span>
                  CIT <strong>RD-8F2A-7C1</strong> · titularidad confirmada
                </span>
              </div>
            </div>

            <ol className="mt-6 space-y-1">
              <FlowStep
                done
                title="Depósito recibido"
                detail="El comprador pagó. RODAID retiene los fondos."
              />
              <FlowStep
                active
                title="En camino"
                detail="La bici viaja con código de seguimiento."
              />
              <FlowStep
                title="Entrega confirmada"
                detail="Liberamos el pago al vendedor."
              />
            </ol>
          </div>
        </div>
      </div>
    </section>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="font-display text-3xl font-bold text-lime">{value}</dt>
      <dd className="mt-1 text-xs leading-tight text-paper/60">{label}</dd>
    </div>
  )
}

function FlowStep({
  title,
  detail,
  done,
  active,
}: {
  title: string
  detail: string
  done?: boolean
  active?: boolean
}) {
  return (
    <li className="flex gap-3.5 py-2">
      <div className="flex flex-col items-center">
        <span
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            done
              ? 'bg-lime text-ink'
              : active
                ? 'bg-paper text-ink ring-4 ring-lime/25'
                : 'border border-paper/25 text-paper/40'
          }`}
        >
          {done ? '✓' : active ? '•' : ''}
        </span>
        <span className="mt-1 h-full w-px bg-paper/15 last:hidden" />
      </div>
      <div className="pb-1">
        <p
          className={`text-sm font-semibold ${active ? 'text-paper' : done ? 'text-paper/80' : 'text-paper/45'}`}
        >
          {title}
        </p>
        <p className="text-xs leading-snug text-paper/45">{detail}</p>
      </div>
    </li>
  )
}
