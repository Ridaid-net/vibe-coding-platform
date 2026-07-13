import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { VerificadorRemito } from '@/components/rodaid/VerificadorRemito'

export const metadata = {
  title: 'Verificar un remito — RODAID',
  description:
    'Confirmá que un Remito de Embalaje y Despacho de RODAID es genuino y consultá su estado. Gratis, anónimo y sin cuenta.',
}

/**
 * /verificar/remito/[numero] — destino del QR del Remito de Embalaje y
 * Despacho (Fase 6b, CIT Completo). Simétrico a /verificar/[serial], pero
 * para remitos en vez de bicis.
 */
export default async function VerificarRemitoPage({
  params,
}: {
  params: Promise<{ numero: string }>
}) {
  const { numero } = await params
  const inicial = decodeURIComponent(numero)

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-16">
        <VerificadorRemito numero={inicial} />
      </main>
      <Footer />
    </div>
  )
}
