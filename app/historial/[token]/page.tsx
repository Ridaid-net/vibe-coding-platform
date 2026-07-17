import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { HistorialPublicoView } from '@/components/rodaid/historial-publico'

export const metadata = {
  title: 'Historial Clínico de una bici — RODAID',
  description:
    'Trazabilidad pública de una bicicleta registrada en RODAID: identidad verificada, historial de talleres aliados y estado de mantenimiento. Sin datos personales del dueño.',
}

/**
 * /historial/[token] — Historial Clinico publico de una bici. Destino del
 * link/QR que el dueño activa (opt-in) desde el Garaje Digital para
 * compartir en canales externos (Facebook Marketplace, etc.) sin exponer
 * datos personales.
 */
export default async function HistorialPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-16">
        <HistorialPublicoView token={decodeURIComponent(token)} />
      </main>
      <Footer />
    </div>
  )
}
