'use client'
import { useEffect } from 'react'
import { getSession } from '@/lib/session'
import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { Inspecciones } from '@/components/rodaid/inspecciones'

export default function InspeccionesPage() {
  useEffect(() => {
    const sesion = getSession()
    if (!sesion) { window.location.replace('/ingresar?next=/admin/inspecciones'); return }
    if (sesion.rol !== 'aliado' && sesion.rol !== 'inspector' && sesion.rol !== 'admin') {
      window.location.replace('/garaje')
    }
  }, [])

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <Inspecciones />
      </main>
      <Footer />
    </div>
  )
}
