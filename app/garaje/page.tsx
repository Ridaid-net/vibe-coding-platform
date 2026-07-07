import { Footer } from '@/components/rodaid/footer'
import { Nav } from '@/components/rodaid/nav'
import { GarajeDigital } from '@/components/rodaid/garaje-digital'
import { MisPublicaciones } from '@/components/rodaid/mis-publicaciones'
import { GarajeAnalitica } from '@/components/rodaid/garaje-analitica'
import { IotTiempoReal } from '@/components/rodaid/iot-tiempo-real'
import { StravaActividades } from '@/components/rodaid/StravaActividades'
import { GarminActividades } from '@/components/rodaid/GarminActividades'
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
        <GarajeAnalitica />
        <IotTiempoReal />
        <StravaActividades />
        <GarminActividades />
        <PerfilCard />
        <NotificacionesCard />
      </main>
      <Footer />
    </div>
  )
}
