import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
export const metadata = { title: 'Reembolsos — RODAID PAY' }
export default function ReembolsosPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
        <span className="text-xs font-semibold uppercase tracking-widest text-[#2BBCB8]">RODAID PAY · Reembolsos</span>
        <h1 className="mt-2 font-display text-4xl font-bold text-ink">Politica de Reembolsos</h1>
        <p className="mt-4 text-base text-slate-warm leading-relaxed max-w-2xl">RODAID PAY garantiza el reintegro del importe total en los casos que corresponda, procesado automaticamente a traves de MercadoPago.</p>
        <div className="mt-10 space-y-4">
          {[
            { t:'Reembolso automatico', d:'Si el vendedor no entrega la bicicleta dentro del plazo pactado, RODAID PAY inicia el reintegro automaticamente sin necesidad de disputa.', color:'text-green-600', bg:'bg-green-50', border:'border-green-200' },
            { t:'Reembolso por disputa resuelta', d:'Si la disputa se resuelve a favor del comprador (CIT no coincide, danos ocultos, documentacion faltante), el reintegro se procesa dentro de las 48hs habiles.', color:'text-green-600', bg:'bg-green-50', border:'border-green-200' },
            { t:'Reembolso parcial', d:'En casos donde parte de la transaccion fue correctamente ejecutada, RODAID puede determinar un reembolso parcial segun el dictamen tecnico.', color:'text-amber-600', bg:'bg-amber-50', border:'border-amber-200' },
            { t:'Sin reembolso', d:'Si la entrega fue confirmada por el comprador y no se abrio disputa dentro del plazo, el pago se considera liberado y no aplica reintegro.', color:'text-red-600', bg:'bg-red-50', border:'border-red-200' },
          ].map((s,i) => (
            <div key={i} className={`rounded-2xl border ${s.border} ${s.bg} p-5`}>
              <p className={`font-semibold ${s.color}`}>{s.t}</p>
              <p className="mt-1 text-sm text-slate-warm">{s.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-slate-warm">Los tiempos de acreditacion dependen de MercadoPago (generalmente 1-5 dias habiles segun el medio de pago). Para consultas: <a href="mailto:federicodegeaceo@rodaid.net" className="text-[#2BBCB8] hover:underline">federicodegeaceo@rodaid.net</a></p>
      </main>
      <Footer />
    </div>
  )
}
