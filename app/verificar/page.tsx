import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { Verificador } from '@/components/rodaid/verificador'

export const metadata = {
  title: 'Verificar una bici — RODAID',
  description:
    'Consultá el estado de identidad de cualquier bicicleta por su número de serie o código CIT. Gratis, anónimo y sin cuenta.',
}

export default function VerificarPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
        <Verificador />
      </main>
      <Footer />
    </div>
  )
}
