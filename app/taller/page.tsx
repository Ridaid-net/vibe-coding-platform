import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'
import { Inspecciones } from '@/components/rodaid/inspecciones'

export const metadata = {
  title: 'Portal Taller Aliado — RODAID',
  description: 'Panel del taller aliado RODAID: emitir CITs, gestionar inspecciones y ver ingresos.',
}

export default function TallerPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <div className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#F47B20]">RODAID · Portal Aliado</span>
          <h1 className="mt-2 font-display text-3xl font-bold text-[#0F1E35]">Panel del Taller Aliado</h1>
          <p className="mt-2 text-sm text-slate-warm">Emití CITs, gestioná inspecciones y seguí tus ingresos desde tu panel exclusivo.</p>
        </div>
        <Inspecciones />
      </main>
      <Footer />
    </div>
  )
}
