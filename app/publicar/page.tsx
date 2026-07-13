import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { PublicarFlow } from '@/components/rodaid/publicar-flow'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export const metadata = {
  title: 'Publicar mi bici — RODAID',
  description:
    'Publicá tu bicicleta verificada en RODAID y cobrá protegido con RODAID PAY.',
}

export default async function PublicarPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('nf_jwt')

  if (!token) {
    redirect('/ingresar?next=/publicar')
  }

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">
            Vender en RODAID
          </span>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink">
            Publicá tu bici
          </h1>
          <p className="mt-2 text-sm text-slate-warm">
            Solo se publican bicicletas con identidad verificada. El pago queda
            protegido por RODAID PAY hasta la entrega.
          </p>
        </header>
        <PublicarFlow />
      </main>
      <Footer />
    </div>
  )
}
