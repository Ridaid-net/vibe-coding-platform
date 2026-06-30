import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { AdminDashboard } from '@/components/rodaid/admin-dashboard'

export const metadata = {
  title: 'Dashboard de Administración — RODAID',
  description:
    'Operaciones y administración de la infraestructura provincial RODAID: monitor de integridad, moderación y auditoría, analítica de ecosistema y gestión de identidades y roles. Acceso con MFA obligatoria.',
}

export default function AdminPanelPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <AdminDashboard />
      </main>
      <Footer />
    </div>
  )
}
