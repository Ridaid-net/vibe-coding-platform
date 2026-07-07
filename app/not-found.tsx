import Link from 'next/link'
import { Nav } from '@/components/rodaid/nav'
import { Footer } from '@/components/rodaid/footer'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-2xl px-5 py-24 sm:px-8 text-center">
        <div className="mb-8">
          <span className="font-display text-8xl font-black text-[#0F1E35] opacity-10">404</span>
        </div>
        <div className="rounded-3xl border border-ink/10 bg-white p-10">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-[#2BBCB8]/10 mx-auto mb-6">
            <svg viewBox="0 0 24 24" fill="none" stroke="#2BBCB8" strokeWidth="1.5" className="size-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h1 className="font-display text-2xl font-bold text-[#0F1E35] mb-3">
            Página no encontrada
          </h1>
          <p className="text-sm text-slate-warm mb-8 leading-relaxed">
            La página que buscás no existe o fue movida. Podés verificar una bici, explorar el marketplace o volver al inicio.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/"
              className="inline-flex items-center gap-2 rounded-full bg-[#0F1E35] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F1E35]/80">
              Ir al inicio
            </Link>
            <Link href="/verificar"
              className="inline-flex items-center gap-2 rounded-full border border-[#2BBCB8] px-5 py-2.5 text-sm font-semibold text-[#2BBCB8] hover:bg-[#2BBCB8]/10">
              Verificar bicicleta
            </Link>
            <Link href="/marketplace"
              className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-ink/5">
              Marketplace
            </Link>
          </div>
        </div>
        <p className="mt-8 text-xs text-slate-warm">
          RODAID · <a href="https://rodaid.net" className="text-[#2BBCB8] hover:underline">rodaid.net</a>
        </p>
      </main>
      <Footer />
    </div>
  )
}
