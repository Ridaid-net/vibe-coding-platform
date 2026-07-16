'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { PagosDashboard } from '@/components/rodaid/pagos-dashboard'
import { getSession } from '@/lib/session'

/**
 * /admin/pagos — historicamente la unica forma de llegar al Dashboard
 * Financiero, para admin Y para un dueño de Taller Aliado (rol='aliado', su
 * propio resumen acotado). El Dashboard de Administracion (/admin) ahora
 * incluye Finanzas como un tab mas -- para un admin, esta ruta ya no es un
 * destino separado: redirige. Para un aliado, nada cambia: sigue viendo
 * PagosDashboard directamente aca, tal como siempre.
 */
export default function AdminPagosPage() {
  const router = useRouter()
  const [redirigiendo, setRedirigiendo] = useState(false)

  useEffect(() => {
    const session = getSession()
    if (session?.rol === 'admin') {
      setRedirigiendo(true)
      router.replace('/admin?tab=finanzas')
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
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <PagosDashboard />
      </main>
      <Footer />
    </div>
  )
}
