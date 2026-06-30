import { Footer } from '@/components/rodaid/footer'
import { Hero } from '@/components/rodaid/hero'
import { Marketplace } from '@/components/rodaid/marketplace'
import { Nav } from '@/components/rodaid/nav'
import { RodaidPay, Seguridad } from '@/components/rodaid/how-it-works'
import { SellCta } from '@/components/rodaid/sell-cta'

export default function Page() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main>
        <Hero />
        <Marketplace />
        <RodaidPay />
        <Seguridad />
        <SellCta />
      </main>
      <Footer />
    </div>
  )
}
