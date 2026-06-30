import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { AnaliticaMapa } from '@/components/rodaid/analitica-mapa'

export const metadata = {
  title: 'Analítica de Seguridad — RODAID',
  description:
    'Mapa de calor anónimo y agregado de la actividad de seguridad sobre el Gran Mendoza: densidad de consultas y denuncias, con alertas de puntos calientes.',
}

export default function AnaliticaPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <AnaliticaMapa />
      </main>
      <Footer />
    </div>
  )
}
