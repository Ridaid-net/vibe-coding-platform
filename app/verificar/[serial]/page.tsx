import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { Verificador } from '@/components/rodaid/verificador'

export const metadata = {
  title: 'Verificar una bici — RODAID',
  description:
    'Consultá el estado de identidad de una bicicleta por su número de serie o código CIT. Gratis, anónimo y sin cuenta.',
}

/**
 * /verificar/[serial] — destino del QR del Certificado Digital. Abre el
 * Verificador Público ya con el número de serie (o código CIT) cargado y
 * dispara la consulta automáticamente.
 */
export default async function VerificarSerialPage({
  params,
}: {
  params: Promise<{ serial: string }>
}) {
  const { serial } = await params
  const inicial = decodeURIComponent(serial)

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
        <Verificador inicial={inicial} />
      </main>
      <Footer />
    </div>
  )
}
