import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { AliadosAdmin } from '@/components/rodaid/aliados-admin'

export const metadata = {
  title: 'Administración de Aliados — RODAID',
  description: 'Aprobá o rechazá las solicitudes de talleres y tiendas para ser Aliados.',
}

export default function AdminAliadosPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <AliadosAdmin />
      </main>
      <Footer />
    </div>
  )
}
