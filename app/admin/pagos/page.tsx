import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { PagosDashboard } from '@/components/rodaid/pagos-dashboard'

export const metadata = {
  title: 'Dashboard Financiero — RODAID PAY',
  description:
    'Total recaudado, comisiones de RODAID, pagos a aliados y disputas abiertas.',
}

export default function AdminPagosPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <PagosDashboard />
      </main>
      <Footer />
    </div>
  )
}
