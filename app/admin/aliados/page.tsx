'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { AliadosAdmin } from '@/components/rodaid/aliados-admin'
import { getSession } from '@/lib/session'

/**
 * /admin/aliados — historicamente la unica forma de llegar a la aprobacion de
 * solicitudes de Aliados. El Dashboard de Administracion (/admin) ahora la
 * incluye como un tab mas (junto a Finanzas) -- para un admin, esta ruta ya
 * no es un destino separado: redirige. Mismo patron que /admin/pagos.
 */
export default function AdminAliadosPage() {
  const router = useRouter()
  const [redirigiendo, setRedirigiendo] = useState(false)

  useEffect(() => {
    const session = getSession()
    if (session?.rol === 'admin') {
      setRedirigiendo(true)
      router.replace('/admin?tab=aliados')
    }
  }, [router])

  if (redirigiendo) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-paper text-sm text-slate-warm">
        <Loader2 className="size-4 animate-spin" /> Redirigiendo al Dashboard de Administración…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <AliadosAdmin />
      </main>
      <Footer />
    </div>
  )
}
