import { Suspense } from 'react'
import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { LoginForm } from '@/components/rodaid/login-form'

export const metadata = {
  title: 'Ingresar — RODAID',
  description:
    'Ingresá a RODAID con tu email o con Mendoza por Mí, la identidad unificada del Gobierno de Mendoza.',
}

export default function IngresarPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
