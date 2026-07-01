import { ArrowRight, Camera, Fingerprint, BadgeDollarSign } from 'lucide-react'
import Link from 'next/link'

const PASOS = [
  {
    icon: Fingerprint,
    title: 'Verificá tu bici',
    detail: 'Asociá el CIT y confirmá que sos el titular.',
  },
  {
    icon: Camera,
    title: 'Subí las fotos',
    detail: 'Título, descripción y precio en pesos. Listo en minutos.',
  },
  {
    icon: BadgeDollarSign,
    title: 'Cobrá seguro',
    detail: 'Recibís el pago apenas se confirma la entrega.',
  },
]

export function SellCta() {
  return (
    <section id="vender" className="mx-auto max-w-7xl px-5 pt-16 pb-24 sm:px-8">
      <div className="relative overflow-hidden rounded-[2rem] bg-lime px-6 py-14 sm:px-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-ink/10"
        />
        <div className="relative grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
              ¿Tenés una bici para vender?
            </h2>
            <p className="mt-4 max-w-md text-lg text-ink/70">
              Publicar es gratis. Cobrás una comisión transparente solo cuando
              la venta se concreta — sin sorpresas, sin letra chica.
            </p>
            <Link
              href="/publicar"
              className="group mt-8 inline-flex items-center gap-2 rounded-full bg-ink px-7 py-4 text-sm font-semibold text-paper transition-transform hover:-translate-y-0.5"
            >
              Publicar mi bicicleta
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <ol className="space-y-3">
            {PASOS.map((p, i) => (
              <li
                key={p.title}
                className="flex items-center gap-4 rounded-2xl bg-ink/5 p-4 backdrop-blur-sm"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink text-lime">
                  <p.icon className="size-5" />
                </span>
                <div>
                  <p className="font-display font-semibold text-ink">
                    <span className="mr-1.5 text-ink/40">0{i + 1}</span>
                    {p.title}
                  </p>
                  <p className="text-sm text-ink/65">{p.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
