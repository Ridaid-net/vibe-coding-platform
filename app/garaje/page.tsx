import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { Garaje } from '@/components/rodaid/garaje'
import { NotificacionesCard } from '@/components/rodaid/notificaciones-card'

export const metadata = {
  title: 'Mi Garaje — RODAID',
  description:
    'Registrá tus bicicletas y verificá su identidad (CIT) para publicarlas en RODAID.',
}

export default function GarajePage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <Garaje />
        <NotificacionesCard />
      </main>
      <Footer />
    </div>
  )
}
