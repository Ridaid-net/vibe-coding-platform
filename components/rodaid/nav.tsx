'use client'

import Link from 'next/link'
import { CampanaNotificaciones } from '@/components/rodaid/CampanaNotificaciones'
import { usePathname } from 'next/navigation'
import { RodaidLogo } from './logo'
import { useAuth } from './auth-context'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'

const LINKS_SECCION = [
  { href: '#comprar', label: 'Comprar' },
  { href: '#vender', label: 'Vender' },
  { href: '#rodaid-pay', label: 'RODAID PAY' },
  { href: '#seguridad', label: 'Seguridad' },
]

const LINKS_APP = [
  { href: '/verificar', label: 'Verificar' },
  { href: '/garaje', label: 'Mi Garaje' },
  { href: '/aliados', label: 'Aliados' },
  { href: '/asistente', label: 'Asistente' },
  { href: '/desarrolladores', label: 'Desarrolladores' },
]

export function Nav() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { user, loading } = useAuth()
  const isAdmin = user?.role === 'admin'
  // Scoping de Nav para Taller Aliado (rol='aliado'): ve solo "Verificar"
  // (el verificador publico), "Mi Garaje" (para publicar las bicis de su
  // tienda) y "Mi Taller" (para hacer los CIT) -- nada del resto del menu.
  // No aplica a 'inspector' (comparte el link "Mi Taller" pero conserva el
  // nav completo de siempre).
  const isTallerAliado = user?.role === 'aliado'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`sticky top-0 z-50 transition-colors duration-300 ${scrolled ? 'border-b border-ink/10 bg-paper/85 backdrop-blur-md' : 'border-b border-transparent bg-transparent'}`}>
      <div className="mx-auto flex h-20 max-w-7xl items-center gap-6 px-5 sm:px-8">
        <RodaidLogo className="text-ink" />
        <nav className="hidden flex-1 items-center justify-center gap-4 lg:flex">
          {isTallerAliado ? (
            <>
              <Link href="/verificar" className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">Verificar</Link>
              <Link href="/garaje" className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">Mi Garaje</Link>
              <Link href="/taller" className="text-xs font-semibold text-white transition-colors px-3 py-1.5 rounded-full bg-[#1E9E96] hover:bg-[#1E9E96]/90">Mi Taller</Link>
            </>
          ) : (
            <>
              {LINKS_SECCION.map((link) => (<a key={link.href} href={link.href} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">{link.label}</a>))}
              <span className="h-4 w-px bg-ink/15" />
              {LINKS_APP.map((link) => (<Link key={link.href} href={link.href} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">{link.label}</Link>))}
              {isAdmin && (<Link href="/admin" className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">Administración</Link>)}
              {isAdmin && (<Link href="/admin/noticias" className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">Noticias</Link>)}
              {isAdmin && (<Link href="/admin/gov" className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">Panel Gov</Link>)}
              {user?.role === "inspector" && (<Link href="/taller" className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">Mi Taller</Link>)}
            </>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/empezar" className="hidden rounded-full px-3 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:text-ink sm:inline-flex border border-ink/15">Ingresar</Link>
          <CampanaNotificaciones />
          {pathname !== "/garaje" && <Link href="/publicar" className="inline-flex items-center rounded-full bg-[#F47B20] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5">Publicar mi bici</Link>}
<button type="button" onClick={() => setMenuOpen((v) => !v)} className="ml-1 rounded-full p-2 text-ink/70 transition-colors hover:text-ink lg:hidden" aria-label="Menú">
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="border-t border-ink/10 bg-paper/95 px-5 py-4 lg:hidden">
          <nav className="flex flex-col gap-3">
            {isTallerAliado ? (
              <>
                <Link href="/verificar" onClick={() => setMenuOpen(false)} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5 w-fit">Verificar</Link>
                <Link href="/garaje" onClick={() => setMenuOpen(false)} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5 w-fit">Mi Garaje</Link>
                <Link href="/taller" onClick={() => setMenuOpen(false)} className="text-xs font-semibold text-white transition-colors px-3 py-1.5 rounded-full bg-[#1E9E96] hover:bg-[#1E9E96]/90 w-fit">Mi Taller</Link>
              </>
            ) : (
              <>
                {LINKS_SECCION.map((link) => (<a key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">{link.label}</a>))}
                <hr className="border-ink/10" />
                {LINKS_APP.map((link) => (<Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">{link.label}</Link>))}
                {user?.role === "inspector" && (<Link href="/taller" onClick={() => setMenuOpen(false)} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">Mi Taller</Link>)}
              </>
            )}
            <hr className="border-ink/10" />
            <Link href="/empezar" onClick={() => setMenuOpen(false)} className="text-sm font-medium text-ink/70 transition-colors hover:text-ink">Ingresar</Link>
          </nav>
        </div>
      )}
    </header>
  )
}
