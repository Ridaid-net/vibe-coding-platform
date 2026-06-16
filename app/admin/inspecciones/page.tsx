import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { Inspecciones } from '@/components/rodaid/inspecciones'

export const metadata = {
  title: 'Panel de Inspecciones — RODAID',
  description:
    'Validación física delegada: inspectores y aliados aprueban la inspección de una bicicleta o reportan discrepancias.',
}

export default function InspeccionesPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <Inspecciones />
      </main>
      <Footer />
    </div>
  )
}
