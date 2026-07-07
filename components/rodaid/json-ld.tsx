export function JsonLdOrganizacion() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'RODAID',
    url: 'https://rodaid.net',
    logo: 'https://rodaid.net/logo-rodaid.jpeg',
    description: 'Plataforma de certificación técnica digital de bicicletas en Argentina. CIT blockchain, marketplace verificado y pago protegido.',
    foundingDate: '2026',
    foundingLocation: { '@type': 'Place', name: 'San Martín, Mendoza, Argentina' },
    areaServed: { '@type': 'State', name: 'Mendoza, Argentina' },
    contactPoint: { '@type': 'ContactPoint', email: 'federicodegeaceo@rodaid.net', contactType: 'customer service' },
    sameAs: ['https://rodaid.net'],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
}

export function JsonLdMarketplace() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'RODAID — Marketplace de bicicletas verificadas',
    url: 'https://rodaid.net',
    description: 'Comprá y vendé bicicletas con identidad verificada (CIT) y pago protegido por RODAID PAY.',
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://rodaid.net/verificar?serie={serie}',
      'query-input': 'required name=serie',
    },
    publisher: {
      '@type': 'Organization',
      name: 'RODAID',
      logo: { '@type': 'ImageObject', url: 'https://rodaid.net/logo-rodaid.jpeg' }
    }
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
}
