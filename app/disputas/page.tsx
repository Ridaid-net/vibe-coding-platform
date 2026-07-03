import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
export const metadata = { title: 'Disputas — RODAID PAY' }
export default function DisputasPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
        <span className="text-xs font-semibold uppercase tracking-widest text-clay">RODAID PAY · Disputas</span>
        <h1 className="mt-2 font-display text-4xl font-bold text-ink">Centro de Resolucion de Disputas</h1>
        <p className="mt-4 text-base text-slate-warm leading-relaxed max-w-2xl">Si detectas un problema con tu compra, podes abrir una disputa. El pago queda retenido hasta la resolucion y RODAID actua como mediador tecnico.</p>
        <div className="mt-10 space-y-4">
          {[
            { nivel:'Nivel 1', t:'Mediacion automatica', d:'Seleccionas el motivo (CIT no coincide, documentacion faltante, danos ocultos) y cargás evidencia. El sistema analiza automaticamente.' },
            { nivel:'Nivel 2', t:'Revision tecnica RODAID', d:'Un auditor de RODAID revisa el CIT original, la evidencia cargada y el historial de la transaccion. Si el CIT esta validado, dictamina a favor del vendedor.' },
            { nivel:'Nivel 3', t:'Resolucion administrativa', d:'Si el comprador tiene razon: reintegro automatico via MercadoPago. Si el vendedor tiene razon: liberacion del pago. Vendedores de mala fe quedan inhabilitados.' },
          ].map((s,i) => (
            <div key={i} className="rounded-2xl border border-ink/10 bg-white p-5">
              <span className="text-xs font-semibold uppercase tracking-wide text-clay">{s.nivel}</span>
              <p className="mt-1 font-semibold text-ink">{s.t}</p>
              <p className="mt-1 text-sm text-slate-warm">{s.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-800 mb-1">Clausula de Arbitraje RODAID</p>
          <p className="text-xs text-amber-700 leading-relaxed">Al iniciar una disputa, el usuario acepta la intervencion de RODAID como mediador tecnico. La decision del comite de auditoria basada en el CIT y la evidencia tecnica es definitiva para la gestion del fondo en garantia, sin perjuicio de las acciones legales ante la Justicia Provincial.</p>
        </div>
        <p className="mt-6 text-sm text-slate-warm">Para abrir una disputa, ingresa a tu <a href="/garaje" className="text-[#2BBCB8] hover:underline">Garaje Digital</a> y hacé click en "Abrir Disputa" en la transaccion correspondiente.</p>
      </main>
      <Footer />
    </div>
  )
}
