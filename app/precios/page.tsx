import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'

export const metadata = {
  title: 'Precios y Comisiones — RODAID',
  description:
    'Todos los valores vigentes de RODAID: CIT Express, CIT Completo/Transferencia, fees del Taller Aliado, y cómo protegemos tu venta.',
}

export default function PreciosPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
        <header className="mb-10">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            RODAID
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
            Precios y Comisiones
          </h1>
          <p className="mt-3 max-w-2xl text-base text-slate-warm">
            Todos los valores vigentes de RODAID, en un solo lugar.
          </p>
        </header>

        <section className="mb-14">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-warm">
            Cuadros tarifarios
          </p>
          <p className="mb-6 text-sm text-slate-warm">Información vigente, ya en producción.</p>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="flex flex-col rounded-2xl border border-ink/10 bg-white p-6">
              <span className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#2BBCB8]">
                CIT Express
              </span>
              <p className="mb-2 font-display text-2xl font-bold text-ink">$5.100 ARS</p>
              <p className="mb-4 text-sm leading-relaxed text-slate-warm">
                Identidad básica y rápida: verificamos que el número de serie sea legítimo y que la
                bici no figure como robada. Ideal para el uso diario.
              </p>
              <div className="mt-auto rounded-xl bg-slate-50 p-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-warm">
                  Vigencia
                </p>
                <p className="text-sm font-semibold text-ink">12 meses</p>
                <p className="mt-1 text-xs text-slate-warm">Renovable en cualquier taller aliado</p>
              </div>
            </div>

            <div className="flex flex-col rounded-2xl border border-ink/10 bg-white p-6">
              <span className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#F47B20]">
                CIT Completo / Transferencia
              </span>
              <p className="mb-2 font-display text-2xl font-bold text-ink">$28.500 ARS</p>
              <p className="mb-4 text-sm leading-relaxed text-slate-warm">
                Certificación técnica completa: inspección de 20 puntos realizada por un Taller
                Aliado RODAID. Es el certificado que habilita la publicación en el Marketplace.
              </p>
              <div className="mt-auto rounded-xl bg-slate-50 p-4">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-warm">
                  Vigencia
                </p>
                <p className="text-sm font-semibold text-ink">Hasta la transferencia</p>
                <p className="mt-1 text-xs text-slate-warm">Se emite un CIT nuevo al cambiar de titular</p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-warm">
              Desglose de fees del CIT Completo
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-ink">$18.000 ARS</p>
                <p className="mt-1 text-xs text-slate-warm">Fee de Verificación — 100% Taller Aliado</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-ink">$15.000 ARS</p>
                <p className="mt-1 text-xs text-slate-warm">Fee de Embalaje — 100% Taller Aliado</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-ink">2% del valor de venta</p>
                <p className="mt-1 text-xs text-slate-warm">
                  Fee de Éxito — 50% RODAID / 50% Taller Aliado, solo si la venta se concreta
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-warm">
              Cómo funciona una venta, paso a paso
            </p>
            <ol className="space-y-3">
              {[
                'Publicás gratis en el Marketplace, con tu CIT Express activo.',
                'Un comprador reserva tu bici y paga la seña.',
                'Esa seña financia la verificación de 20 puntos del Taller Aliado.',
                'Una vez que el taller sella la verificación, se completa la venta: se coordina el embalaje y el comprador paga el saldo — entrega en puerta en unos 5 días hábiles.',
              ].map((paso, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-relaxed text-slate-warm">{paso}</span>
                </li>
              ))}
            </ol>
          </div>

          <p className="mt-6 text-xs text-slate-warm/70">
            Los precios se ajustan periódicamente. El valor exacto y vigente se muestra siempre antes
            de confirmar cualquier trámite.
          </p>
        </section>

        <section>
          <div className="mb-1 flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-warm">
              Cómo protegemos tu venta
            </p>
            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
              Próximamente
            </span>
          </div>
          <p className="mb-6 text-sm text-slate-warm">
            Estamos construyendo un sistema más robusto de protección para compradores y vendedores.
            Así es como va a funcionar:
          </p>

          <div className="rounded-2xl border border-dashed border-amber-300/60 bg-amber-50/40 p-6">
            <ul className="space-y-3">
              {[
                'El CIT nunca se cancela — es un hecho técnico verificado, no depende de cómo termine una venta puntual.',
                'Si una venta no se concreta por falta de pago del comprador, quien perdió la seña va a tener prioridad de recompra por unos días antes de que se ofrezca a otro comprador.',
                'Si hay una disputa entre comprador y vendedor, RODAID va a tener un sistema de reputación y revisión humana para proteger a ambas partes — con evidencia real, no acusaciones sin sustento.',
                'El Taller Aliado siempre cobra su trabajo ya ejecutado (verificación + embalaje), sin importar cómo termine la venta.',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-slate-warm">
                  <span className="mt-0.5 text-amber-500">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
