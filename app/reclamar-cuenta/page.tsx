import { Suspense } from 'react'
import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { ReclamarCuentaForm } from '@/components/rodaid/ReclamarCuentaForm'

export const metadata = {
  title: 'Activá tu cuenta — RODAID',
  description: 'Elegí tu contraseña para activar tu cuenta RODAID.',
}

export default function ReclamarCuentaPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-lg px-5 py-14 sm:px-8 sm:py-20">
        <Suspense fallback={null}>
          <ReclamarCuentaForm />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
