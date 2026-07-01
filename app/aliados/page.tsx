import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { AliadoForm } from '@/components/rodaid/aliado-form'

export const metadata = {
  title: 'Aliados — RODAID',
  description:
    'Talleres y tiendas pueden sumarse como Aliados de RODAID para validar físicamente las bicicletas.',
}

export default function AliadosPage() {
  return (
    <div className="relative min-h-screen bg-paper" style={{backgroundImage: "linear-gradient(to bottom, rgba(255,255,255,0.15) 0%, rgba(15,30,53,0.92) 100%), url(/aliados-bg.jpg)", backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed"}}>
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white">
            Red de confianza
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-white">
            Aliados RODAID
          </h1>
        </div>
        <AliadoForm />
      </main>
      <Footer />
    </div>
  )
}
