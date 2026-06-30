import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET /contexts/rodaid/v1 — Hito 16: contexto JSON-LD de las Credenciales
 * Verificables de RODAID. Define los términos propios usados en el
 * `credentialSubject` (BicycleOwnershipCredential) para que un procesador JSON-LD
 * los resuelva sin ambigüedad.
 */
export async function GET() {
  const context = {
    '@context': {
      '@version': 1.1,
      '@protected': true,
      rodaid: 'https://rodaid.netlify.app/contexts/rodaid/v1#',
      BicycleOwnershipCredential: 'rodaid:BicycleOwnershipCredential',
      Bicycle: 'rodaid:Bicycle',
      serialNumber: 'rodaid:serialNumber',
      brand: 'rodaid:brand',
      model: 'rodaid:model',
      category: 'rodaid:category',
      year: 'rodaid:year',
      color: 'rodaid:color',
      verificationStatus: 'rodaid:verificationStatus',
      holder: 'rodaid:holder',
      cit: 'rodaid:cit',
      code: 'rodaid:code',
      anchorHash: 'rodaid:anchorHash',
      blockchain: 'rodaid:blockchain',
      anchorStatus: 'rodaid:anchorStatus',
      transactionHash: 'rodaid:transactionHash',
      tokenId: 'rodaid:tokenId',
      anchoredAt: 'rodaid:anchoredAt',
      RodaidPublicVerifier2025: 'rodaid:RodaidPublicVerifier2025',
    },
  }
  return NextResponse.json(context, {
    headers: {
      'cache-control': 'public, max-age=86400',
      'content-type': 'application/ld+json',
    },
  })
}
