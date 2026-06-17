import { Bricolage_Grotesque, Hanken_Grotesk } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { FaqWidget } from '@/components/rodaid/faq-widget'
import { AuthProvider } from '@/components/rodaid/auth-context'
import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import './globals.css'

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-rodaid-display',
  display: 'swap',
  weight: ['500', '600', '700', '800'],
})

const body = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-rodaid-body',
  display: 'swap',
})

const title = 'RODAID — Marketplace de bicicletas verificadas en Argentina'
const description =
  'Comprá y vendé bicicletas con identidad verificada (CIT) y pago protegido por RODAID PAY. El escrow retiene los fondos hasta que la bici llega a destino.'

export const metadata: Metadata = {
  title,
  description,
  applicationName: 'RODAID',
  keywords: [
    'bicicletas',
    'marketplace',
    'Argentina',
    'comprar bici',
    'vender bici',
    'RODAID PAY',
    'escrow',
  ],
  openGraph: {
    title,
    description,
    type: 'website',
    locale: 'es_AR',
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es-AR" className={`${display.variable} ${body.variable}`}>
      <body className="font-body bg-paper text-ink antialiased">
        <AuthProvider>
          {children}
          <FaqWidget />
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  )
}
