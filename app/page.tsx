import dynamic from 'next/dynamic'
import { Footer } from '@/components/rodaid/footer'
import { Hero } from '@/components/rodaid/hero'
import { Nav } from '@/components/rodaid/nav'
const Marketplace = dynamic(() => import('@/components/rodaid/marketplace').then(m => ({ default: m.Marketplace })), { ssr: false })
const RodaidPay = dynamic(() => import('@/components/rodaid/how-it-works').then(m => ({ default: m.RodaidPay })), { ssr: false })
const Seguridad = dynamic(() => import('@/components/rodaid/how-it-works').then(m => ({ default: m.Seguridad })), { ssr: false })
const SellCta = dynamic(() => import('@/components/rodaid/sell-cta').then(m => ({ default: m.SellCta })), { ssr: false })
const DenunciaComunitaria = dynamic(() => import('@/components/rodaid/denuncia-comunitaria').then(m => ({ default: m.DenunciaComunitaria })), { ssr: false })
const StravaGarminSection = dynamic(() => import('@/components/rodaid/strava-garmin-section').then(m => ({ default: m.StravaGarminSection })), { ssr: false })

export default function Page() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main>
        <Hero />
        <Marketplace />
        <RodaidPay />
        <Seguridad />
        <StravaGarminSection />
        <DenunciaComunitaria />
        <SellCta />
      </main>
      <Footer />
    </div>
  )
}
