import { Footer } from '@/components/rodaid/footer'
import { Hero } from '@/components/rodaid/hero'
import { Marketplace } from '@/components/rodaid/marketplace'
import { Nav } from '@/components/rodaid/nav'
import { RodaidPay, Seguridad } from '@/components/rodaid/how-it-works'
import { SellCta } from '@/components/rodaid/sell-cta'
import { DenunciaComunitaria } from '@/components/rodaid/denuncia-comunitaria'
import { StravaGarminSection } from '@/components/rodaid/strava-garmin-section'

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
