import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
export const metadata = { title: 'Pago Protegido — RODAID PAY' }
export default function PagoProtegidoPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
        <span className="text-xs font-semibold uppercase tracking-widest text-[#2BBCB8]">RODAID PAY · Escrow</span>
        <h1 className="mt-2 font-display text-4xl font-bold text-ink">Pago Protegido</h1>
        <p className="mt-4 text-base text-slate-warm leading-relaxed max-w-2xl">El dinero de tu compra queda retenido por RODAID PAY y no llega al vendedor hasta que vos confirmes que recibiste la bicicleta en las condiciones pactadas.</p>
        <div className="mt-10 space-y-6">
          {[
            { n:'1', t:'El comprador deposita', d:'Al confirmar la compra, el importe total se deposita en la cuenta escrow de RODAID PAY a través de MercadoPago Checkout Pro. El vendedor es notificado para preparar el envío.' },
            { n:'2', t:'RODAID retiene los fondos', d:'Los fondos quedan custodiados por RODAID PAY durante todo el proceso de entrega. Ni el vendedor ni RODAID pueden disponer de ellos hasta la confirmación.' },
            { n:'3', t:'El comprador verifica', d:'Una vez recibida la bicicleta, el comprador tiene un plazo para verificar que coincide con el CIT certificado. Si todo está bien, confirma la entrega.' },
            { n:'4', t:'Se libera el pago', d:'Confirmada la entrega sin inconvenientes, los fondos se transfieren automáticamente al vendedor. El 80% va al vendedor y el 20% es la comisión RODAID.' },
          ].map(s => (
            <div key={s.n} className="flex gap-4 rounded-2xl border border-ink/10 bg-white p-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0F1E35] text-sm font-bold text-white">{s.n}</span>
              <div><p className="font-semibold text-ink">{s.t}</p><p className="mt-1 text-sm text-slate-warm">{s.d}</p></div>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-2xl bg-[#0F1E35] p-6 text-white">
          <p className="text-sm font-semibold text-[#2BBCB8] uppercase tracking-wide mb-2">Garantia</p>
          <p className="text-sm leading-relaxed text-white/80">Si el vendedor no entrega la bicicleta o esta no coincide con lo publicado, RODAID PAY reintegra el 100% del importe al comprador. Tu dinero siempre esta protegido.</p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
