import { Suspense } from 'react'
import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { ConectarConsent } from '@/components/rodaid/conectar-consent'

export const metadata = {
  title: 'Conectar con RODAID — Consentimiento',
  description:
    'Autorizá a una aplicación de terceros a leer el estado público verificado de tu bicicleta. Vos siempre das el consentimiento expreso; nunca se comparten tus datos personales.',
}

export default function ConectarPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-xl px-5 py-12 sm:px-8">
        <Suspense
          fallback={
            <div className="rounded-2xl border border-ink/10 bg-paper-dim/40 p-8 text-center text-slate-warm">
              Cargando solicitud…
            </div>
          }
        >
          <ConectarConsent />
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
