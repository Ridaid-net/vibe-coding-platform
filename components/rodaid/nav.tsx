'use client'

import Link from 'next/link'
import { RodaidLogo } from './logo'
import { useAuth } from './auth-context'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { getSession, clearSession } from '@/lib/session'

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
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [logueado, setLogueado] = useState(false)
  useEffect(() => {
    setLogueado(!!getSession())
  }, [])
  const handleSalir = () => {
    clearSession()
    setLogueado(false)
    window.location.href = "/"
  }
  const { user, loading } = useAuth()
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`sticky top-0 z-50 transition-colors duration-300 ${scrolled ? 'border-b border-ink/10 bg-paper/85 backdrop-blur-md' : 'border-b border-transparent bg-transparent'}`}>
      <div className="mx-auto flex h-20 max-w-7xl items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="text-ink"><RodaidLogo /></Link>
        <nav className="hidden flex-1 items-center justify-center gap-4 lg:flex">
          {LINKS_SECCION.map((link) => (<a key={link.href} href={link.href} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">{link.label}</a>))}
          <span className="h-4 w-px bg-ink/15" />
          {LINKS_APP.map((link) => (<Link key={link.href} href={link.href} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">{link.label}</Link>))}
          {isAdmin && (<Link href="/admin" className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">Administración</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/ingresar" className="hidden rounded-full px-3 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:text-ink sm:inline-flex border border-ink/15">Ingresar</Link>
          <Link href="/publicar" className="inline-flex items-center rounded-full bg-[#F47B20] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5">Publicar mi bici</Link>
<button type="button" onClick={() => setMenuOpen((v) => !v)} className="ml-1 rounded-full p-2 text-ink/70 transition-colors hover:text-ink lg:hidden" aria-label="Menú">
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="border-t border-ink/10 bg-paper/95 px-5 py-4 lg:hidden">
          <nav className="flex flex-col gap-3">
            {LINKS_SECCION.map((link) => (<a key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">{link.label}</a>))}
            <hr className="border-ink/10" />
            {LINKS_APP.map((link) => (<Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="text-xs font-medium text-ink/70 transition-colors hover:text-ink px-2 py-1 rounded-full hover:bg-ink/5">{link.label}</Link>))}
            <hr className="border-ink/10" />
            <Link href="/ingresar" onClick={() => setMenuOpen(false)} className="text-sm font-medium text-ink/70 transition-colors hover:text-ink">Ingresar</Link>
          </nav>
        </div>
      )}
    </header>
  )
}
