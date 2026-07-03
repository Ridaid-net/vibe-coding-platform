import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
export const metadata = { title: 'Seguimiento — RODAID PAY' }
export default function SeguimientoPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
        <span className="text-xs font-semibold uppercase tracking-widest text-[#2BBCB8]">RODAID PAY · Seguimiento</span>
        <h1 className="mt-2 font-display text-4xl font-bold text-ink">Seguimiento de tu Compra</h1>
        <p className="mt-4 text-base text-slate-warm leading-relaxed max-w-2xl">Seguí el estado de tu transaccion en tiempo real desde tu Garaje Digital. Cada etapa del proceso es transparente y trazable.</p>
        <div className="mt-10 space-y-3">
          {[
            { estado:'DEPOSITO_PENDIENTE', label:'Deposito pendiente', d:'El comprador debe completar el pago para iniciar el proceso.', color:'bg-amber-100 text-amber-700' },
            { estado:'FONDOS_RETENIDOS', label:'Fondos retenidos', d:'El pago fue recibido. RODAID PAY custodia los fondos. El vendedor prepara el envio.', color:'bg-blue-100 text-blue-700' },
            { estado:'EN_ESPERA_DE_LIBERACION', label:'En espera de liberacion', d:'La bicicleta fue entregada. El comprador tiene el plazo para verificar y confirmar.', color:'bg-purple-100 text-purple-700' },
            { estado:'DISPUTA_ACTIVA', label:'Disputa activa', d:'Se abrio una disputa. El pago queda retenido hasta la resolucion del caso.', color:'bg-red-100 text-red-700' },
            { estado:'COMPLETADA', label:'Completada', d:'La entrega fue confirmada. El pago fue liberado al vendedor exitosamente.', color:'bg-green-100 text-green-700' },
            { estado:'REEMBOLSADA', label:'Reembolsada', d:'La transaccion fue cancelada y el importe fue reintegrado al comprador.', color:'bg-gray-100 text-gray-700' },
          ].map((s,i) => (
            <div key={i} className="flex items-start gap-4 rounded-2xl border border-ink/10 bg-white p-4">
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${s.color}`}>{s.label}</span>
              <p className="text-sm text-slate-warm">{s.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-2xl bg-[#0F1E35]/5 p-5">
          <p className="text-sm font-semibold text-ink mb-2">Como ver el seguimiento</p>
          <p className="text-sm text-slate-warm">Ingresa a <a href="/garaje" className="text-[#2BBCB8] hover:underline">Mi Garaje Digital</a> → seccion de transacciones activas. Ahi vas a ver el estado actual y el historial completo de cada operacion.</p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
