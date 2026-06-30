import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { AsistenteGpt } from '@/components/rodaid/asistente-gpt'

export const metadata = {
  title: 'RODAID-GPT — Asistente de seguridad y gestión ciclista',
  description:
    'Tu asistente experto: consultá la seguridad de tu zona con el mapa de calor de RODAID y el estado del CIT de tu bicicleta. Responde solo con los datos de tu cuenta.',
}

export default function AsistentePage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            RODAID-GPT
          </h1>
          <p className="mt-2 max-w-2xl text-slate-warm">
            El cerebro de RODAID. Combina el estado de tus bicicletas —CIT,
            anclaje en la Blockchain Federal Argentina y actas firmadas— con el
            mapa de calor de seguridad de la ciudad para darte consejos
            preventivos sobre tu rodado y tu zona.
          </p>
        </div>
        <AsistenteGpt />
      </main>
      <Footer />
    </div>
  )
}
