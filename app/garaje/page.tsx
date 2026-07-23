import { Bus, ExternalLink } from 'lucide-react'
import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { GarajeDigital } from '@/components/rodaid/garaje-digital'
import { MisPublicaciones } from '@/components/rodaid/mis-publicaciones'
import { MisCompras } from '@/components/rodaid/mis-compras'
import { VenderSwipe } from '@/components/rodaid/VenderSwipe'
import { GarajeAnalitica } from '@/components/rodaid/garaje-analitica'
import { IotTiempoReal } from '@/components/rodaid/iot-tiempo-real'
import { ServiciosCTA } from '@/components/rodaid/ServiciosCTA'
import { StravaActividades } from '@/components/rodaid/StravaActividades'
import { GarminActividades } from '@/components/rodaid/GarminActividades'
import { PronosticoTiempo } from '@/components/rodaid/PronosticoTiempo'
import { NoticiasPrensaWidget } from '@/components/rodaid/NoticiasPrensaWidget'
import { PerfilCard } from '@/components/rodaid/perfil-card'
import { NotificacionesCard } from '@/components/rodaid/notificaciones-card'
import { MisDisputasVendedor } from '@/components/rodaid/MisDisputasVendedor'

export const metadata = {
  title: 'Mi Garaje Digital — RODAID',
  description:
    'El hub central de tus bicicletas: estado de cada CIT, anclaje en la BFA, actas firmadas, publicaciones y analítica personal.',
}

export default function GarajePage() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <GarajeDigital />
        <VenderSwipe />
        <MisPublicaciones />
        <MisCompras />
        <MisDisputasVendedor />
        <GarajeAnalitica />
        <IotTiempoReal />

        {/* Bloque Bici-Salud: IoT (mantenimiento predictivo) + acceso a Servicios
            de Talleres Aliados + actividades Strava/Garmin, agrupados porque
            conceptualmente van juntos (ver ServiciosCTA.tsx). */}
        <ServiciosCTA />
        <StravaActividades />
        <GarminActividades />
        <a
          href="https://mendotran.mendoza.gov.ar/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center gap-4 rounded-3xl border border-ink/10 bg-white p-5 transition-colors hover:bg-paper-dim/40"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-paper-dim text-ink/40">
            <Bus className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-bold text-ink">Consultá tu saldo en la app oficial de SUBE</p>
            <p className="text-xs text-slate-warm mt-0.5">
              Te lleva al sitio oficial de MendoTran — RODAID no accede a tu saldo real, todavía no existe una API pública de SUBE.
            </p>
          </div>
          <ExternalLink className="size-4 shrink-0 text-ink/30" />
        </a>

        {/* Widget lateral derecho — Pronóstico del Tiempo */}
        {/* Lado izquierdo disponible para futuras cajas: Noticias, Prensa, Eventos */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <PronosticoTiempo />
          <NoticiasPrensaWidget />
        </div>

        <PerfilCard />
        <NotificacionesCard />
      </main>
      <Footer />
    </div>
  )
}
