import { RodaidLogo } from './logo'
import { FaqFooterLink } from './faq-footer-link'
import { ConsultoriaLegalEnlace } from './consultoria-legal-opener'
import { DefensaConsumidorModal } from './defensa-consumidor-modal'
import Link from 'next/link'
import { Code2 } from 'lucide-react'

const COLS = [
  {
    title: 'Marketplace',
    links: ['Comprar bicis', 'Vender', 'Precios y comisiones', 'Cómo funciona'],
  },
  {
    title: 'RODAID PAY',
    links: ['Pago protegido', 'Disputas', 'Reembolsos', 'Seguimiento'],
  },
  {
    title: 'Empresa',
    links: ['Sobre RODAID', 'Seguridad', 'Ayuda', 'Contacto'],
  },
]

const PRODUCTOS = [
  { label: 'Mi Garaje Digital', href: '/garaje' },
  { label: 'Verificador público CIT', href: '/verificar' },
  { label: 'Panel Inspector', href: '/admin/inspecciones' },
  { label: 'Panel Admin RODAID', href: '/admin' },
  { label: 'Sumate como Aliado', href: '/aliados' },
]

export function Footer() {
  return (
    <footer className="bg-ink text-paper">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div>
            <div className="text-paper">
              <RodaidLogo />
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-paper/55">
              El marketplace de bicicletas con identidad verificada y pago
              protegido. Hecho en Argentina.
            </p>
          </div>
          {COLS.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold text-paper">{col.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link}>
                    
                      href="#top"
                      className="text-sm text-paper/55 transition-colors hover:text-lime"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h3 className="text-sm font-semibold text-paper">Productos</h3>
            <ul className="mt-4 space-y-2.5">
              {PRODUCTOS.map((p) => (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    className="text-sm text-paper/55 transition-colors hover:text-lime"
                  >
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Sección Desarrolladores */}
        <div className="mt-10 rounded-2xl border border-paper/10 bg-paper/5 px-6 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Code2 className="size-5 shrink-0 text-lime-deep" />
              <div>
                <p className="text-sm font-semibold text-paper">RODAID para Desarrolladores</p>
                <p className="text-xs text-paper/55">API pública, webhooks, documentación técnica y sandbox.</p>
              </div>
            </div>
            <Link
              href="/desarrolladores"
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-lime-deep/40 px-4 py-2 text-xs font-semibold text-lime-deep transition-colors hover:bg-lime-deep/10"
            >
              <Code2 className="size-3.5" />
              Portal de Desarrolladores
            </Link>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-paper/10 pt-6 text-xs text-paper/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} RODAID. Todos los derechos reservados.</p>
          <div className="flex flex-wrap gap-5">
            <FaqFooterLink />
            <ConsultoriaLegalEnlace />
            <Link href="/terminos" className="transition-colors hover:text-paper">
              Términos
            </Link>
            <Link href="/terminos#seguridad-datos" className="transition-colors hover:text-paper">
              Privacidad
            </Link>
            <DefensaConsumidorModal />
          </div>
        </div>
      </div>
    </footer>
  )
}
