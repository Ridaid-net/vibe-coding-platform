import { Bricolage_Grotesque, Hanken_Grotesk } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { FaqWidget } from '@/components/rodaid/faq-widget'
import { ConsultoriaLegalWidget } from '@/components/rodaid/consultoria-legal-widget'
import { AuthProvider } from '@/components/rodaid/auth-context'
import { SoporteChat } from '@/components/rodaid/SoporteChat'

import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import './globals.css'
import { JsonLdOrganizacion, JsonLdMarketplace } from '@/components/rodaid/json-ld'

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
  metadataBase: new URL("https://rodaid.net"),
  alternates: { canonical: "https://rodaid.net" },
  title,
  description,
  applicationName: 'RODAID',
  keywords: [
    'bicicletas', 'marketplace', 'Argentina', 'Mendoza', 'comprar bici',
    'vender bici', 'RODAID PAY', 'escrow', 'CIT', 'certificado bicicleta',
    'blockchain bicicleta', 'bicicletas verificadas', 'certificacion tecnica',
    'Zona Este Mendoza', 'San Martin Mendoza', 'bicicleta usada segura',
  ],
  openGraph: {
    title,
    description,
    type: 'website',
    locale: 'es_AR',
    url: 'https://rodaid.net',
    siteName: 'RODAID',
    images: [{
      url: 'https://rodaid.net/og-image.png',
      width: 1200,
      height: 630,
      alt: 'RODAID — Marketplace de bicicletas verificadas en Argentina',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['https://rodaid.net/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es-AR" className={`${display.variable} ${body.variable}`}>
      <body className="font-body bg-paper text-ink antialiased">
        <JsonLdOrganizacion />
        <JsonLdMarketplace />
        <AuthProvider>
          {children}
          <FaqWidget />
          <ConsultoriaLegalWidget />
        
          </AuthProvider>
        <SoporteChat />
        <Toaster />
      </body>
    </html>
  )
}
