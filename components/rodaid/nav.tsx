'use client'

import Link from 'next/link'
import { RodaidLogo } from './logo'
import { useAuth } from './auth-context'
import { useEffect, useState } from 'react'

const LINKS = [
  { href: '#comprar', label: 'Comprar' },
  { href: '#vender', label: 'Vender' },
  { href: '#rodaid-pay', label: 'RODAID PAY' },
  { href: '#seguridad', label: 'Seguridad' },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const { user, loading } = useAuth()
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? 'border-b border-ink/10 bg-paper/85 backdrop-blur-md'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <a href="#top" className="text-ink">
          <RodaidLogo />
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-ink/70 transition-colors hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/verificar"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-ink/70 transition-colors hover:text-ink sm:inline-flex"
          >
            Verificar
          </Link>
          <Link
            href="/aliados"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-ink/70 transition-colors hover:text-ink lg:inline-flex"
          >
            Aliados
          </Link>
          <Link
            href="/garaje"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-ink/70 transition-colors hover:text-ink sm:inline-flex"
          >
            Mi Garaje
          </Link>
          <Link
            href="/asistente"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-ink/70 transition-colors hover:text-ink lg:inline-flex"
          >
            Asistente
          </Link>
          <Link
            href="/desarrolladores"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-ink/70 transition-colors hover:text-ink lg:inline-flex"
          >
            Desarrolladores
          </Link>
          {/*
           * Controles de administración: solo visibles para usuarios con rol
           * `admin`. Mientras se hidrata la sesión se reserva el espacio para
           * evitar el salto visual. Esto es UX, no seguridad: el acceso real lo
           * imponen la Edge Function `auth-admin` y los guards del backend.
           */}
          <div className="admin-controls flex items-center">
            {loading ? (
              <span
                aria-hidden="true"
                className="hidden h-9 w-[7.5rem] animate-pulse rounded-full bg-ink/5 lg:inline-flex"
              />
            ) : (
              isAdmin && (
                <Link
                  href="/admin"
                  className="hidden rounded-full px-4 py-2 text-sm font-medium text-ink/70 transition-colors hover:text-ink lg:inline-flex"
                >
                  Administración
                </Link>
              )
            )}
          </div>
          <Link
            href="/ingresar"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-ink/70 transition-colors hover:text-ink sm:inline-flex"
          >
            Ingresar
          </Link>
          <Link
            href="/publicar"
            className="inline-flex items-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-sm transition-transform hover:-translate-y-0.5"
          >
            Publicar mi bici
          </Link>
        </div>
      </div>
    </header>
  )
}
