import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { BienvenidaSelector } from '@/components/rodaid/BienvenidaSelector'

export const metadata = {
  title: 'Empezar — RODAID',
  description:
    'Elegí cómo querés usar RODAID: identidad digital para tu bici o Taller Aliado certificador.',
}

/**
 * /empezar — pantalla previa al login/registro (nunca reemplaza a /ingresar).
 * Solo para quien todavia no tiene cuenta: explica que ofrece RODAID para
 * cada perfil (particular / Taller Aliado) antes de elegir el camino de
 * registro real. Quien ya tiene cuenta usa el link "Ya tengo cuenta", que
 * salta directo a /ingresar sin pasar por esta pantalla.
 */
export default function EmpezarPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
        <BienvenidaSelector />
      </main>
      <Footer />
    </div>
  )
}
