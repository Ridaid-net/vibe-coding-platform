import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { GarajeDigital } from '@/components/rodaid/garaje-digital'
import { MisPublicaciones } from '@/components/rodaid/mis-publicaciones'
import { MisCompras } from '@/components/rodaid/mis-compras'
import { GarajeAnalitica } from '@/components/rodaid/garaje-analitica'
import { IotTiempoReal } from '@/components/rodaid/iot-tiempo-real'
import { ServiciosCTA } from '@/components/rodaid/ServiciosCTA'
import { StravaActividades } from '@/components/rodaid/StravaActividades'
import { GarminActividades } from '@/components/rodaid/GarminActividades'
import { PronosticoTiempo } from '@/components/rodaid/PronosticoTiempo'
import { NoticiasPrensaWidget } from '@/components/rodaid/NoticiasPrensaWidget'
import { PerfilCard } from '@/components/rodaid/perfil-card'
import { NotificacionesCard } from '@/components/rodaid/notificaciones-card'

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
        <MisPublicaciones />
        <MisCompras />
        <GarajeAnalitica />
        <IotTiempoReal />

        {/* Bloque Bici-Salud: IoT (mantenimiento predictivo) + acceso a Servicios
            de Talleres Aliados + actividades Strava/Garmin, agrupados porque
            conceptualmente van juntos (ver ServiciosCTA.tsx). */}
        <ServiciosCTA />
        <StravaActividades />
        <GarminActividades />

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
