import { RodaidLogo } from './logo'
import { FaqFooterLink } from './faq-footer-link'
import { ConsultoriaLegalEnlace } from './consultoria-legal-opener'
import { DefensaConsumidorModal } from './defensa-consumidor-modal'
import Link from 'next/link'

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

export function Footer() {
  return (
    <footer className="bg-ink text-paper">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
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
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-paper/10 pt-6 text-xs text-paper/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} RODAID. Todos los derechos reservados.</p>
          <div className="flex flex-wrap gap-5">
            <FaqFooterLink />
            <ConsultoriaLegalEnlace />
            <Link href="/aliados" className="transition-colors hover:text-lime">
              Sumate como Aliado
            </Link>
            <Link href="/admin/inspecciones" className="transition-colors hover:text-lime">
              Panel de Inspecciones
            </Link>
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
