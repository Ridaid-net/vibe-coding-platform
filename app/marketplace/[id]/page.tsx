import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { PublicacionDetalle } from '@/components/rodaid/publicacion-detalle'

export default async function PublicacionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main>
        <PublicacionDetalle id={id} />
      </main>
      <Footer />
    </div>
  )
}
